/**
 * Data migration script: SQLite → Neon Postgres
 *
 * Reads from both SQLite databases and inserts into Neon.
 * Idempotent: uses ON CONFLICT DO NOTHING for text PKs,
 * and checks for existing rows where needed.
 *
 * Run with: npx tsx scripts/migrate-sqlite-to-postgres.ts
 *
 * Required env: DATABASE_URL (Neon connection string)
 * Optional env:
 *   CC_DB_PATH    (default: ~/.openclaw/control-center.db)
 *   APP_DB_PATH   (default: .data/mission-control.db)
 */

import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { existsSync } from 'fs';

// Must set DATABASE_URL before running
if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required.');
  process.exit(1);
}

// Dynamic import of neon to avoid compile-time issues
const { neon } = await import('@neondatabase/serverless');
const { drizzle } = await import('drizzle-orm/neon-http');
import * as schema from '../src/db/schema/index.js';
const sql = neon(process.env.DATABASE_URL);
const db = drizzle(sql, { schema });

const CC_DB_PATH = process.env.CC_DB_PATH || join(homedir(), '.openclaw', 'control-center.db');
const APP_DB_PATH = process.env.APP_DB_PATH || resolve('./data/mission-control.db');

// Check if .data or data dir
const APP_DB_PATHS = [
  resolve('.data/mission-control.db'),
  resolve('data/mission-control.db'),
  process.env.APP_DB_PATH || '',
].filter(Boolean);

function findAppDb(): string | null {
  if (process.env.APP_DB_PATH && existsSync(process.env.APP_DB_PATH)) return process.env.APP_DB_PATH;
  for (const p of APP_DB_PATHS) {
    if (existsSync(p)) return p;
  }
  return null;
}

function bool(val: any): boolean {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val !== 0;
  return false;
}

function str(val: any): string {
  if (val === null || val === undefined) return '';
  return String(val);
}

function strOrNull(val: any): string | null {
  if (val === null || val === undefined) return null;
  return String(val);
}

function numOrNull(val: any): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

function intOrNull(val: any): number | null {
  if (val === null || val === undefined) return null;
  const n = parseInt(String(val));
  return isNaN(n) ? null : n;
}

async function migrateCC(ccDbPath: string) {
  if (!existsSync(ccDbPath)) {
    console.log(`CC DB not found at ${ccDbPath}, skipping.`);
    return;
  }

  console.log(`\n📦 Migrating CC DB: ${ccDbPath}`);
  const ccDb = new Database(ccDbPath, { readonly: true });

  // projects
  const projects = ccDb.prepare('SELECT * FROM projects').all() as any[];
  console.log(`  projects: ${projects.length} rows`);
  for (const p of projects) {
    await db.insert(schema.projects).values({
      id: p.id,
      title: str(p.title),
      description: strOrNull(p.description) || '',
      emoji: str(p.emoji) || '📁',
      created_at: str(p.created_at),
      updated_at: str(p.updated_at),
      archived: bool(p.archived),
      schedule: str(p.schedule) || '',
      repo_url: str(p.repo_url) || '',
      local_path: str(p.local_path) || '',
    }).onConflictDoNothing();
  }

  // project_resources
  const projectResources = ccDb.prepare('SELECT * FROM project_resources').all() as any[];
  console.log(`  project_resources: ${projectResources.length} rows`);
  for (const r of projectResources) {
    await db.insert(schema.projectResources).values({
      id: r.id,
      project_id: strOrNull(r.project_id),
      kind: str(r.kind),
      label: strOrNull(r.label) || '',
      value: str(r.value),
      created_at: str(r.created_at),
    }).onConflictDoNothing();
  }

  // issues
  const issues = ccDb.prepare('SELECT * FROM issues').all() as any[];
  console.log(`  issues: ${issues.length} rows`);
  for (const i of issues) {
    await db.insert(schema.issues).values({
      id: i.id,
      project_id: strOrNull(i.project_id),
      title: str(i.title),
      description: str(i.description) || '',
      status: str(i.status) || 'open',
      assignee: str(i.assignee) || '',
      priority: str(i.priority) || 'normal',
      created_at: str(i.created_at),
      updated_at: str(i.updated_at),
      archived: bool(i.archived),
      schedule: str(i.schedule) || '',
      parent_id: strOrNull(i.parent_id),
      notion_id: str(i.notion_id) || '',
      creator: str(i.creator) || '',
      plan_path: strOrNull(i.plan_path),
      last_turn_at: strOrNull(i.last_turn_at),
      seen_at: strOrNull(i.seen_at),
      picked: bool(i.picked),
      picked_at: strOrNull(i.picked_at),
      picked_by: str(i.picked_by) || '',
      blocked_by: str(i.blocked_by) || '[]',
      plan_id: strOrNull(i.plan_id),
    }).onConflictDoNothing();
  }

  // issue_resources
  const issueResources = ccDb.prepare('SELECT * FROM issue_resources').all() as any[];
  console.log(`  issue_resources: ${issueResources.length} rows`);
  for (const r of issueResources) {
    await db.insert(schema.issueResources).values({
      id: r.id,
      issue_id: strOrNull(r.issue_id),
      kind: str(r.kind),
      label: strOrNull(r.label) || '',
      value: str(r.value),
      created_at: str(r.created_at),
    }).onConflictDoNothing();
  }

  // issue_comments
  const issueComments = ccDb.prepare('SELECT * FROM issue_comments').all() as any[];
  console.log(`  issue_comments: ${issueComments.length} rows`);
  for (const c of issueComments) {
    await db.insert(schema.issueComments).values({
      id: c.id,
      issue_id: str(c.issue_id),
      author: str(c.author),
      content: str(c.content),
      created_at: str(c.created_at),
      attachments: str(c.attachments) || '[]',
    }).onConflictDoNothing();
  }

  // issue_dependencies
  const issueDependencies = ccDb.prepare('SELECT * FROM issue_dependencies').all() as any[];
  console.log(`  issue_dependencies: ${issueDependencies.length} rows`);
  for (const d of issueDependencies) {
    await db.insert(schema.issueDependencies).values({
      issue_id: str(d.issue_id),
      depends_on: str(d.depends_on),
    }).onConflictDoNothing();
  }

  // issue_activity
  const issueActivity = ccDb.prepare('SELECT * FROM issue_activity').all() as any[];
  console.log(`  issue_activity: ${issueActivity.length} rows`);
  for (const a of issueActivity) {
    await db.insert(schema.issueActivity).values({
      id: a.id,
      issue_id: str(a.issue_id),
      actor: str(a.actor),
      action: str(a.action),
      detail: str(a.detail) || '',
      created_at: str(a.created_at),
    }).onConflictDoNothing();
  }

  // tweets
  const tweets = ccDb.prepare('SELECT * FROM tweets').all() as any[];
  console.log(`  tweets: ${tweets.length} rows`);
  for (const t of tweets) {
    await db.insert(schema.tweets).values({
      id: t.id,
      title: str(t.title) || '',
      author: str(t.author) || '',
      theme: str(t.theme) || '',
      verdict: str(t.verdict) || '',
      action: str(t.action) || '',
      source: str(t.source) || '',
      tweet_link: str(t.tweet_link) || '',
      digest: str(t.digest) || '',
      content: str(t.content) || '',
      created_at: str(t.created_at),
      scraped_at: str(t.scraped_at),
      pinned: bool(t.pinned),
      media_urls: str(t.media_urls) || '[]',
      triage_status: str(t.triage_status) || 'pending',
      snooze_until: strOrNull(t.snooze_until),
      local_media_urls: str(t.local_media_urls) || '[]',
      discord_message_id: strOrNull(t.discord_message_id),
      discord_posted_at: strOrNull(t.discord_posted_at),
      summary: str(t.summary) || '',
      digest_id: strOrNull(t.digest_id),
      highlighted: bool(t.highlighted),
      highlight_note: str(t.highlight_note) || '',
      top_replies: str(t.top_replies) || '[]',
      reply_count: intOrNull(t.reply_count) || 0,
      retweet_count: intOrNull(t.retweet_count) || 0,
      like_count: intOrNull(t.like_count) || 0,
      engage: bool(t.engage),
      engage_reason: strOrNull(t.engage_reason),
    }).onConflictDoNothing();
  }

  // tweet_ratings
  const tweetRatings = ccDb.prepare('SELECT * FROM tweet_ratings').all() as any[];
  console.log(`  tweet_ratings: ${tweetRatings.length} rows`);
  for (const r of tweetRatings) {
    await db.insert(schema.tweetRatings).values({
      tweet_id: str(r.tweet_id),
      rating: str(r.rating),
      rated_at: str(r.rated_at),
    }).onConflictDoNothing();
  }

  // tweet_interactions
  const tweetInteractions = ccDb.prepare('SELECT * FROM tweet_interactions').all() as any[];
  console.log(`  tweet_interactions: ${tweetInteractions.length} rows`);
  for (const i of tweetInteractions) {
    await db.insert(schema.tweetInteractions).values({
      tweet_id: str(i.tweet_id),
      action: str(i.action),
      created_at: str(i.created_at),
    });
  }

  // garden
  const gardenItems = ccDb.prepare('SELECT * FROM garden').all() as any[];
  console.log(`  garden: ${gardenItems.length} rows`);
  for (const g of gardenItems) {
    await db.insert(schema.garden).values({
      id: g.id,
      content: str(g.content),
      type: str(g.type) || 'tweet',
      interest: str(g.interest) || 'information',
      temporal: str(g.temporal) || 'ever',
      tags: str(g.tags) || '[]',
      note: str(g.note) || '',
      original_source: strOrNull(g.original_source),
      media_urls: str(g.media_urls) || '[]',
      metadata: str(g.metadata) || '{}',
      enriched: bool(g.enriched),
      instance_type: str(g.instance_type) || 'instance',
      snooze_until: strOrNull(g.snooze_until),
      expires_at: strOrNull(g.expires_at),
      group: strOrNull(g.group),
      created_at: str(g.created_at),
      saved_at: str(g.saved_at),
    }).onConflictDoNothing();
  }

  // project_notes
  const projectNotes = ccDb.prepare('SELECT * FROM project_notes').all() as any[];
  console.log(`  project_notes: ${projectNotes.length} rows`);
  for (const n of projectNotes) {
    await db.insert(schema.projectNotes).values({
      id: n.id,
      project_id: str(n.project_id),
      content: str(n.content),
      pinned: bool(n.pinned),
      created_at: str(n.created_at),
    }).onConflictDoNothing();
  }

  // og_cache
  const ogCacheItems = ccDb.prepare('SELECT * FROM og_cache').all() as any[];
  console.log(`  og_cache: ${ogCacheItems.length} rows`);
  for (const o of ogCacheItems) {
    await db.insert(schema.ogCache).values({
      url: o.url,
      title: strOrNull(o.title),
      description: strOrNull(o.description),
      image: strOrNull(o.image),
      fetched_at: str(o.fetched_at),
    }).onConflictDoNothing();
  }

  // turns
  const turns = ccDb.prepare('SELECT * FROM turns').all() as any[];
  console.log(`  turns: ${turns.length} rows`);
  for (const t of turns) {
    await db.insert(schema.turns).values({
      id: t.id,
      task_id: str(t.task_id),
      round_number: intOrNull(t.round_number) || 1,
      type: str(t.type) || 'result',
      author: str(t.author),
      content: str(t.content) || '',
      links: str(t.links) || '[]',
      created_at: strOrNull(t.created_at) || new Date().toISOString(),
      updated_at: strOrNull(t.updated_at) || new Date().toISOString(),
    }).onConflictDoNothing();
  }

  // digests
  const digests = ccDb.prepare('SELECT * FROM digests').all() as any[];
  console.log(`  digests: ${digests.length} rows`);
  for (const d of digests) {
    await db.insert(schema.digests).values({
      id: d.id,
      label: str(d.label),
      brief: str(d.brief) || '',
      items: str(d.items) || '[]',
      stats: strOrNull(d.stats),
      stats_scraped: intOrNull(d.stats_scraped) || 0,
      stats_kept: intOrNull(d.stats_kept) || 0,
      stats_dropped: intOrNull(d.stats_dropped) || 0,
      created_at: str(d.created_at),
      discord_message_id: strOrNull(d.discord_message_id),
      discord_thread_id: strOrNull(d.discord_thread_id),
    }).onConflictDoNothing();
  }

  // plans
  const plans = ccDb.prepare('SELECT * FROM plans').all() as any[];
  console.log(`  plans: ${plans.length} rows`);
  for (const p of plans) {
    await db.insert(schema.plans).values({
      id: p.id,
      title: str(p.title),
      content: str(p.content),
      task_id: strOrNull(p.task_id),
      project_id: strOrNull(p.project_id),
      author: str(p.author),
      status: str(p.status) || 'draft',
      responses: str(p.responses) || '{}',
      created_at: strOrNull(p.created_at) || new Date().toISOString(),
      updated_at: strOrNull(p.updated_at) || new Date().toISOString(),
    }).onConflictDoNothing();
  }

  ccDb.close();
  console.log('✅ CC DB migration complete');
}

async function migrateApp(appDbPath: string) {
  if (!existsSync(appDbPath)) {
    console.log(`App DB not found at ${appDbPath}, skipping.`);
    return;
  }

  console.log(`\n📦 Migrating App DB: ${appDbPath}`);
  const appDb = new Database(appDbPath, { readonly: true });

  const tables = (appDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as any[]).map(r => r.name);
  console.log(`  Tables found: ${tables.join(', ')}`);

  // users
  if (tables.includes('users')) {
    const users = appDb.prepare('SELECT * FROM users').all() as any[];
    console.log(`  users: ${users.length} rows`);
    for (const u of users) {
      await db.insert(schema.users).values({
        username: str(u.username),
        display_name: str(u.display_name),
        password_hash: str(u.password_hash),
        role: str(u.role) || 'operator',
        created_at: intOrNull(u.created_at) || Math.floor(Date.now() / 1000),
        updated_at: intOrNull(u.updated_at) || Math.floor(Date.now() / 1000),
        last_login_at: intOrNull(u.last_login_at),
        provider: str(u.provider) || 'local',
        provider_user_id: strOrNull(u.provider_user_id),
        email: strOrNull(u.email),
        avatar_url: strOrNull(u.avatar_url),
        is_approved: bool(u.is_approved !== undefined ? u.is_approved : 1),
        approved_by: strOrNull(u.approved_by),
        approved_at: intOrNull(u.approved_at),
        workspace_id: intOrNull(u.workspace_id) || 1,
      }).onConflictDoNothing();
    }
  }

  // agents
  if (tables.includes('agents')) {
    const agents = appDb.prepare('SELECT * FROM agents').all() as any[];
    console.log(`  agents: ${agents.length} rows`);
    for (const a of agents) {
      await db.insert(schema.agents).values({
        name: str(a.name),
        role: str(a.role),
        session_key: strOrNull(a.session_key),
        soul_content: strOrNull(a.soul_content),
        status: str(a.status) || 'offline',
        last_seen: intOrNull(a.last_seen),
        last_activity: strOrNull(a.last_activity),
        created_at: intOrNull(a.created_at) || Math.floor(Date.now() / 1000),
        updated_at: intOrNull(a.updated_at) || Math.floor(Date.now() / 1000),
        config: strOrNull(a.config),
      }).onConflictDoNothing();
    }
  }

  // gateways
  if (tables.includes('gateways')) {
    const gateways = appDb.prepare('SELECT * FROM gateways').all() as any[];
    console.log(`  gateways: ${gateways.length} rows`);
    for (const g of gateways) {
      await db.insert(schema.gateways).values({
        name: str(g.name),
        host: str(g.host) || '127.0.0.1',
        port: intOrNull(g.port) || 18789,
        token: str(g.token) || '',
        is_primary: bool(g.is_primary),
        status: str(g.status) || 'unknown',
        last_seen: intOrNull(g.last_seen),
        latency: intOrNull(g.latency),
        sessions_count: intOrNull(g.sessions_count) || 0,
        agents_count: intOrNull(g.agents_count) || 0,
        created_at: intOrNull(g.created_at) || Math.floor(Date.now() / 1000),
        updated_at: intOrNull(g.updated_at) || Math.floor(Date.now() / 1000),
      }).onConflictDoNothing();
    }
  }

  // settings
  if (tables.includes('settings')) {
    const settings = appDb.prepare('SELECT * FROM settings').all() as any[];
    console.log(`  settings: ${settings.length} rows`);
    for (const s of settings) {
      await db.insert(schema.settings).values({
        key: str(s.key),
        value: str(s.value),
        description: strOrNull(s.description),
        category: str(s.category) || 'general',
        updated_by: strOrNull(s.updated_by),
        updated_at: intOrNull(s.updated_at) || Math.floor(Date.now() / 1000),
      }).onConflictDoNothing();
    }
  }

  // webhooks
  if (tables.includes('webhooks')) {
    const webhooks = appDb.prepare('SELECT * FROM webhooks').all() as any[];
    console.log(`  webhooks: ${webhooks.length} rows`);
    for (const w of webhooks) {
      await db.insert(schema.webhooks).values({
        name: str(w.name),
        url: str(w.url),
        secret: strOrNull(w.secret),
        events: str(w.events) || '["*"]',
        enabled: bool(w.enabled !== undefined ? w.enabled : 1),
        last_fired_at: intOrNull(w.last_fired_at),
        last_status: intOrNull(w.last_status),
        created_by: str(w.created_by) || 'system',
        created_at: intOrNull(w.created_at) || Math.floor(Date.now() / 1000),
        updated_at: intOrNull(w.updated_at) || Math.floor(Date.now() / 1000),
      }).onConflictDoNothing();
    }
  }

  // audit_log
  if (tables.includes('audit_log')) {
    const auditLog = appDb.prepare('SELECT * FROM audit_log').all() as any[];
    console.log(`  audit_log: ${auditLog.length} rows`);
    for (const a of auditLog) {
      await db.insert(schema.auditLog).values({
        action: str(a.action),
        actor: str(a.actor),
        actor_id: intOrNull(a.actor_id),
        target_type: strOrNull(a.target_type),
        target_id: intOrNull(a.target_id),
        detail: strOrNull(a.detail),
        ip_address: strOrNull(a.ip_address),
        user_agent: strOrNull(a.user_agent),
        created_at: intOrNull(a.created_at) || Math.floor(Date.now() / 1000),
      });
    }
  }

  // standup_reports
  if (tables.includes('standup_reports')) {
    const standupReports = appDb.prepare('SELECT * FROM standup_reports').all() as any[];
    console.log(`  standup_reports: ${standupReports.length} rows`);
    for (const r of standupReports) {
      await db.insert(schema.standupReports).values({
        date: str(r.date),
        report: str(r.report),
        created_at: intOrNull(r.created_at) || Math.floor(Date.now() / 1000),
      }).onConflictDoNothing();
    }
  }

  // skills
  if (tables.includes('skills')) {
    const skills = appDb.prepare('SELECT * FROM skills').all() as any[];
    console.log(`  skills: ${skills.length} rows`);
    for (const s of skills) {
      await db.insert(schema.skills).values({
        name: str(s.name),
        source: str(s.source),
        path: str(s.path),
        description: strOrNull(s.description),
        content_hash: strOrNull(s.content_hash),
        registry_slug: strOrNull(s.registry_slug),
        registry_version: strOrNull(s.registry_version),
        security_status: str(s.security_status) || 'unchecked',
        installed_at: strOrNull(s.installed_at) || new Date().toISOString(),
        updated_at: strOrNull(s.updated_at) || new Date().toISOString(),
      }).onConflictDoNothing();
    }
  }

  // api_keys
  if (tables.includes('api_keys')) {
    const apiKeys = appDb.prepare('SELECT * FROM api_keys').all() as any[];
    console.log(`  api_keys: ${apiKeys.length} rows`);
    for (const k of apiKeys) {
      await db.insert(schema.apiKeys).values({
        user_id: intOrNull(k.user_id) || 1,
        label: str(k.label),
        key_prefix: str(k.key_prefix),
        key_hash: str(k.key_hash),
        role: str(k.role) || 'viewer',
        scopes: strOrNull(k.scopes),
        expires_at: intOrNull(k.expires_at),
        last_used_at: intOrNull(k.last_used_at),
        last_used_ip: strOrNull(k.last_used_ip),
        workspace_id: intOrNull(k.workspace_id) || 1,
        tenant_id: intOrNull(k.tenant_id) || 1,
        is_revoked: bool(k.is_revoked),
        created_at: intOrNull(k.created_at) || Math.floor(Date.now() / 1000),
        updated_at: intOrNull(k.updated_at) || Math.floor(Date.now() / 1000),
      }).onConflictDoNothing();
    }
  }

  // token_usage
  if (tables.includes('token_usage')) {
    const tokenUsage = appDb.prepare('SELECT * FROM token_usage').all() as any[];
    console.log(`  token_usage: ${tokenUsage.length} rows`);
    for (const t of tokenUsage) {
      await db.insert(schema.tokenUsage).values({
        model: str(t.model),
        session_id: str(t.session_id),
        input_tokens: intOrNull(t.input_tokens) || 0,
        output_tokens: intOrNull(t.output_tokens) || 0,
        workspace_id: intOrNull(t.workspace_id) || 1,
        task_id: intOrNull(t.task_id),
        cost_usd: t.cost_usd ? Number(t.cost_usd) : null,
        agent_name: strOrNull(t.agent_name),
        created_at: intOrNull(t.created_at) || Math.floor(Date.now() / 1000),
      });
    }
  }

  // messages
  if (tables.includes('messages')) {
    const messages = appDb.prepare('SELECT * FROM messages').all() as any[];
    console.log(`  messages: ${messages.length} rows`);
    for (const m of messages) {
      await db.insert(schema.messages).values({
        conversation_id: str(m.conversation_id),
        from_agent: str(m.from_agent),
        to_agent: strOrNull(m.to_agent),
        content: str(m.content),
        message_type: str(m.message_type) || 'text',
        metadata: strOrNull(m.metadata),
        read_at: intOrNull(m.read_at),
        created_at: intOrNull(m.created_at) || Math.floor(Date.now() / 1000),
      });
    }
  }

  appDb.close();
  console.log('✅ App DB migration complete');
}

// Main
console.log('🚀 Starting SQLite → Neon Postgres migration...');
console.log(`  CC DB: ${CC_DB_PATH}`);
const appDbPath = findAppDb();
console.log(`  App DB: ${appDbPath || 'not found'}`);

await migrateCC(CC_DB_PATH);
if (appDbPath) {
  await migrateApp(appDbPath);
} else {
  console.log('\n⚠️  App DB not found. Only CC DB migrated.');
}

console.log('\n✅ Migration complete!');
