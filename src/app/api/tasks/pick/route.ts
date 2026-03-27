import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { setTaskPicked, getTurns, parseBlockedBy, getOpenBlockerIds } from '@/lib/cc-db';
import { db } from '@/db/client';
import { sql } from 'drizzle-orm';

/**
 * POST /api/tasks/pick — automatic task assignment
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json().catch(() => ({}));
    const agent = body.agent;

    if (!agent || typeof agent !== 'string') {
      return NextResponse.json({ error: 'agent is required — identify yourself' }, { status: 400 });
    }

    const assignees: string[] = [agent.toLowerCase()];
    if (agent.toLowerCase() === 'ralph') {
      assignees.push('cody');
    }

    // Use individual bound parameters instead of sql.raw() to avoid injection risk
    const assigneeParams = sql.join(assignees.map(a => sql`${a}`), sql`, `);

    const candidateRows = await db.execute(sql`
      SELECT * FROM issues
      WHERE status = 'open'
        AND LOWER(assignee) IN (${assigneeParams})
        AND (picked = false OR picked IS NULL)
        AND archived = false
      ORDER BY
        CASE priority
          WHEN 'urgent' THEN 1
          WHEN 'high' THEN 2
          WHEN 'normal' THEN 3
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
          ELSE 5
        END,
        created_at ASC
      LIMIT 20
    `);

    const candidates = candidateRows.rows as Record<string, unknown>[];

    const allBlockerIds = new Set<string>();
    for (const c of candidates) {
      for (const bid of parseBlockedBy(c.blocked_by as string)) allBlockerIds.add(bid);
    }
    const openBlockers = await getOpenBlockerIds([...allBlockerIds]);

    const issue = candidates.find(c => {
      const blockers = parseBlockedBy(c.blocked_by as string);
      return blockers.length === 0 || !blockers.some(bid => openBlockers.has(bid));
    });

    if (!issue) {
      return new NextResponse(null, { status: 204 });
    }

    const taskId = issue.id as string;

    await setTaskPicked(taskId, agent);

    const turns = await getTurns(taskId);

    const description = (issue.description as string) || '';
    const hasDescription = description.trim().length > 0;
    const needsRefinement = turns.length === 0 && !hasDescription;

    return NextResponse.json({
      id: taskId,
      title: issue.title as string,
      description,
      status: issue.status as string,
      assignee: issue.assignee as string,
      priority: issue.priority as string,
      plan_path: (issue.plan_path as string) || null,
      turns,
      needs_refinement: needsRefinement,
    });
  } catch (error) {
    logger.error({ err: error }, 'POST /api/tasks/pick error');
    return NextResponse.json({ error: 'Failed to pick task' }, { status: 500 });
  }
}
