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

    // Fire main data fetch + both count queries in parallel — all independent of each other
    const [notifRows, unreadCountRows, countRows] = await Promise.all([
      db.select().from(notifications)
        .where(and(...conditions))
        .orderBy(desc(notifications.created_at))
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .where(and(eq(notifications.recipient, recipient), isNull(notifications.read_at))),
      db.select({ total: sql<number>`count(*)::int` })
        .from(notifications)
        .where(and(...conditions)),
    ]);

    const unreadCount = unreadCountRows[0]?.count ?? 0;
    const total = countRows[0]?.total ?? 0;

    // Batch-fetch source details (3 queries max instead of N)
    const taskIds = [...new Set(notifRows.filter(n => n.source_type === 'task' && n.source_id).map(n => n.source_id!))];
    const commentIds = [...new Set(notifRows.filter(n => n.source_type === 'comment' && n.source_id).map(n => n.source_id!))];
    const agentIds = [...new Set(notifRows.filter(n => n.source_type === 'agent' && n.source_id).map(n => n.source_id!))];

    const [taskRows, commentRows, agentRows] = await Promise.all([
      taskIds.length > 0
        ? db.select({ id: tasks.id, title: tasks.title, status: tasks.status }).from(tasks).where(inArray(tasks.id, taskIds))
        : Promise.resolve([]),
      commentIds.length > 0
        ? db.execute(sql`
            SELECT c.id, c.content, c.task_id, t.title as task_title
            FROM comments c LEFT JOIN tasks t ON c.task_id = t.id
            WHERE c.id IN (${sql.join(commentIds.map(id => sql`${id}`), sql`, `)})
          `).then(r => r.rows as any[])
        : Promise.resolve([]),
      agentIds.length > 0
        ? db.select({ id: agents.id, name: agents.name, role: agents.role, status: agents.status }).from(agents).where(inArray(agents.id, agentIds))
        : Promise.resolve([]),
    ]);

    const taskMap = new Map(taskRows.map(t => [t.id, t]));
    const commentMap = new Map(commentRows.map((c: any) => [c.id, c]));
    const agentMap = new Map(agentRows.map(a => [a.id, a]));

    const enhancedNotifications = notifRows.map((notification) => {
      let sourceDetails = null;
      if (notification.source_type && notification.source_id) {
        switch (notification.source_type) {
          case 'task': {
            const t = taskMap.get(notification.source_id);
            if (t) sourceDetails = { type: 'task', ...t };
            break;
          }
          case 'comment': {
            const c = commentMap.get(notification.source_id);
            if (c) sourceDetails = { type: 'comment', ...c, content_preview: c.content?.substring(0, 100) || '' };
            break;
          }
          case 'agent': {
            const a = agentMap.get(notification.source_id);
            if (a) sourceDetails = { type: 'agent', ...a };
            break;
          }
        }
      }
      return { ...notification, source: sourceDetails };
    });

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
      const deliveredNotifs = await db.update(notifications).set({ delivered_at: now })
        .where(and(eq(notifications.recipient, agent), isNull(notifications.delivered_at)))
        .returning();

      return NextResponse.json({ success: true, delivered: deliveredNotifs.length, notifications: deliveredNotifs });
    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('POST /api/notifications error:', error);
    return NextResponse.json({ error: 'Failed to process notification action' }, { status: 500 });
  }
}
