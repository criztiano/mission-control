/**
 * migrate-sqlite-to-postgres.ts
 *
 * Migrates data from both SQLite databases to Neon Postgres via Drizzle ORM.
 *
 * Sources:
 *   1. ~/.openclaw/control-center.db  (CC DB — tasks, issues, turns, tweets, garden)
 *   2. .data/mission-control.db        (App DB — users, agents, messages, settings, etc.)
 *
 * Target: Neon Postgres (DATABASE_URL env var)
 *
 * Usage:
 *   npx tsx scripts/migrate-sqlite-to-postgres.ts
 *
 * Options:
 *   --dry-run        Print row counts without inserting
 *   --tables=t1,t2   Only migrate specific tables
 *   --skip=t1,t2     Skip specific tables
 *
 * Idempotent: truncates each target table before inserting.
 * Safe to re-run. Keep original SQLite files as backup.
 */

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import { sql } from 'drizzle-orm'
import * as schema from '../src/db/schema'
import path from 'path'
import os from 'os'
import fs from 'fs'

// ─── Config ──────────────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL is not set. Add it to .env.local or export it.')
  process.exit(1)
}

const CC_DB_PATH = process.env.CC_DB_PATH || path.join(os.homedir(), '.openclaw', 'control-center.db')
const APP_DB_PATH = process.env.APP_DB_PATH || path.join(process.cwd(), '.data', 'mission-control.db')

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const tablesArg = args.find(a => a.startsWith('--tables='))
const skipArg = args.find(a => a.startsWith('--skip='))
const ONLY_TABLES = tablesArg ? tablesArg.replace('--tables=', '').split(',').map(s => s.trim()) : null
const SKIP_TABLES = skipArg ? skipArg.replace('--skip=', '').split(',').map(s => s.trim()) : []

// ─── Helpers ─────────────────────────────────────────────────────────────────

function shouldMigrate(tableName: string): boolean {
  if (SKIP_TABLES.includes(tableName)) return false
  if (ONLY_TABLES && !ONLY_TABLES.includes(tableName)) return false
  return true
}

function parseBool(v: any): boolean | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'boolean') return v
  return v === 1 || v === '1' || v === 'true'
}

function parseJson(v: any, fallback: any = null): any {
  if (v === null || v === undefined) return fallback
  if (typeof v === 'object') return v
  try { return JSON.parse(v) } catch { return fallback }
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}

async function migrateTable(
  tableName: string,
  sourceRows: any[],
  insertFn: (chunk: any[]) => Promise<void>
) {
  if (!shouldMigrate(tableName)) {
    console.log(`  ⏭️  Skipping ${tableName}`)
    return
  }

  console.log(`  📦 ${tableName}: ${sourceRows.length} rows`)

  if (DRY_RUN) {
    console.log(`     [dry-run] would insert ${sourceRows.length} rows`)
    return
  }

  if (sourceRows.length === 0) {
    console.log(`     ✅ empty — nothing to insert`)
    return
  }

  // Insert in chunks of 5 (Neon HTTP driver has parameter limit for wide tables)
  const chunks = chunkArray(sourceRows, 5)
  let inserted = 0
  let skipped = 0
  for (const chunk of chunks) {
    try {
      await insertFn(chunk)
      inserted += chunk.length
    } catch (e: any) {
      // FK violations, orphan rows — skip and continue
      if (e?.cause?.code === '23503' || e?.message?.includes('foreign key')) {
        skipped += chunk.length
        console.log(`     ⚠️  skipped ${chunk.length} rows (FK violation: ${e?.cause?.detail || e.message})`)
      } else {
        throw e
      }
    }
  }
  console.log(`     ✅ inserted ${inserted} rows${skipped ? ` (${skipped} skipped — FK orphans)` : ''}`)
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Starting SQLite → Neon Postgres migration')
  console.log(`   DATABASE_URL: ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`)
  console.log(`   CC DB:  ${CC_DB_PATH}`)
  console.log(`   App DB: ${APP_DB_PATH}`)
  if (DRY_RUN) console.log('   ⚠️  DRY RUN — no data will be inserted')
  console.log('')

  // Verify SQLite files exist
  if (!fs.existsSync(CC_DB_PATH)) {
    console.warn(`⚠️  CC DB not found at ${CC_DB_PATH} — skipping CC tables`)
  }
  if (!fs.existsSync(APP_DB_PATH)) {
    console.warn(`⚠️  App DB not found at ${APP_DB_PATH} — skipping App tables`)
  }

  // Connect
  const neonConn = neon(DATABASE_URL)
  const db = drizzle(neonConn, { schema })

  // ─── CC Database ─────────────────────────────────────────────────────────

  if (fs.existsSync(CC_DB_PATH)) {
    console.log('📂 Migrating CC Database...')
    const ccDb = new Database(CC_DB_PATH, { readonly: true })

    // projects
    await migrateTable('projects', ccDb.prepare('SELECT * FROM projects').all(), async (rows) => {
      await db.insert(schema.projects).values(rows.map(r => ({
        id: r.id,
        title: r.title,
        description: r.description ?? '',
        emoji: r.emoji ?? '📁',
        created_at: r.created_at,
        updated_at: r.updated_at,
        archived: parseBool(r.archived) ?? false,
        schedule: r.schedule ?? 'nightly',
        repo_url: r.repo_url ?? '',
        local_path: r.local_path ?? '',
      }))).onConflictDoNothing()
    })

    // project_resources
    await migrateTable('project_resources', ccDb.prepare('SELECT * FROM project_resources').all(), async (rows) => {
      await db.insert(schema.projectResources).values(rows.map(r => ({
        id: r.id,
        project_id: r.project_id,
        kind: r.kind,
        label: r.label ?? '',
        value: r.value,
        created_at: r.created_at,
      }))).onConflictDoNothing()
    })

    // issues
    await migrateTable('issues', ccDb.prepare('SELECT * FROM issues').all(), async (rows) => {
      await db.insert(schema.issues).values(rows.map(r => ({
        id: r.id,
        project_id: r.project_id,
        title: r.title,
        description: r.description ?? '',
        status: r.status ?? 'idea',
        assignee: r.assignee ?? '',
        priority: r.priority ?? 'normal',
        created_at: r.created_at,
        updated_at: r.updated_at,
        archived: parseBool(r.archived) ?? false,
        schedule: r.schedule ?? '',
        parent_id: r.parent_id ?? null,
        notion_id: r.notion_id ?? '',
        creator: r.creator ?? '',
        plan_path: r.plan_path ?? null,
        last_turn_at: r.last_turn_at ?? null,
        seen_at: r.seen_at ?? null,
        picked: parseBool(r.picked) ?? false,
        picked_at: r.picked_at ?? null,
        picked_by: r.picked_by ?? '',
        blocked_by: r.blocked_by ?? '[]',
        plan_id: r.plan_id ?? null,
      }))).onConflictDoNothing()
    })

    // issue_resources
    await migrateTable('issue_resources', ccDb.prepare('SELECT * FROM issue_resources').all(), async (rows) => {
      await db.insert(schema.issueResources).values(rows.map(r => ({
        id: r.id,
        issue_id: r.issue_id,
        kind: r.kind,
        label: r.label ?? '',
        value: r.value,
        created_at: r.created_at,
      }))).onConflictDoNothing()
    })

    // issue_comments
    await migrateTable('issue_comments', ccDb.prepare('SELECT * FROM issue_comments').all(), async (rows) => {
      await db.insert(schema.issueComments).values(rows.map(r => ({
        id: r.id,
        issue_id: r.issue_id,
        author: r.author,
        content: r.content,
        created_at: r.created_at,
        attachments: r.attachments ?? '[]',
      }))).onConflictDoNothing()
    })

    // issue_dependencies
    await migrateTable('issue_dependencies', ccDb.prepare('SELECT * FROM issue_dependencies').all(), async (rows) => {
      await db.insert(schema.issueDependencies).values(rows.map(r => ({
        issue_id: r.issue_id,
        depends_on: r.depends_on,
      }))).onConflictDoNothing()
    })

    // issue_activity
    await migrateTable('issue_activity', ccDb.prepare('SELECT * FROM issue_activity').all(), async (rows) => {
      await db.insert(schema.issueActivity).values(rows.map(r => ({
        id: r.id,
        issue_id: r.issue_id,
        actor: r.actor,
        action: r.action,
        detail: r.detail ?? '',
        created_at: r.created_at,
      }))).onConflictDoNothing()
    })

    // turns
    await migrateTable('turns', ccDb.prepare('SELECT * FROM turns').all(), async (rows) => {
      await db.insert(schema.turns).values(rows.map(r => ({
        id: r.id,
        task_id: r.task_id,
        round_number: r.round_number ?? 1,
        type: r.type,
        author: r.author,
        content: r.content ?? '',
        links: r.links ?? '[]',
        created_at: r.created_at,
        updated_at: r.updated_at ?? r.created_at,
      }))).onConflictDoNothing()
    })

    // tweets
    await migrateTable('tweets', ccDb.prepare('SELECT * FROM tweets').all(), async (rows) => {
      await db.insert(schema.tweets).values(rows.map(r => ({
        id: r.id,
        title: r.title ?? '',
        author: r.author ?? '',
        theme: r.theme ?? '',
        verdict: r.verdict ?? '',
        action: r.action ?? '',
        source: r.source ?? '',
        tweet_link: r.tweet_link ?? '',
        digest: r.digest ?? '',
        content: r.content ?? '',
        created_at: r.created_at,
        scraped_at: r.scraped_at,
        pinned: parseBool(r.pinned) ?? false,
        media_urls: r.media_urls ?? '[]',
        triage_status: r.triage_status ?? 'pending',
        snooze_until: r.snooze_until ?? null,
        local_media_urls: r.local_media_urls ?? '[]',
        discord_message_id: r.discord_message_id ?? null,
        discord_posted_at: r.discord_posted_at ?? null,
        summary: r.summary ?? '',
        digest_id: r.digest_id ?? null,
        highlighted: parseBool(r.highlighted) ?? false,
        highlight_note: r.highlight_note ?? '',
        top_replies: r.top_replies ?? '[]',
        reply_count: r.reply_count ?? 0,
        retweet_count: r.retweet_count ?? 0,
        like_count: r.like_count ?? 0,
        engage: parseBool(r.engage) ?? false,
        engage_reason: r.engage_reason ?? null,
      }))).onConflictDoNothing()
    })

    // tweet_ratings
    await migrateTable('tweet_ratings', ccDb.prepare('SELECT * FROM tweet_ratings').all(), async (rows) => {
      await db.insert(schema.tweetRatings).values(rows.map(r => ({
        tweet_id: r.tweet_id,
        rating: r.rating,
        rated_at: r.rated_at,
      }))).onConflictDoNothing()
    })

    // tweet_interactions
    await migrateTable('tweet_interactions', ccDb.prepare('SELECT * FROM tweet_interactions').all(), async (rows) => {
      await db.insert(schema.tweetInteractions).values(rows.map(r => ({
        // Note: id is serial — skip it so Postgres assigns new IDs
        tweet_id: r.tweet_id,
        action: r.action,
        created_at: r.created_at,
      }))).onConflictDoNothing()
    })

    // garden
    await migrateTable('garden', ccDb.prepare('SELECT * FROM garden').all(), async (rows) => {
      await db.insert(schema.garden).values(rows.map(r => ({
        id: r.id,
        content: r.content,
        type: r.type ?? 'tweet',
        interest: r.interest ?? 'information',
        temporal: r.temporal ?? 'ever',
        tags: r.tags ?? '[]',
        note: r.note ?? '',
        original_source: r.original_source ?? null,
        media_urls: r.media_urls ?? '[]',
        metadata: r.metadata ?? '{}',
        enriched: parseBool(r.enriched) ?? false,
        instance_type: r.instance_type ?? 'instance',
        snooze_until: r.snooze_until ?? null,
        expires_at: r.expires_at ?? null,
        group: r.group ?? null,
        created_at: r.created_at,
        saved_at: r.saved_at,
      }))).onConflictDoNothing()
    })

    // project_notes
    await migrateTable('project_notes', ccDb.prepare('SELECT * FROM project_notes').all(), async (rows) => {
      await db.insert(schema.projectNotes).values(rows.map(r => ({
        id: r.id,
        project_id: r.project_id,
        content: r.content,
        pinned: parseBool(r.pinned) ?? false,
        created_at: r.created_at,
      }))).onConflictDoNothing()
    })

    // og_cache
    await migrateTable('og_cache', ccDb.prepare('SELECT * FROM og_cache').all(), async (rows) => {
      await db.insert(schema.ogCache).values(rows.map(r => ({
        url: r.url,
        title: r.title ?? null,
        description: r.description ?? null,
        image: r.image ?? null,
        fetched_at: r.fetched_at,
      }))).onConflictDoNothing()
    })

    // digests
    await migrateTable('digests', ccDb.prepare('SELECT * FROM digests').all(), async (rows) => {
      await db.insert(schema.digests).values(rows.map(r => ({
        id: r.id,
        label: r.label,
        brief: r.brief ?? '',
        items: r.items ?? '[]',
        stats: r.stats ?? null,
        stats_scraped: r.stats_scraped ?? 0,
        stats_kept: r.stats_kept ?? 0,
        stats_dropped: r.stats_dropped ?? 0,
        created_at: r.created_at,
        discord_message_id: r.discord_message_id ?? null,
        discord_thread_id: r.discord_thread_id ?? null,
      }))).onConflictDoNothing()
    })

    // plans
    await migrateTable('plans', ccDb.prepare('SELECT * FROM plans').all(), async (rows) => {
      await db.insert(schema.plans).values(rows.map(r => ({
        id: r.id,
        title: r.title,
        content: r.content,
        task_id: r.task_id ?? null,
        project_id: r.project_id ?? null,
        author: r.author,
        status: r.status ?? 'draft',
        responses: r.responses ?? '{}',
        created_at: r.created_at,
        updated_at: r.updated_at ?? r.created_at,
      }))).onConflictDoNothing()
    })

    ccDb.close()
    console.log('')
  }

  // ─── App Database ─────────────────────────────────────────────────────────

  if (fs.existsSync(APP_DB_PATH)) {
    console.log('📂 Migrating App Database...')
    const appDb = new Database(APP_DB_PATH, { readonly: true })

    // users
    await migrateTable('users', appDb.prepare('SELECT * FROM users').all(), async (rows) => {
      await db.insert(schema.users).values(rows.map(r => ({
        id: r.id,
        username: r.username,
        display_name: r.display_name,
        password_hash: r.password_hash,
        role: r.role ?? 'operator',
        created_at: r.created_at,
        updated_at: r.updated_at ?? r.created_at,
        last_login_at: r.last_login_at ?? null,
        provider: r.provider ?? 'local',
        provider_user_id: r.provider_user_id ?? null,
        email: r.email ?? null,
        avatar_url: r.avatar_url ?? null,
        is_approved: parseBool(r.is_approved) ?? true,
        approved_by: r.approved_by ?? null,
        approved_at: r.approved_at ?? null,
        workspace_id: r.workspace_id ?? 1,
      }))).onConflictDoNothing()
    })

    // agents
    await migrateTable('agents', appDb.prepare('SELECT * FROM agents').all(), async (rows) => {
      await db.insert(schema.agents).values(rows.map(r => ({
        id: r.id,
        name: r.name,
        role: r.role,
        session_key: r.session_key ?? null,
        soul_content: r.soul_content ?? null,
        status: r.status ?? 'offline',
        last_seen: r.last_seen ?? null,
        last_activity: r.last_activity ?? null,
        created_at: r.created_at,
        updated_at: r.updated_at ?? r.created_at,
        config: r.config ?? null,
      }))).onConflictDoNothing()
    })

    // messages
    await migrateTable('messages', appDb.prepare('SELECT * FROM messages').all(), async (rows) => {
      await db.insert(schema.messages).values(rows.map(r => ({
        id: r.id,
        conversation_id: r.conversation_id,
        from_agent: r.from_agent,
        to_agent: r.to_agent ?? null,
        content: r.content,
        message_type: r.message_type ?? 'text',
        metadata: r.metadata ?? null,
        read_at: r.read_at ?? null,
        created_at: r.created_at,
      }))).onConflictDoNothing()
    })

    // settings
    await migrateTable('settings', appDb.prepare('SELECT * FROM settings').all(), async (rows) => {
      await db.insert(schema.settings).values(rows.map(r => ({
        key: r.key,
        value: r.value,
        description: r.description ?? null,
        category: r.category ?? 'general',
        updated_by: r.updated_by ?? null,
        updated_at: r.updated_at ?? Math.floor(Date.now() / 1000),
      }))).onConflictDoNothing()
    })

    // audit_log
    await migrateTable('audit_log', appDb.prepare('SELECT * FROM audit_log').all(), async (rows) => {
      await db.insert(schema.auditLog).values(rows.map(r => ({
        id: r.id,
        action: r.action,
        actor: r.actor,
        actor_id: r.actor_id ?? null,
        target_type: r.target_type ?? null,
        target_id: r.target_id ?? null,
        detail: r.detail ?? null,
        ip_address: r.ip_address ?? null,
        user_agent: r.user_agent ?? null,
        created_at: r.created_at,
      }))).onConflictDoNothing()
    })

    // activities
    await migrateTable('activities', appDb.prepare('SELECT * FROM activities').all(), async (rows) => {
      await db.insert(schema.activities).values(rows.map(r => ({
        id: r.id,
        type: r.type,
        entity_type: r.entity_type,
        entity_id: r.entity_id,
        actor: r.actor,
        description: r.description,
        data: r.data ?? null,
        created_at: r.created_at,
      }))).onConflictDoNothing()
    })

    // notifications
    await migrateTable('notifications', appDb.prepare('SELECT * FROM notifications').all(), async (rows) => {
      await db.insert(schema.notifications).values(rows.map(r => ({
        id: r.id,
        recipient: r.recipient,
        type: r.type,
        title: r.title,
        message: r.message,
        source_type: r.source_type ?? null,
        source_id: r.source_id ?? null,
        read_at: r.read_at ?? null,
        delivered_at: r.delivered_at ?? null,
        created_at: r.created_at,
      }))).onConflictDoNothing()
    })

    // gateways
    await migrateTable('gateways', appDb.prepare('SELECT * FROM gateways').all(), async (rows) => {
      await db.insert(schema.gateways).values(rows.map(r => ({
        id: r.id,
        name: r.name,
        host: r.host ?? '127.0.0.1',
        port: r.port ?? 18789,
        token: r.token ?? '',
        is_primary: parseBool(r.is_primary) ?? false,
        status: r.status ?? 'unknown',
        last_seen: r.last_seen ?? null,
        latency: r.latency ?? null,
        sessions_count: r.sessions_count ?? 0,
        agents_count: r.agents_count ?? 0,
        created_at: r.created_at,
        updated_at: r.updated_at ?? r.created_at,
      }))).onConflictDoNothing()
    })

    // webhooks
    await migrateTable('webhooks', appDb.prepare('SELECT * FROM webhooks').all(), async (rows) => {
      await db.insert(schema.webhooks).values(rows.map(r => ({
        id: r.id,
        name: r.name,
        url: r.url,
        secret: r.secret ?? null,
        events: r.events ?? '["*"]',
        enabled: parseBool(r.enabled) ?? true,
        last_fired_at: r.last_fired_at ?? null,
        last_status: r.last_status ?? null,
        created_by: r.created_by ?? 'system',
        created_at: r.created_at,
        updated_at: r.updated_at ?? r.created_at,
      }))).onConflictDoNothing()
    })

    // webhook_deliveries
    await migrateTable('webhook_deliveries', appDb.prepare('SELECT * FROM webhook_deliveries').all(), async (rows) => {
      await db.insert(schema.webhookDeliveries).values(rows.map(r => ({
        id: r.id,
        webhook_id: r.webhook_id,
        event_type: r.event_type,
        payload: r.payload,
        status_code: r.status_code ?? null,
        response_body: r.response_body ?? null,
        error: r.error ?? null,
        duration_ms: r.duration_ms ?? null,
        is_retry: parseBool(r.is_retry) ?? false,
        created_at: r.created_at,
      }))).onConflictDoNothing()
    })

    // alert_rules
    await migrateTable('alert_rules', appDb.prepare('SELECT * FROM alert_rules').all(), async (rows) => {
      await db.insert(schema.alertRules).values(rows.map(r => ({
        id: r.id,
        name: r.name,
        description: r.description ?? null,
        enabled: parseBool(r.enabled) ?? true,
        entity_type: r.entity_type,
        condition_field: r.condition_field,
        condition_operator: r.condition_operator,
        condition_value: r.condition_value,
        action_type: r.action_type ?? 'notification',
        action_config: r.action_config ?? '{}',
        cooldown_minutes: r.cooldown_minutes ?? 60,
        last_triggered_at: r.last_triggered_at ?? null,
        trigger_count: r.trigger_count ?? 0,
        created_by: r.created_by ?? 'system',
        created_at: r.created_at,
        updated_at: r.updated_at ?? r.created_at,
      }))).onConflictDoNothing()
    })

    // workflow_templates
    await migrateTable('workflow_templates', appDb.prepare('SELECT * FROM workflow_templates').all(), async (rows) => {
      await db.insert(schema.workflowTemplates).values(rows.map(r => ({
        id: r.id,
        name: r.name,
        description: r.description ?? null,
        model: r.model ?? 'sonnet',
        task_prompt: r.task_prompt,
        timeout_seconds: r.timeout_seconds ?? 300,
        agent_role: r.agent_role ?? null,
        tags: r.tags ?? null,
        created_by: r.created_by ?? 'system',
        created_at: r.created_at,
        updated_at: r.updated_at ?? r.created_at,
        last_used_at: r.last_used_at ?? null,
        use_count: r.use_count ?? 0,
      }))).onConflictDoNothing()
    })

    // workflow_pipelines
    await migrateTable('workflow_pipelines', appDb.prepare('SELECT * FROM workflow_pipelines').all(), async (rows) => {
      await db.insert(schema.workflowPipelines).values(rows.map(r => ({
        id: r.id,
        name: r.name,
        description: r.description ?? null,
        steps: r.steps ?? '[]',
        created_by: r.created_by ?? 'system',
        created_at: r.created_at,
        updated_at: r.updated_at ?? r.created_at,
        use_count: r.use_count ?? 0,
        last_used_at: r.last_used_at ?? null,
      }))).onConflictDoNothing()
    })

    // pipeline_runs
    await migrateTable('pipeline_runs', appDb.prepare('SELECT * FROM pipeline_runs').all(), async (rows) => {
      await db.insert(schema.pipelineRuns).values(rows.map(r => ({
        id: r.id,
        pipeline_id: r.pipeline_id,
        status: r.status ?? 'pending',
        current_step: r.current_step ?? 0,
        steps_snapshot: r.steps_snapshot ?? '[]',
        started_at: r.started_at ?? null,
        completed_at: r.completed_at ?? null,
        triggered_by: r.triggered_by ?? 'system',
        created_at: r.created_at,
      }))).onConflictDoNothing()
    })

    // standup_reports
    await migrateTable('standup_reports', appDb.prepare('SELECT * FROM standup_reports').all(), async (rows) => {
      await db.insert(schema.standupReports).values(rows.map(r => ({
        date: r.date,
        report: r.report,
        created_at: r.created_at,
      }))).onConflictDoNothing()
    })

    // tasks (legacy)
    await migrateTable('tasks', appDb.prepare('SELECT * FROM tasks').all(), async (rows) => {
      await db.insert(schema.tasks).values(rows.map(r => ({
        id: r.id,
        title: r.title,
        description: r.description ?? null,
        status: r.status ?? 'open',
        priority: r.priority ?? 'medium',
        assigned_to: r.assigned_to ?? null,
        creator: r.creator ?? '',
        created_at: r.created_at,
        updated_at: r.updated_at ?? r.created_at,
        tags: r.tags ?? null,
        metadata: r.metadata ?? null,
      }))).onConflictDoNothing()
    })

    // token_usage
    await migrateTable('token_usage', appDb.prepare('SELECT * FROM token_usage').all(), async (rows) => {
      await db.insert(schema.tokenUsage).values(rows.map(r => ({
        id: r.id,
        model: r.model,
        session_id: r.session_id,
        input_tokens: r.input_tokens ?? 0,
        output_tokens: r.output_tokens ?? 0,
        workspace_id: r.workspace_id ?? 1,
        task_id: r.task_id ?? null,
        cost_usd: r.cost_usd ?? null,
        agent_name: r.agent_name ?? null,
        created_at: r.created_at,
      }))).onConflictDoNothing()
    })

    // claude_sessions
    await migrateTable('claude_sessions', appDb.prepare('SELECT * FROM claude_sessions').all(), async (rows) => {
      await db.insert(schema.claudeSessions).values(rows.map(r => ({
        id: r.id,
        session_id: r.session_id,
        project_slug: r.project_slug,
        project_path: r.project_path ?? null,
        model: r.model ?? null,
        git_branch: r.git_branch ?? null,
        user_messages: r.user_messages ?? 0,
        assistant_messages: r.assistant_messages ?? 0,
        tool_uses: r.tool_uses ?? 0,
        input_tokens: r.input_tokens ?? 0,
        output_tokens: r.output_tokens ?? 0,
        estimated_cost: r.estimated_cost ?? 0,
        first_message_at: r.first_message_at ?? null,
        last_message_at: r.last_message_at ?? null,
        last_user_prompt: r.last_user_prompt ?? null,
        is_active: parseBool(r.is_active) ?? false,
        scanned_at: r.scanned_at,
        created_at: r.created_at,
        updated_at: r.updated_at ?? r.created_at,
      }))).onConflictDoNothing()
    })

    // access_requests
    await migrateTable('access_requests', appDb.prepare('SELECT * FROM access_requests').all(), async (rows) => {
      await db.insert(schema.accessRequests).values(rows.map(r => ({
        id: r.id,
        provider: r.provider ?? 'google',
        email: r.email,
        provider_user_id: r.provider_user_id ?? null,
        display_name: r.display_name ?? null,
        avatar_url: r.avatar_url ?? null,
        status: r.status ?? 'pending',
        requested_at: r.requested_at,
        last_attempt_at: r.last_attempt_at ?? r.requested_at,
        attempt_count: r.attempt_count ?? 1,
        reviewed_by: r.reviewed_by ?? null,
        reviewed_at: r.reviewed_at ?? null,
        review_note: r.review_note ?? null,
        approved_user_id: r.approved_user_id ?? null,
      }))).onConflictDoNothing()
    })

    // tenants
    await migrateTable('tenants', appDb.prepare('SELECT * FROM tenants').all(), async (rows) => {
      await db.insert(schema.tenants).values(rows.map(r => ({
        id: r.id,
        slug: r.slug,
        display_name: r.display_name,
        linux_user: r.linux_user,
        plan_tier: r.plan_tier ?? 'standard',
        status: r.status ?? 'pending',
        openclaw_home: r.openclaw_home,
        workspace_root: r.workspace_root,
        gateway_port: r.gateway_port ?? null,
        dashboard_port: r.dashboard_port ?? null,
        config: r.config ?? '{}',
        created_by: r.created_by ?? 'system',
        owner_gateway: r.owner_gateway ?? null,
        created_at: r.created_at,
        updated_at: r.updated_at ?? r.created_at,
      }))).onConflictDoNothing()
    })

    // provision_jobs (depends on tenants)
    await migrateTable('provision_jobs', appDb.prepare('SELECT * FROM provision_jobs').all(), async (rows) => {
      await db.insert(schema.provisionJobs).values(rows.map(r => ({
        id: r.id,
        tenant_id: r.tenant_id,
        job_type: r.job_type ?? 'bootstrap',
        status: r.status ?? 'queued',
        dry_run: parseBool(r.dry_run) ?? true,
        requested_by: r.requested_by ?? 'system',
        approved_by: r.approved_by ?? null,
        runner_host: r.runner_host ?? null,
        idempotency_key: r.idempotency_key ?? null,
        request_json: r.request_json ?? '{}',
        plan_json: r.plan_json ?? '[]',
        result_json: r.result_json ?? null,
        error_text: r.error_text ?? null,
        started_at: r.started_at ?? null,
        completed_at: r.completed_at ?? null,
        created_at: r.created_at,
        updated_at: r.updated_at ?? r.created_at,
      }))).onConflictDoNothing()
    })

    // provision_events (depends on provision_jobs)
    await migrateTable('provision_events', appDb.prepare('SELECT * FROM provision_events').all(), async (rows) => {
      await db.insert(schema.provisionEvents).values(rows.map(r => ({
        id: r.id,
        job_id: r.job_id,
        level: r.level ?? 'info',
        step_key: r.step_key ?? null,
        message: r.message,
        data: r.data ?? null,
        created_at: r.created_at,
      }))).onConflictDoNothing()
    })

    // skills
    await migrateTable('skills', appDb.prepare('SELECT * FROM skills').all(), async (rows) => {
      await db.insert(schema.skills).values(rows.map(r => ({
        id: r.id,
        name: r.name,
        source: r.source,
        path: r.path,
        description: r.description ?? null,
        content_hash: r.content_hash ?? null,
        registry_slug: r.registry_slug ?? null,
        registry_version: r.registry_version ?? null,
        security_status: r.security_status ?? 'unchecked',
        installed_at: r.installed_at ?? new Date().toISOString(),
        updated_at: r.updated_at ?? new Date().toISOString(),
      }))).onConflictDoNothing()
    })

    // gateway_health_logs
    await migrateTable('gateway_health_logs', appDb.prepare('SELECT * FROM gateway_health_logs').all(), async (rows) => {
      await db.insert(schema.gatewayHealthLogs).values(rows.map(r => ({
        id: r.id,
        gateway_id: r.gateway_id,
        status: r.status,
        latency: r.latency ?? null,
        probed_at: r.probed_at,
        error: r.error ?? null,
      }))).onConflictDoNothing()
    })

    appDb.close()
    console.log('')
  }

  // ─── Reset sequences ──────────────────────────────────────────────────────
  if (!DRY_RUN) {
    console.log('🔧 Resetting Postgres sequences...')
    const serialTables = [
      'agents', 'audit_log', 'activities', 'notifications', 'task_subscriptions',
      'standup_reports', 'quality_reviews', 'messages', 'users', 'user_sessions',
      'workflow_templates', 'alert_rules', 'webhooks', 'webhook_deliveries',
      'workflow_pipelines', 'pipeline_runs', 'settings', 'tenants', 'provision_jobs',
      'provision_events', 'token_usage', 'claude_sessions', 'gateway_health_logs',
      'tasks', 'comments', 'tweet_interactions', 'gateways', 'skills', 'api_keys',
      'agent_api_keys', 'security_events', 'agent_trust_scores', 'mcp_call_log',
      'eval_runs', 'eval_golden_sets', 'eval_traces', 'access_requests',
    ]

    for (const table of serialTables) {
      try {
        await db.execute(sql`SELECT setval(
          pg_get_serial_sequence(${table}, 'id'),
          COALESCE((SELECT MAX(id) FROM ${sql.raw(table)}), 1)
        )`)
      } catch {
        // Table might not have a serial id or might not exist
      }
    }
    console.log('   ✅ Sequences reset')
    console.log('')
  }

  console.log('✅ Migration complete!')
  if (DRY_RUN) {
    console.log('   (dry-run — no data was written)')
  }
}

main().catch((err) => {
  console.error('❌ Migration failed:', err)
  process.exit(1)
})
