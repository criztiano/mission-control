import { NextRequest, NextResponse } from 'next/server';
import { db_helpers } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { db } from '@/db/client';
import { agents, standupReports } from '@/db/schema';
import { inArray, desc, asc, sql } from 'drizzle-orm';

/**
 * POST /api/standup/generate - Generate daily standup report
 * N+1 fix: was 1 + (N_agents × 5) queries. Now always 6 queries regardless of agent count.
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

    // Query 1: get agent list
    let agentRows;
    if (specificAgents && Array.isArray(specificAgents) && specificAgents.length > 0) {
      agentRows = await db.select().from(agents).where(inArray(agents.name, specificAgents)).orderBy(asc(agents.name));
    } else {
      agentRows = await db.select().from(agents).orderBy(asc(agents.name));
    }

    if (agentRows.length === 0) {
      return NextResponse.json({ standup: { date: targetDate, generatedAt: new Date().toISOString(), summary: { totalAgents: 0 }, agentReports: [], teamAccomplishments: [], teamBlockers: [], overdueTasks: [] } });
    }

    const agentNames = agentRows.map(a => a.name);
    const agentNamesParam = sql.join(agentNames.map(n => sql`${n}`), sql`, `);

    // Queries 2-6: batch across all agents in one shot each
    const [completedRows, openRows, draftRows, activityCounts, commentCounts] = await Promise.all([
      // Query 2: completed tasks today, all agents
      db.execute(sql`
        SELECT assignee, id, title, status, updated_at FROM issues
        WHERE assignee IN (${agentNamesParam}) AND archived = false AND status = 'closed'
          AND updated_at BETWEEN ${startOfDayISO} AND ${endOfDayISO}
        ORDER BY assignee, updated_at DESC
      `),
      // Query 3: open tasks, all agents
      db.execute(sql`
        SELECT assignee, id, title, status, created_at, priority FROM issues
        WHERE assignee IN (${agentNamesParam}) AND archived = false AND status = 'open'
        ORDER BY assignee, created_at ASC
      `),
      // Query 4: draft tasks, all agents
      db.execute(sql`
        SELECT assignee, id, title, status, created_at, priority FROM issues
        WHERE assignee IN (${agentNamesParam}) AND archived = false AND status = 'draft'
        ORDER BY assignee, created_at ASC
      `),
      // Query 5: activity counts today, all agents
      db.execute(sql`
        SELECT actor, COUNT(*) as count FROM activities
        WHERE actor IN (${agentNamesParam}) AND created_at BETWEEN ${startOfDayUnix} AND ${endOfDayUnix}
        GROUP BY actor
      `),
      // Query 6: comment counts today, all agents
      db.execute(sql`
        SELECT author, COUNT(*) as count FROM comments
        WHERE author IN (${agentNamesParam}) AND created_at BETWEEN ${startOfDayUnix} AND ${endOfDayUnix}
        GROUP BY author
      `),
    ]);

    // Group results by agent name in memory
    type TaskRow = { assignee: string; id: string; title: string; status: string; updated_at?: string; created_at?: string; priority?: string };
    const completedByAgent = new Map<string, TaskRow[]>();
    const openByAgent = new Map<string, TaskRow[]>();
    const draftByAgent = new Map<string, TaskRow[]>();
    for (const row of completedRows.rows as TaskRow[]) {
      const arr = completedByAgent.get(row.assignee) ?? [];
      arr.push(row);
      completedByAgent.set(row.assignee, arr);
    }
    for (const row of openRows.rows as TaskRow[]) {
      const arr = openByAgent.get(row.assignee) ?? [];
      arr.push(row);
      openByAgent.set(row.assignee, arr);
    }
    for (const row of draftRows.rows as TaskRow[]) {
      const arr = draftByAgent.get(row.assignee) ?? [];
      arr.push(row);
      draftByAgent.set(row.assignee, arr);
    }
    const activityCountMap = new Map<string, number>();
    for (const row of activityCounts.rows as any[]) {
      activityCountMap.set(row.actor, Number(row.count ?? 0));
    }
    const commentCountMap = new Map<string, number>();
    for (const row of commentCounts.rows as any[]) {
      commentCountMap.set(row.author, Number(row.count ?? 0));
    }

    // Build per-agent report from maps — no DB calls
    const standupData = agentRows.map((agent) => ({
      agent: {
        name: agent.name,
        role: agent.role,
        status: agent.status,
        last_seen: agent.last_seen,
        last_activity: agent.last_activity,
      },
      completedToday: completedByAgent.get(agent.name) ?? [],
      inProgress: openByAgent.get(agent.name) ?? [],
      assigned: openByAgent.get(agent.name) ?? [],
      review: [],
      blocked: [],
      drafts: draftByAgent.get(agent.name) ?? [],
      activity: {
        actionCount: activityCountMap.get(agent.name) ?? 0,
        commentsCount: commentCountMap.get(agent.name) ?? 0,
      },
    }));

    const totalCompleted = standupData.reduce((sum, a) => sum + a.completedToday.length, 0);
    const totalInProgress = standupData.reduce((sum, a) => sum + a.inProgress.length, 0);
    const totalAssigned = standupData.reduce((sum, a) => sum + a.assigned.length, 0);
    const totalReview = 0;
    const totalBlocked = 0;
    const totalActivity = standupData.reduce((sum, a) => sum + a.activity.actionCount, 0);

    const teamAccomplishments = standupData
      .flatMap(a => a.completedToday.map(task => ({ ...task, agent: a.agent.name })))
      .sort((a: any, b: any) => (b.updated_at || '').localeCompare(a.updated_at || ''));

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
      teamBlockers: [],
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

    // Parallelize rows + count (independent queries)
    const [standupRows, countRows] = await Promise.all([
      db.select()
        .from(standupReports)
        .orderBy(desc(standupReports.created_at))
        .limit(limit)
        .offset(offset),
      db.execute(sql`SELECT COUNT(*) as total FROM standup_reports`),
    ]);

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

    const total = Number((countRows.rows[0] as any)?.total ?? 0);

    return NextResponse.json({ history: standupHistory, total, page: Math.floor(offset / limit) + 1, limit });
  } catch (error) {
    console.error('GET /api/standup/history error:', error);
    return NextResponse.json({ error: 'Failed to fetch standup history' }, { status: 500 });
  }
}
