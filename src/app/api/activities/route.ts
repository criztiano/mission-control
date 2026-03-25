import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { activities, tasks, agents, comments } from '@/db/schema';
import { eq, and, desc, sql, SQL } from 'drizzle-orm';
import { requireRole } from '@/lib/auth'

/**
 * GET /api/activities - Get activity stream or stats
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams, pathname } = new URL(request.url);

    if (pathname.endsWith('/stats') || searchParams.has('stats')) {
      return handleStatsRequest(request);
    }

    return handleActivitiesRequest(request);
  } catch (error) {
    console.error('GET /api/activities error:', error);
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 });
  }
}

async function handleActivitiesRequest(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const type = searchParams.get('type');
    const actor = searchParams.get('actor');
    const entity_type = searchParams.get('entity_type');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 500);
    const offset = parseInt(searchParams.get('offset') || '0');
    const since = searchParams.get('since');

    const conditions: SQL[] = [];
    if (type) conditions.push(eq(activities.type, type));
    if (actor) conditions.push(eq(activities.actor, actor));
    if (entity_type) conditions.push(eq(activities.entity_type, entity_type));
    if (since) conditions.push(sql`${activities.created_at} > ${parseInt(since)}`);

    const activityRows = await db
      .select()
      .from(activities)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(activities.created_at))
      .limit(limit)
      .offset(offset);

    // Enhance with entity details
    const enhancedActivities = await Promise.all(activityRows.map(async (activity) => {
      let entityDetails = null;

      try {
        switch (activity.entity_type) {
          case 'task': {
            const taskRows = await db.select({ id: tasks.id, title: tasks.title, status: tasks.status })
              .from(tasks).where(eq(tasks.id, activity.entity_id)).limit(1);
            if (taskRows[0]) entityDetails = { type: 'task', ...taskRows[0] };
            break;
          }
          case 'agent': {
            const agentRows = await db.select({ id: agents.id, name: agents.name, role: agents.role, status: agents.status })
              .from(agents).where(eq(agents.id, activity.entity_id)).limit(1);
            if (agentRows[0]) entityDetails = { type: 'agent', ...agentRows[0] };
            break;
          }
          case 'comment': {
            const commentRows = await db.execute(sql`
              SELECT c.id, c.content, c.task_id, t.title as task_title
              FROM comments c LEFT JOIN tasks t ON c.task_id = t.id
              WHERE c.id = ${activity.entity_id}
            `);
            const comment = commentRows.rows[0] as any;
            if (comment) {
              entityDetails = {
                type: 'comment',
                ...comment,
                content_preview: comment.content?.substring(0, 100) || ''
              };
            }
            break;
          }
        }
      } catch (error) {
        console.warn(`Failed to fetch entity details for activity ${activity.id}:`, error);
      }

      return {
        ...activity,
        data: activity.data ? JSON.parse(activity.data) : null,
        entity: entityDetails
      };
    }));

    // Count
    const countRows = await db.select({ total: sql<number>`count(*)::int` })
      .from(activities)
      .where(conditions.length ? and(...conditions) : undefined);
    const total = countRows[0]?.total ?? 0;

    return NextResponse.json({
      activities: enhancedActivities,
      total,
      hasMore: offset + activityRows.length < total
    });
  } catch (error) {
    console.error('GET /api/activities (activities) error:', error);
    return NextResponse.json({ error: 'Failed to fetch activities' }, { status: 500 });
  }
}

async function handleStatsRequest(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const hours = parseInt(searchParams.get('hours') || '24');
    const since = Math.floor(Date.now() / 1000) - (hours * 3600);

    const activityStatsRows = await db.execute(sql`
      SELECT type, COUNT(*) as count FROM activities WHERE created_at > ${since}
      GROUP BY type ORDER BY count DESC
    `);

    const activeActorsRows = await db.execute(sql`
      SELECT actor, COUNT(*) as activity_count FROM activities WHERE created_at > ${since}
      GROUP BY actor ORDER BY activity_count DESC LIMIT 10
    `);

    const timelineRows = await db.execute(sql`
      SELECT (created_at / 3600) * 3600 as hour_bucket, COUNT(*) as count
      FROM activities WHERE created_at > ${since}
      GROUP BY hour_bucket ORDER BY hour_bucket ASC
    `);

    return NextResponse.json({
      timeframe: `${hours} hours`,
      activityByType: activityStatsRows.rows,
      topActors: activeActorsRows.rows,
      timeline: (timelineRows.rows as any[]).map(item => ({
        timestamp: item.hour_bucket,
        count: item.count,
        hour: new Date(Number(item.hour_bucket) * 1000).toISOString()
      }))
    });
  } catch (error) {
    console.error('GET /api/activities (stats) error:', error);
    return NextResponse.json({ error: 'Failed to fetch activity stats' }, { status: 500 });
  }
}
