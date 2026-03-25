import { NextRequest, NextResponse } from 'next/server';
import { db_helpers } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { db } from '@/db/client';
import { agents, activities, comments, standupReports } from '@/db/schema';
import { issues } from '@/db/schema';
import { eq, and, between, inArray, desc, asc, sql } from 'drizzle-orm';

/**
 * POST /api/standup/generate - Generate daily standup report
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json();
    const targetDate = body.date || new Date().toISOString().split('T')[0];
    const specificAgents = body.agents;

    const startOfDayUnix = Math.floor(new Date(`${targetDate}T00:00:00Z`).getTime() / 1000);
    const endOfDayUnix = Math.floor(new Date(`${targetDate}T23:59:59Z`).getTime() / 1000);
    const startOfDayISO = new Date(`${targetDate}T00:00:00Z`).toISOString();
    const endOfDayISO = new Date(`${targetDate}T23:59:59Z`).toISOString();

    let agentRows;
    if (specificAgents && Array.isArray(specificAgents) && specificAgents.length > 0) {
      agentRows = await db.select().from(agents).where(inArray(agents.name, specificAgents)).orderBy(asc(agents.name));
    } else {
      agentRows = await db.select().from(agents).orderBy(asc(agents.name));
    }

    const standupData = await Promise.all(
      agentRows.map(async (agent) => {
        const [completedTasks, openTasks, draftTasks] = await Promise.all([
          db.execute(sql`
            SELECT id, title, status, updated_at FROM issues
            WHERE assignee = ${agent.name} AND archived = false AND status = 'closed'
            AND updated_at BETWEEN ${startOfDayISO} AND ${endOfDayISO}
            ORDER BY updated_at DESC
          `),
          db.execute(sql`
            SELECT id, title, status, created_at, priority FROM issues
            WHERE assignee = ${agent.name} AND archived = false AND status = 'open'
            ORDER BY created_at ASC
          `),
          db.execute(sql`
            SELECT id, title, status, created_at, priority FROM issues
            WHERE assignee = ${agent.name} AND archived = false AND status = 'draft'
            ORDER BY created_at ASC
          `),
        ]);

        const activityCountRows = await db.execute(sql`
          SELECT COUNT(*) as count FROM activities
          WHERE actor = ${agent.name} AND created_at BETWEEN ${startOfDayUnix} AND ${endOfDayUnix}
        `);
        const commentCountRows = await db.execute(sql`
          SELECT COUNT(*) as count FROM comments
          WHERE author = ${agent.name} AND created_at BETWEEN ${startOfDayUnix} AND ${endOfDayUnix}
        `);

        return {
          agent: {
            name: agent.name,
            role: agent.role,
            status: agent.status,
            last_seen: agent.last_seen,
            last_activity: agent.last_activity,
          },
          completedToday: completedTasks.rows,
          inProgress: openTasks.rows,
          assigned: openTasks.rows,
          review: [],
          blocked: [],
          drafts: draftTasks.rows,
          activity: {
            actionCount: Number((activityCountRows.rows[0] as any)?.count ?? 0),
            commentsCount: Number((commentCountRows.rows[0] as any)?.count ?? 0),
          },
        };
      })
    );

    const totalCompleted = standupData.reduce((sum, a) => sum + a.completedToday.length, 0);
    const totalInProgress = standupData.reduce((sum, a) => sum + a.inProgress.length, 0);
    const totalAssigned = standupData.reduce((sum, a) => sum + a.assigned.length, 0);
    const totalReview = standupData.reduce((sum, a) => sum + a.review.length, 0);
    const totalBlocked = standupData.reduce((sum, a) => sum + a.blocked.length, 0);
    const totalActivity = standupData.reduce((sum, a) => sum + a.activity.actionCount, 0);

    const teamAccomplishments = standupData
      .flatMap(a => a.completedToday.map(task => ({ ...(task as any), agent: a.agent.name })))
      .sort((a: any, b: any) => (b.updated_at || '').localeCompare(a.updated_at || ''));

    const teamBlockers = standupData
      .flatMap(a => a.blocked.map(task => ({ ...(task as any), agent: a.agent.name })));

    const standupReport = {
      date: targetDate,
      generatedAt: new Date().toISOString(),
      summary: {
        totalAgents: agentRows.length,
        totalCompleted,
        totalInProgress,
        totalAssigned,
        totalReview,
        totalBlocked,
        totalActivity,
        overdue: 0,
      },
      agentReports: standupData,
      teamAccomplishments: teamAccomplishments.slice(0, 10),
      teamBlockers,
      overdueTasks: [],
    };

    const createdAt = Math.floor(Date.now() / 1000);
    await db
      .insert(standupReports)
      .values({ date: targetDate, report: JSON.stringify(standupReport), created_at: createdAt })
      .onConflictDoUpdate({ target: standupReports.date, set: { report: JSON.stringify(standupReport), created_at: createdAt } });

    await db_helpers.logActivity(
      'standup_generated',
      'standup',
      0,
      'system',
      `Generated daily standup for ${targetDate}`,
      { date: targetDate, agentCount: agentRows.length }
    );

    return NextResponse.json({ standup: standupReport });
  } catch (error) {
    console.error('POST /api/standup/generate error:', error);
    return NextResponse.json({ error: 'Failed to generate standup' }, { status: 500 });
  }
}

/**
 * GET /api/standup/history - Get previous standup reports
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 200);
    const offset = parseInt(searchParams.get('offset') || '0');

    const standupRows = await db
      .select()
      .from(standupReports)
      .orderBy(desc(standupReports.created_at))
      .limit(limit)
      .offset(offset);

    const standupHistory = standupRows.map((row, index) => {
      const report = row.report ? JSON.parse(row.report) : {};
      return {
        id: `${row.date}-${index}`,
        date: row.date || report.date || 'Unknown',
        generatedAt: report.generatedAt || new Date((row.created_at ?? 0) * 1000).toISOString(),
        summary: report.summary || {},
        agentCount: report.summary?.totalAgents || 0,
      };
    });

    const countRows = await db.execute(sql`SELECT COUNT(*) as total FROM standup_reports`);
    const total = Number((countRows.rows[0] as any)?.total ?? 0);

    return NextResponse.json({ history: standupHistory, total, page: Math.floor(offset / limit) + 1, limit });
  } catch (error) {
    console.error('GET /api/standup/history error:', error);
    return NextResponse.json({ error: 'Failed to fetch standup history' }, { status: 500 });
  }
}
