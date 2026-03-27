import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { db_helpers, logAuditEvent } from '@/lib/db';
import { agents, issues } from '@/db/schema';
import { eq, and, desc, sql, SQL } from 'drizzle-orm';
import { eventBus } from '@/lib/event-bus';
import { getTemplate, buildAgentConfig } from '@/lib/agent-templates';
import { writeAgentToConfig } from '@/lib/agent-sync';
import { getUserFromRequest, requireRole } from '@/lib/auth';
import { mutationLimiter } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { validateBody, createAgentSchema } from '@/lib/validation';

/**
 * GET /api/agents - List all agents with optional filtering
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const role = searchParams.get('role');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
    const offset = parseInt(searchParams.get('offset') || '0');

    const conditions: SQL[] = [];
    if (status) conditions.push(eq(agents.status, status));
    if (role) conditions.push(eq(agents.role, role));

    const agentRows = await db
      .select()
      .from(agents)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(agents.created_at))
      .limit(limit)
      .offset(offset);

    const agentsWithParsedData = agentRows.map(agent => ({
      ...agent,
      config: agent.config ? JSON.parse(agent.config) : {}
    }));

    // Get task counts from issues table — single GROUP BY query instead of N queries
    const agentNames = agentRows.map(a => a.name.toLowerCase());
    // NOTE: Drizzle expands JS arrays in sql`` as ($1,$2,...) — a record/tuple, NOT a text[].
    // ANY(($1,$2,...)::text[]) fails with "cannot cast type record to text[]".
    // Use IN with individual sql`` params instead.
    const taskStatsRows = agentNames.length > 0
      ? await db.execute(sql`
          SELECT
            LOWER(assignee) as agent_name,
            COUNT(*) as total,
            SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as assigned,
            SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as in_progress,
            SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as completed
          FROM issues
          WHERE LOWER(assignee) IN (${sql.join(agentNames.map(n => sql`${n}`), sql`, `)}) AND archived = false
          GROUP BY LOWER(assignee)
        `)
      : { rows: [] };
    const taskStatsMap = new Map<string, { total: number; assigned: number; in_progress: number; completed: number }>();
    for (const row of taskStatsRows.rows as any[]) {
      taskStatsMap.set(row.agent_name, {
        total: Number(row.total || 0),
        assigned: Number(row.assigned || 0),
        in_progress: Number(row.in_progress || 0),
        completed: Number(row.completed || 0),
      });
    }

    const agentsWithStats = agentsWithParsedData.map(agent => ({
      ...agent,
      // Truncate soul_content in list view — full text available via GET /api/agents/[id]
      soul_content: agent.soul_content && agent.soul_content.length > 200
        ? agent.soul_content.slice(0, 200) + '…'
        : agent.soul_content,
      taskStats: taskStatsMap.get(agent.name.toLowerCase()) ?? {
        total: 0, assigned: 0, in_progress: 0, completed: 0,
      },
    }));

    // Total count
    const countRows = await db.select({ total: sql<number>`count(*)::int` }).from(agents)
      .where(conditions.length ? and(...conditions) : undefined);
    const total = countRows[0]?.total ?? 0;

    return NextResponse.json({
      agents: agentsWithStats,
      total,
      page: Math.floor(offset / limit) + 1,
      limit
    });
  } catch (error) {
    logger.error({ err: error }, 'GET /api/agents error');
    return NextResponse.json({ error: 'Failed to fetch agents' }, { status: 500 });
  }
}

/**
 * POST /api/agents - Create a new agent
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateCheck = mutationLimiter(request);
  if (rateCheck) return rateCheck;

  try {
    const validated = await validateBody(request, createAgentSchema);
    if ('error' in validated) return validated.error;
    const body = validated.data;

    const {
      name,
      role,
      session_key,
      soul_content,
      status = 'offline',
      config = {},
      template,
      gateway_config,
      write_to_gateway
    } = body;

    let finalRole = role;
    let finalConfig: Record<string, any> = { ...config };
    if (template) {
      const tpl = getTemplate(template);
      if (tpl) {
        const builtConfig = buildAgentConfig(tpl, (gateway_config || {}) as any);
        finalConfig = { ...builtConfig, ...finalConfig };
        if (!finalRole) finalRole = tpl.config.identity?.theme || tpl.type;
      }
    } else if (gateway_config) {
      finalConfig = { ...finalConfig, ...(gateway_config as Record<string, any>) };
    }

    if (!name || !finalRole) {
      return NextResponse.json({ error: 'Name and role are required' }, { status: 400 });
    }

    // Check if agent name exists
    const existingRows = await db.select({ id: agents.id }).from(agents).where(eq(agents.name, name)).limit(1);
    if (existingRows.length > 0) {
      return NextResponse.json({ error: 'Agent name already exists' }, { status: 409 });
    }

    const now = Math.floor(Date.now() / 1000);

    const result = await db.insert(agents).values({
      name,
      role: finalRole,
      session_key: session_key ?? null,
      soul_content: soul_content ?? null,
      status,
      created_at: now,
      updated_at: now,
      config: JSON.stringify(finalConfig)
    }).returning();

    const createdAgent = result[0];
    const agentId = createdAgent.id;

    await db_helpers.logActivity(
      'agent_created',
      'agent',
      agentId,
      getUserFromRequest(request)?.username || 'system',
      `Created agent: ${name} (${finalRole})${template ? ` from template: ${template}` : ''}`,
      { name, role: finalRole, status, session_key, template: template || null }
    );
    const parsedAgent = {
      ...createdAgent,
      config: JSON.parse(createdAgent.config || '{}'),
      taskStats: { total: 0, assigned: 0, in_progress: 0, completed: 0 }
    };

    eventBus.broadcast('agent.created', parsedAgent);

    if (write_to_gateway && finalConfig) {
      try {
        const openclawId = (name || 'agent').toLowerCase().replace(/\s+/g, '-');
        await writeAgentToConfig({
          id: openclawId,
          name,
          ...(finalConfig.model && { model: finalConfig.model }),
          ...(finalConfig.identity && { identity: finalConfig.identity }),
          ...(finalConfig.sandbox && { sandbox: finalConfig.sandbox }),
          ...(finalConfig.tools && { tools: finalConfig.tools }),
          ...(finalConfig.subagents && { subagents: finalConfig.subagents }),
          ...(finalConfig.memorySearch && { memorySearch: finalConfig.memorySearch }),
        });

        const ipAddress = request.headers.get('x-forwarded-for') || 'unknown';
        await logAuditEvent({
          action: 'agent_gateway_create',
          actor: getUserFromRequest(request)?.username || 'system',
          target_type: 'agent',
          target_id: agentId,
          detail: { name, openclaw_id: openclawId, template: template || null },
          ip_address: ipAddress,
        });
      } catch (gwErr: any) {
        logger.error({ err: gwErr }, 'Gateway write-back failed');
        return NextResponse.json({
          agent: parsedAgent,
          warning: `Agent created in MC but gateway write failed: ${gwErr.message}`
        }, { status: 201 });
      }
    }

    return NextResponse.json({ agent: parsedAgent }, { status: 201 });
  } catch (error) {
    logger.error({ err: error }, 'POST /api/agents error');
    return NextResponse.json({ error: 'Failed to create agent' }, { status: 500 });
  }
}

/**
 * PUT /api/agents - Update agent status
 */
export async function PUT(request: NextRequest) {
  const auth = await requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateCheck = mutationLimiter(request);
  if (rateCheck) return rateCheck;

  try {
    const body = await request.json();

    if (!body.name) {
      return NextResponse.json({ error: 'Agent name is required' }, { status: 400 });
    }

    const { name, status, last_activity, config, session_key, soul_content, role } = body;

    const agentRows = await db.select().from(agents).where(eq(agents.name, name)).limit(1);
    const agent = agentRows[0];
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const now = Math.floor(Date.now() / 1000);
    const updateData: any = { updated_at: now };

    if (status !== undefined) {
      updateData.status = status;
      updateData.last_seen = now;
    }
    if (last_activity !== undefined) updateData.last_activity = last_activity;
    if (config !== undefined) updateData.config = JSON.stringify(config);
    if (session_key !== undefined) updateData.session_key = session_key;
    if (soul_content !== undefined) updateData.soul_content = soul_content;
    if (role !== undefined) updateData.role = role;

    if (Object.keys(updateData).length === 1) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    await db.update(agents).set(updateData).where(eq(agents.name, name));

    if (status !== undefined && status !== agent.status) {
      await db_helpers.logActivity(
        'agent_status_change',
        'agent',
        agent.id,
        name,
        `Agent status changed from ${agent.status} to ${status}`,
        { oldStatus: agent.status, newStatus: status, last_activity }
      );
    }

    eventBus.broadcast('agent.updated', {
      id: agent.id,
      name,
      ...(status !== undefined && { status }),
      ...(last_activity !== undefined && { last_activity }),
      ...(role !== undefined && { role }),
      updated_at: now,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, 'PUT /api/agents error');
    return NextResponse.json({ error: 'Failed to update agent' }, { status: 500 });
  }
}
