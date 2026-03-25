import { NextRequest, NextResponse } from 'next/server';
import { db_helpers } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { db } from '@/db/client';
import { agents, issues } from '@/db/schema';
import { eq, and, like, sql } from 'drizzle-orm';

/**
 * GET /api/agents/[id]/heartbeat - Agent heartbeat check
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id: agentId } = await params;

    // Get agent by ID or name
    let agentRows;
    if (isNaN(Number(agentId))) {
      agentRows = await db.select().from(agents).where(eq(agents.name, agentId)).limit(1);
    } else {
      agentRows = await db.select().from(agents).where(eq(agents.id, Number(agentId))).limit(1);
    }

    const agent = agentRows[0];
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const workItems: any[] = [];
    const now = Math.floor(Date.now() / 1000);
    const fourHoursAgo = now - (4 * 60 * 60);

    // 1. Check for @mentions in recent comments (MC db)
    const mentionRows = await db.execute(sql`
      SELECT c.*, t.title as task_title
      FROM comments c
      JOIN tasks t ON c.task_id = t.id
      WHERE c.mentions LIKE ${'%"' + agent.name + '"%'}
      AND c.created_at > ${fourHoursAgo}
      ORDER BY c.created_at DESC
      LIMIT 10
    `);

    if (mentionRows.rows.length > 0) {
      workItems.push({
        type: 'mentions',
        count: mentionRows.rows.length,
        items: (mentionRows.rows as any[]).map(m => ({
          id: m.id,
          task_title: m.task_title,
          author: m.author,
          content: m.content.substring(0, 100) + '...',
          created_at: m.created_at,
        })),
      });
    }

    // 2. Check for assigned tasks from control-center.db (CC db)
    const assignedTaskRows = await db
      .select()
      .from(issues)
      .where(and(
        eq(issues.assignee, agent.name),
        eq(issues.status, 'open'),
        eq(issues.archived, false)
      ))
      .limit(10);

    if (assignedTaskRows.length > 0) {
      workItems.push({
        type: 'assigned_tasks',
        count: assignedTaskRows.length,
        items: assignedTaskRows.map(t => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
        })),
      });
    }

    // 3. Check for unread notifications
    const notificationList = await db_helpers.getUnreadNotifications(agent.name);

    if (notificationList.length > 0) {
      workItems.push({
        type: 'notifications',
        count: notificationList.length,
        items: notificationList.slice(0, 5).map(n => ({
          id: n.id,
          type: n.type,
          title: n.title,
          message: n.message,
          created_at: n.created_at,
        })),
      });
    }

    // 4. Check for urgent activities
    const urgentActivityRows = await db.execute(sql`
      SELECT * FROM activities
      WHERE type IN ('task_created', 'task_assigned', 'high_priority_alert')
      AND created_at > ${fourHoursAgo}
      AND description LIKE ${'%' + agent.name + '%'}
      ORDER BY created_at DESC
      LIMIT 5
    `);

    if (urgentActivityRows.rows.length > 0) {
      workItems.push({
        type: 'urgent_activities',
        count: urgentActivityRows.rows.length,
        items: (urgentActivityRows.rows as any[]).map(a => ({
          id: a.id,
          type: a.type,
          description: a.description,
          created_at: a.created_at,
        })),
      });
    }

    await db_helpers.updateAgentStatus(agent.name, 'idle', 'Heartbeat check');
    await db_helpers.logActivity(
      'agent_heartbeat',
      'agent',
      agent.id,
      agent.name,
      `Heartbeat check completed - ${workItems.length > 0 ? `${workItems.length} work items found` : 'no work items'}`,
      { workItemsCount: workItems.length, workItemTypes: workItems.map(w => w.type) }
    );

    if (workItems.length === 0) {
      return NextResponse.json({
        status: 'HEARTBEAT_OK',
        agent: agent.name,
        checked_at: now,
        message: 'No work items found',
      });
    }

    return NextResponse.json({
      status: 'WORK_ITEMS_FOUND',
      agent: agent.name,
      checked_at: now,
      work_items: workItems,
      total_items: workItems.reduce((sum, item) => sum + item.count, 0),
    });
  } catch (error) {
    console.error('GET /api/agents/[id]/heartbeat error:', error);
    return NextResponse.json({ error: 'Failed to perform heartbeat check' }, { status: 500 });
  }
}

/**
 * POST /api/agents/[id]/heartbeat - Manual heartbeat trigger
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  return GET(request, { params });
}
