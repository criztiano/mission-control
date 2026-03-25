import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { notifications, tasks, agents } from '@/db/schema';
import { eq, and, isNull, isNotNull, inArray, desc, sql, SQL } from 'drizzle-orm';
import { requireRole } from '@/lib/auth';
import { mutationLimiter } from '@/lib/rate-limit';
import { validateBody, notificationActionSchema } from '@/lib/validation';

/**
 * GET /api/notifications - Get notifications for a specific recipient
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url);

    const recipient = searchParams.get('recipient');
    const unread_only = searchParams.get('unread_only') === 'true';
    const type = searchParams.get('type');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 500);
    const offset = parseInt(searchParams.get('offset') || '0');

    if (!recipient) {
      return NextResponse.json({ error: 'Recipient is required' }, { status: 400 });
    }

    const conditions: SQL[] = [eq(notifications.recipient, recipient)];
    if (unread_only) conditions.push(isNull(notifications.read_at));
    if (type) conditions.push(eq(notifications.type, type));

    const notifRows = await db.select().from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.created_at))
      .limit(limit)
      .offset(offset);

    // Enhance with source details
    const enhancedNotifications = await Promise.all(notifRows.map(async (notification) => {
      let sourceDetails = null;

      try {
        if (notification.source_type && notification.source_id) {
          switch (notification.source_type) {
            case 'task': {
              const taskRows = await db.select({ id: tasks.id, title: tasks.title, status: tasks.status })
                .from(tasks).where(eq(tasks.id, notification.source_id)).limit(1);
              if (taskRows[0]) sourceDetails = { type: 'task', ...taskRows[0] };
              break;
            }
            case 'comment': {
              const rows = await db.execute(sql`
                SELECT c.id, c.content, c.task_id, t.title as task_title
                FROM comments c LEFT JOIN tasks t ON c.task_id = t.id
                WHERE c.id = ${notification.source_id}
              `);
              const comment = rows.rows[0] as any;
              if (comment) sourceDetails = { type: 'comment', ...comment, content_preview: comment.content?.substring(0, 100) || '' };
              break;
            }
            case 'agent': {
              const agentRows = await db.select({ id: agents.id, name: agents.name, role: agents.role, status: agents.status })
                .from(agents).where(eq(agents.id, notification.source_id)).limit(1);
              if (agentRows[0]) sourceDetails = { type: 'agent', ...agentRows[0] };
              break;
            }
          }
        }
      } catch (error) {
        console.warn(`Failed to fetch source details for notification ${notification.id}:`, error);
      }

      return { ...notification, source: sourceDetails };
    }));

    const unreadCountRows = await db.select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.recipient, recipient), isNull(notifications.read_at)));
    const unreadCount = unreadCountRows[0]?.count ?? 0;

    const countRows = await db.select({ total: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(...conditions));
    const total = countRows[0]?.total ?? 0;

    return NextResponse.json({
      notifications: enhancedNotifications,
      total,
      page: Math.floor(offset / limit) + 1,
      limit,
      unreadCount
    });
  } catch (error) {
    console.error('GET /api/notifications error:', error);
    return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 });
  }
}

/**
 * PUT /api/notifications - Mark notifications as read
 */
export async function PUT(request: NextRequest) {
  const auth = await requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateCheck = mutationLimiter(request);
  if (rateCheck) return rateCheck;

  try {
    const body = await request.json();
    const { ids, recipient, markAllRead } = body;
    const now = Math.floor(Date.now() / 1000);

    if (markAllRead && recipient) {
      await db.update(notifications).set({ read_at: now })
        .where(and(eq(notifications.recipient, recipient), isNull(notifications.read_at)));
      return NextResponse.json({ success: true });
    } else if (ids && Array.isArray(ids)) {
      await db.update(notifications).set({ read_at: now })
        .where(and(inArray(notifications.id, ids), isNull(notifications.read_at)));
      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json({ error: 'Either provide ids array or recipient with markAllRead=true' }, { status: 400 });
    }
  } catch (error) {
    console.error('PUT /api/notifications error:', error);
    return NextResponse.json({ error: 'Failed to update notifications' }, { status: 500 });
  }
}

/**
 * DELETE /api/notifications - Delete notifications
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateCheck = mutationLimiter(request);
  if (rateCheck) return rateCheck;

  try {
    const body = await request.json();
    const { ids, recipient, olderThan } = body;

    if (ids && Array.isArray(ids)) {
      await db.delete(notifications).where(inArray(notifications.id, ids));
      return NextResponse.json({ success: true });
    } else if (recipient && olderThan) {
      await db.delete(notifications).where(
        and(eq(notifications.recipient, recipient), sql`${notifications.created_at} < ${olderThan}`)
      );
      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json({ error: 'Either provide ids array or recipient with olderThan timestamp' }, { status: 400 });
    }
  } catch (error) {
    console.error('DELETE /api/notifications error:', error);
    return NextResponse.json({ error: 'Failed to delete notifications' }, { status: 500 });
  }
}

/**
 * POST /api/notifications - Mark notifications as delivered
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateCheck = mutationLimiter(request);
  if (rateCheck) return rateCheck;

  try {
    const result = await validateBody(request, notificationActionSchema);
    if ('error' in result) return result.error;
    const { agent, action } = result.data;

    if (action === 'mark-delivered') {
      const now = Math.floor(Date.now() / 1000);
      await db.update(notifications).set({ delivered_at: now })
        .where(and(eq(notifications.recipient, agent), isNull(notifications.delivered_at)));

      const deliveredNotifs = await db.select().from(notifications)
        .where(and(eq(notifications.recipient, agent), eq(notifications.delivered_at, now)));

      return NextResponse.json({ success: true, delivered: deliveredNotifs.length, notifications: deliveredNotifs });
    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('POST /api/notifications error:', error);
    return NextResponse.json({ error: 'Failed to process notification action' }, { status: 500 });
  }
}
