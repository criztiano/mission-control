import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { db_helpers } from '@/lib/db';
import { agents } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { config } from '@/lib/config';
import { resolveWithin } from '@/lib/paths';
import { getUserFromRequest, requireRole } from '@/lib/auth';
import { getAgentWorkspace, readWorkspaceFile, writeWorkspaceFile } from '@/lib/agent-workspace';

/**
 * GET /api/agents/[id]/soul - Get agent's SOUL content
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const resolvedParams = await params;
    const agentId = resolvedParams.id;

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

    // Try disk first
    let soulContent: string | null = null;
    let source: 'disk' | 'db' = 'db';
    const workspace = await getAgentWorkspace(agentId);

    if (workspace) {
      const diskContent = readWorkspaceFile(workspace, 'SOUL.md');
      if (diskContent !== null) {
        soulContent = diskContent;
        source = 'disk';
      }
    }

    // Fall back to DB
    if (soulContent === null) {
      soulContent = agent.soul_content || '';
    }

    const templatesPath = config.soulTemplatesDir;
    let availableTemplates: string[] = [];

    try {
      if (templatesPath && existsSync(templatesPath)) {
        const files = readdirSync(templatesPath);
        availableTemplates = files
          .filter(file => file.endsWith('.md'))
          .map(file => file.replace('.md', ''));
      }
    } catch (error) {
      console.warn('Could not read soul templates directory:', error);
    }

    return NextResponse.json({
      agent: {
        id: agent.id,
        name: agent.name,
        role: agent.role
      },
      soul_content: soulContent,
      source,
      workspace: workspace || null,
      available_templates: availableTemplates,
      updated_at: agent.updated_at
    });
  } catch (error) {
    console.error('GET /api/agents/[id]/soul error:', error);
    return NextResponse.json({ error: 'Failed to fetch SOUL content' }, { status: 500 });
  }
}

/**
 * PUT /api/agents/[id]/soul - Update agent's SOUL content
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const resolvedParams = await params;
    const agentId = resolvedParams.id;
    const body = await request.json();
    const { soul_content, template_name } = body;

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

    let newSoulContent = soul_content;

    if (template_name) {
      if (!config.soulTemplatesDir) {
        return NextResponse.json({ error: 'Templates directory not configured' }, { status: 500 });
      }
      let templatePath: string;
      try {
        templatePath = resolveWithin(config.soulTemplatesDir, `${template_name}.md`);
      } catch (pathError) {
        return NextResponse.json({ error: 'Invalid template name' }, { status: 400 });
      }

      try {
        if (existsSync(templatePath)) {
          const templateContent = readFileSync(templatePath, 'utf8');
          newSoulContent = templateContent
            .replace(/{{AGENT_NAME}}/g, agent.name)
            .replace(/{{AGENT_ROLE}}/g, agent.role)
            .replace(/{{TIMESTAMP}}/g, new Date().toISOString());
        } else {
          return NextResponse.json({ error: 'Template not found' }, { status: 404 });
        }
      } catch (error) {
        console.error('Error loading soul template:', error);
        return NextResponse.json({ error: 'Failed to load template' }, { status: 500 });
      }
    }

    // Write to disk first
    let wroteToFile = false;
    const workspace = await getAgentWorkspace(agentId);
    if (workspace) {
      try {
        writeWorkspaceFile(workspace, 'SOUL.md', newSoulContent);
        wroteToFile = true;
      } catch (err) {
        console.error('Failed to write SOUL.md to disk:', err);
      }
    }

    const now = Math.floor(Date.now() / 1000);

    await db.update(agents).set({ soul_content: newSoulContent, updated_at: now }).where(eq(agents.id, agent.id));

    await db_helpers.logActivity(
      'agent_soul_updated',
      'agent',
      agent.id,
      getUserFromRequest(request)?.username || 'system',
      `SOUL content updated for agent ${agent.name}${template_name ? ` using template: ${template_name}` : ''}`,
      {
        template_used: template_name || null,
        content_length: newSoulContent ? newSoulContent.length : 0,
        previous_content_length: agent.soul_content ? agent.soul_content.length : 0,
        wrote_to_disk: wroteToFile,
      }
    );

    return NextResponse.json({
      success: true,
      message: `SOUL content updated for ${agent.name}`,
      soul_content: newSoulContent,
      source: wroteToFile ? 'disk' : 'db',
      updated_at: now
    });
  } catch (error) {
    console.error('PUT /api/agents/[id]/soul error:', error);
    return NextResponse.json({ error: 'Failed to update SOUL content' }, { status: 500 });
  }
}

/**
 * PATCH /api/agents/[id]/soul - Get available SOUL templates
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { searchParams } = new URL(request.url);
    const templateName = searchParams.get('template');

    const templatesPath = config.soulTemplatesDir;

    if (!templatesPath || !existsSync(templatesPath)) {
      return NextResponse.json({
        templates: [],
        message: 'Templates directory not found'
      });
    }

    if (templateName) {
      let templatePath: string;
      try {
        templatePath = resolveWithin(templatesPath, `${templateName}.md`);
      } catch (pathError) {
        return NextResponse.json({ error: 'Invalid template name' }, { status: 400 });
      }

      if (!existsSync(templatePath)) {
        return NextResponse.json({ error: 'Template not found' }, { status: 404 });
      }

      const templateContent = readFileSync(templatePath, 'utf8');

      return NextResponse.json({
        template_name: templateName,
        content: templateContent
      });
    }

    const files = readdirSync(templatesPath);
    const templates = files
      .filter(file => file.endsWith('.md'))
      .map(file => {
        const name = file.replace('.md', '');
        const templatePath = join(templatesPath, file);
        const content = readFileSync(templatePath, 'utf8');

        const firstLine = content.split('\n')[0];
        const description = firstLine.startsWith('#')
          ? firstLine.replace(/^#+\s*/, '')
          : `${name} template`;

        return {
          name,
          description,
          size: content.length
        };
      });

    return NextResponse.json({ templates });
  } catch (error) {
    console.error('PATCH /api/agents/[id]/soul error:', error);
    return NextResponse.json({ error: 'Failed to fetch templates' }, { status: 500 });
  }
}
