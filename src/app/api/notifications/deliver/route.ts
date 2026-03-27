import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { db_helpers } from '@/lib/db';
import { notifications, agents } from '@/db/schema';
import { eq, isNull, sql } from 'drizzle-orm';
import { runOpenClaw } from '@/lib/command';
import { requireRole } from '@/lib/auth';

/**
 * POST /api/notifications/deliver - Notification delivery daemon endpoint
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json();
    const { agent_filter, limit = 50, dry_run = false } = body;

    // Get undelivered notifications joined with agent session keys
    const undeliveredRows = await db.execute(sql`
      SELECT n.*, a.session_key
      FROM notifications n
      LEFT JOIN agents a ON n.recipient = a.name
      WHERE n.delivered_at IS NULL
      ${agent_filter ? sql`AND n.recipient = ${agent_filter}` : sql``}
      ORDER BY n.created_at ASC
      LIMIT ${limit}
    `)

    const undeliveredNotifications = undeliveredRows.rows as any[]

    if (undeliveredNotifications.length === 0) {
      return NextResponse.json({
        status: 'success',
        message: 'No undelivered notifications found',
        processed: 0,
        delivered: 0,
        errors: []
      });
    }

    let deliveredCount = 0;
    let errorCount = 0;
    const errors: any[] = [];
    const deliveryResults: any[] = [];

    for (const notification of undeliveredNotifications) {
      try {
        if (!notification.session_key) {
          errors.push({ notification_id: notification.id, recipient: notification.recipient, error: 'Agent has no session key configured' });
          errorCount++;
          continue;
        }

        const message = formatNotificationMessage(notification);

        if (!dry_run) {
          try {
            const { stdout, stderr } = await runOpenClaw(
              ['gateway', 'sessions_send', '--session', notification.session_key, '--message', message],
              { timeoutMs: 10000 }
            );

            if (stderr && stderr.includes('error')) {
              throw new Error(`OpenClaw error: ${stderr}`);
            }

            const now = Math.floor(Date.now() / 1000);
            await db.update(notifications).set({ delivered_at: now }).where(eq(notifications.id, notification.id));

            deliveredCount++;
            deliveryResults.push({
              notification_id: notification.id,
              recipient: notification.recipient,
              session_key: notification.session_key,
              delivered_at: now,
              status: 'delivered',
              stdout: stdout.substring(0, 200)
            });

            await db_helpers.logActivity(
              'notification_delivered', 'notification', notification.id, 'system',
              `Notification delivered to ${notification.recipient}`,
              { notification_type: notification.type, session_key: notification.session_key, title: notification.title }
            );
          } catch (cmdError: any) {
            throw new Error(`Command failed: ${cmdError.message}`);
          }
        } else {
          deliveryResults.push({
            notification_id: notification.id,
            recipient: notification.recipient,
            session_key: notification.session_key,
            status: 'dry_run',
            message
          });
          deliveredCount++;
        }
      } catch (error: any) {
        errorCount++;
        errors.push({ notification_id: notification.id, recipient: notification.recipient, error: error.message });
        console.error(`Failed to deliver notification ${notification.id}:`, error);
      }
    }

    await db_helpers.logActivity(
      'notification_delivery_batch', 'system', 0, 'notification_daemon',
      `Processed ${undeliveredNotifications.length} notifications: ${deliveredCount} delivered, ${errorCount} failed`,
      { total_processed: undeliveredNotifications.length, delivered: deliveredCount, errors: errorCount, dry_run, agent_filter: agent_filter || null }
    );

    return NextResponse.json({
      status: 'success',
      message: `Processed ${undeliveredNotifications.length} notifications`,
      total_processed: undeliveredNotifications.length,
      delivered: deliveredCount,
      errors: errorCount,
      dry_run,
      delivery_results: deliveryResults,
      error_details: errors
    });
  } catch (error) {
    console.error('POST /api/notifications/deliver error:', error);
    return NextResponse.json({ error: 'Failed to deliver notifications' }, { status: 500 });
  }
}

/**
 * GET /api/notifications/deliver - Get delivery status and statistics
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url);
    const agent = searchParams.get('agent');

    const [statsRows, recentRows, pendingRows] = await Promise.all([
      db.execute(sql`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN delivered_at IS NULL THEN 1 ELSE 0 END) as undelivered,
          SUM(CASE WHEN delivered_at IS NOT NULL THEN 1 ELSE 0 END) as delivered
        FROM notifications
        ${agent ? sql`WHERE recipient = ${agent}` : sql``}
      `),
      db.execute(sql`
        SELECT recipient, type, title, delivered_at, created_at
        FROM notifications WHERE delivered_at IS NOT NULL
        ${agent ? sql`AND recipient = ${agent}` : sql``}
        ORDER BY delivered_at DESC LIMIT 10
      `),
      db.execute(sql`
        SELECT n.recipient, a.session_key, COUNT(*) as pending_count
        FROM notifications n
        LEFT JOIN agents a ON n.recipient = a.name
        WHERE n.delivered_at IS NULL
        GROUP BY n.recipient, a.session_key
        ORDER BY pending_count DESC
      `),
    ])
    const stats = statsRows.rows[0] as any

    const total = Number(stats?.total || 0)
    const delivered = Number(stats?.delivered || 0)
    const undelivered = Number(stats?.undelivered || 0)

    return NextResponse.json({
      statistics: {
        total,
        delivered,
        undelivered,
        delivery_rate: total > 0 ? Math.round((delivered / total) * 100) : 0
      },
      agents_with_pending: pendingRows.rows,
      recent_deliveries: recentRows.rows,
      agent_filter: agent
    });
  } catch (error) {
    console.error('GET /api/notifications/deliver error:', error);
    return NextResponse.json({ error: 'Failed to get delivery status' }, { status: 500 });
  }
}

function formatNotificationMessage(notification: any): string {
  const timestamp = new Date(notification.created_at * 1000).toLocaleString();

  let message = `🔔 **${notification.title}**\n\n`;
  message += `${notification.message}\n\n`;

  if (notification.type === 'mention') {
    message += `📝 You were mentioned in a comment\n`;
  } else if (notification.type === 'assignment') {
    message += `📋 You have been assigned a new task\n`;
  } else if (notification.type === 'due_date') {
    message += `⏰ Task deadline approaching\n`;
  }

  if (notification.source_type && notification.source_id) {
    message += `🔗 Related ${notification.source_type} ID: ${notification.source_id}\n`;
  }

  message += `⏰ ${timestamp}`;

  return message;
}
