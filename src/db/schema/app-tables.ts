import {
  pgTable,
  text,
  integer,
  serial,
  boolean,
  real,
} from 'drizzle-orm/pg-core';
import type { InferSelectModel } from 'drizzle-orm';

// --- tasks (legacy, kept for quality_reviews and subscriptions) ---
export const tasks = pgTable('tasks', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').notNull().default('open'),
  priority: text('priority').notNull().default('medium'),
  assigned_to: text('assigned_to'),
  creator: text('creator').default(''),
  created_at: integer('created_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
  updated_at: integer('updated_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
  tags: text('tags'),
  metadata: text('metadata'),
});
export type AppTask = InferSelectModel<typeof tasks>;

// --- agents ---
export const agents = pgTable('agents', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  role: text('role').notNull(),
  session_key: text('session_key'),
  soul_content: text('soul_content'),
  status: text('status').notNull().default('offline'),
  last_seen: integer('last_seen'),
  last_activity: text('last_activity'),
  created_at: integer('created_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
  updated_at: integer('updated_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
  config: text('config'),
  team: text('team'),
  workspace_id: integer('workspace_id').default(1),
  source: text('source').default('manual'),
  content_hash: text('content_hash'),
  workspace_path: text('workspace_path'),
});
export type Agent = InferSelectModel<typeof agents>;

// --- comments ---
export const comments = pgTable('comments', {
  id: serial('id').primaryKey(),
  task_id: integer('task_id').notNull().references(() => tasks.id),
  author: text('author').notNull(),
  content: text('content').notNull(),
  created_at: integer('created_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
  parent_id: integer('parent_id'),
  mentions: text('mentions'),
});
export type Comment = InferSelectModel<typeof comments>;

// --- activities ---
export const activities = pgTable('activities', {
  id: serial('id').primaryKey(),
  type: text('type').notNull(),
  entity_type: text('entity_type').notNull(),
  entity_id: integer('entity_id').notNull(),
  actor: text('actor').notNull(),
  description: text('description').notNull(),
  data: text('data'),
  created_at: integer('created_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
  workspace_id: integer('workspace_id').default(1),
});
export type Activity = InferSelectModel<typeof activities>;

// --- notifications ---
export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  recipient: text('recipient').notNull(),
  type: text('type').notNull(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  source_type: text('source_type'),
  source_id: integer('source_id'),
  read_at: integer('read_at'),
  delivered_at: integer('delivered_at'),
  created_at: integer('created_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
});
export type Notification = InferSelectModel<typeof notifications>;

// --- task_subscriptions ---
export const taskSubscriptions = pgTable('task_subscriptions', {
  id: serial('id').primaryKey(),
  task_id: integer('task_id').notNull().references(() => tasks.id),
  agent_name: text('agent_name').notNull(),
  created_at: integer('created_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
});
export type TaskSubscription = InferSelectModel<typeof taskSubscriptions>;

// --- standup_reports ---
export const standupReports = pgTable('standup_reports', {
  date: text('date').primaryKey(),
  report: text('report').notNull(),
  created_at: integer('created_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
});
export type StandupReport = InferSelectModel<typeof standupReports>;

// --- quality_reviews ---
export const qualityReviews = pgTable('quality_reviews', {
  id: serial('id').primaryKey(),
  task_id: integer('task_id').notNull().references(() => tasks.id),
  reviewer: text('reviewer').notNull(),
  status: text('status').notNull(),
  notes: text('notes'),
  created_at: integer('created_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
});
export type QualityReview = InferSelectModel<typeof qualityReviews>;

// --- messages ---
export const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  conversation_id: text('conversation_id').notNull(),
  from_agent: text('from_agent').notNull(),
  to_agent: text('to_agent'),
  content: text('content').notNull(),
  message_type: text('message_type').default('text'),
  metadata: text('metadata'),
  read_at: integer('read_at'),
  created_at: integer('created_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
  workspace_id: integer('workspace_id').default(1),
});
export type Message = InferSelectModel<typeof messages>;

// --- users ---
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: text('username').notNull(),
  display_name: text('display_name').notNull(),
  password_hash: text('password_hash').notNull(),
  role: text('role').notNull().default('operator'),
  created_at: integer('created_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
  updated_at: integer('updated_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
  last_login_at: integer('last_login_at'),
  provider: text('provider').notNull().default('local'),
  provider_user_id: text('provider_user_id'),
  email: text('email'),
  avatar_url: text('avatar_url'),
  is_approved: boolean('is_approved').default(true),
  approved_by: text('approved_by'),
  approved_at: integer('approved_at'),
  workspace_id: integer('workspace_id').default(1),
});
export type User = InferSelectModel<typeof users>;

// --- user_sessions ---
export const userSessions = pgTable('user_sessions', {
  id: serial('id').primaryKey(),
  token: text('token').notNull(),
  user_id: integer('user_id').notNull().references(() => users.id),
  expires_at: integer('expires_at').notNull(),
  created_at: integer('created_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
  ip_address: text('ip_address'),
  user_agent: text('user_agent'),
});
export type UserSession = InferSelectModel<typeof userSessions>;

// --- workflow_templates ---
export const workflowTemplates = pgTable('workflow_templates', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  model: text('model').notNull().default('sonnet'),
  task_prompt: text('task_prompt').notNull(),
  timeout_seconds: integer('timeout_seconds').notNull().default(300),
  agent_role: text('agent_role'),
  tags: text('tags'),
  created_by: text('created_by').notNull().default('system'),
  created_at: integer('created_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
  updated_at: integer('updated_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
  last_used_at: integer('last_used_at'),
  use_count: integer('use_count').notNull().default(0),
});
export type WorkflowTemplate = InferSelectModel<typeof workflowTemplates>;

// --- audit_log ---
export const auditLog = pgTable('audit_log', {
  id: serial('id').primaryKey(),
  action: text('action').notNull(),
  actor: text('actor').notNull(),
  actor_id: integer('actor_id'),
  target_type: text('target_type'),
  target_id: integer('target_id'),
  detail: text('detail'),
  ip_address: text('ip_address'),
  user_agent: text('user_agent'),
  created_at: integer('created_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
});
export type AuditLog = InferSelectModel<typeof auditLog>;

// --- webhooks ---
export const webhooks = pgTable('webhooks', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  secret: text('secret'),
  events: text('events').notNull().default('["*"]'),
  enabled: boolean('enabled').default(true),
  last_fired_at: integer('last_fired_at'),
  last_status: integer('last_status'),
  created_by: text('created_by').notNull().default('system'),
  created_at: integer('created_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
  updated_at: integer('updated_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
});
export type Webhook = InferSelectModel<typeof webhooks>;

// --- webhook_deliveries ---
export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: serial('id').primaryKey(),
  webhook_id: integer('webhook_id').notNull().references(() => webhooks.id),
  event_type: text('event_type').notNull(),
  payload: text('payload').notNull(),
  status_code: integer('status_code'),
  response_body: text('response_body'),
  error: text('error'),
  duration_ms: integer('duration_ms'),
  is_retry: boolean('is_retry').default(false),
  created_at: integer('created_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
});
export type WebhookDelivery = InferSelectModel<typeof webhookDeliveries>;

// --- workflow_pipelines ---
export const workflowPipelines = pgTable('workflow_pipelines', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  steps: text('steps').notNull().default('[]'),
  created_by: text('created_by').notNull().default('system'),
  created_at: integer('created_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
  updated_at: integer('updated_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
  use_count: integer('use_count').notNull().default(0),
  last_used_at: integer('last_used_at'),
});
export type WorkflowPipeline = InferSelectModel<typeof workflowPipelines>;

// --- pipeline_runs ---
export const pipelineRuns = pgTable('pipeline_runs', {
  id: serial('id').primaryKey(),
  pipeline_id: integer('pipeline_id').notNull().references(() => workflowPipelines.id),
  status: text('status').notNull().default('pending'),
  current_step: integer('current_step').notNull().default(0),
  steps_snapshot: text('steps_snapshot').notNull().default('[]'),
  started_at: integer('started_at'),
  completed_at: integer('completed_at'),
  triggered_by: text('triggered_by').notNull().default('system'),
  created_at: integer('created_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
});
export type PipelineRun = InferSelectModel<typeof pipelineRuns>;

// --- settings ---
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  description: text('description'),
  category: text('category').notNull().default('general'),
  updated_by: text('updated_by'),
  updated_at: integer('updated_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
});
export type Setting = InferSelectModel<typeof settings>;

// --- alert_rules ---
export const alertRules = pgTable('alert_rules', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  enabled: boolean('enabled').default(true),
  entity_type: text('entity_type').notNull(),
  condition_field: text('condition_field').notNull(),
  condition_operator: text('condition_operator').notNull(),
  condition_value: text('condition_value').notNull(),
  action_type: text('action_type').notNull().default('notification'),
  action_config: text('action_config').notNull().default('{}'),
  cooldown_minutes: integer('cooldown_minutes').notNull().default(60),
  last_triggered_at: integer('last_triggered_at'),
  trigger_count: integer('trigger_count').notNull().default(0),
  created_by: text('created_by').notNull().default('system'),
  created_at: integer('created_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
  updated_at: integer('updated_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
});
export type AlertRule = InferSelectModel<typeof alertRules>;

// --- schema_migrations ---
export const schemaMigrations = pgTable('schema_migrations', {
  id: text('id').primaryKey(),
  applied_at: integer('applied_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
});
export type SchemaMigration = InferSelectModel<typeof schemaMigrations>;

// --- tenants ---
export const tenants = pgTable('tenants', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull(),
  display_name: text('display_name').notNull(),
  linux_user: text('linux_user').notNull(),
  plan_tier: text('plan_tier').notNull().default('standard'),
  status: text('status').notNull().default('pending'),
  openclaw_home: text('openclaw_home').notNull(),
  workspace_root: text('workspace_root').notNull(),
  gateway_port: integer('gateway_port'),
  dashboard_port: integer('dashboard_port'),
  config: text('config').notNull().default('{}'),
  created_by: text('created_by').notNull().default('system'),
  owner_gateway: text('owner_gateway'),
  created_at: integer('created_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
  updated_at: integer('updated_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
});
export type Tenant = InferSelectModel<typeof tenants>;

// --- workspaces ---
export const workspaces = pgTable('workspaces', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  tenant_id: integer('tenant_id').notNull().references(() => tenants.id),
  created_at: integer('created_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
  updated_at: integer('updated_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
});
export type Workspace = InferSelectModel<typeof workspaces>;

// --- provision_jobs ---
export const provisionJobs = pgTable('provision_jobs', {
  id: serial('id').primaryKey(),
  tenant_id: integer('tenant_id').notNull().references(() => tenants.id),
  job_type: text('job_type').notNull().default('bootstrap'),
  status: text('status').notNull().default('queued'),
  dry_run: boolean('dry_run').default(true),
  requested_by: text('requested_by').notNull().default('system'),
  approved_by: text('approved_by'),
  runner_host: text('runner_host'),
  idempotency_key: text('idempotency_key'),
  request_json: text('request_json').notNull().default('{}'),
  plan_json: text('plan_json').notNull().default('[]'),
  result_json: text('result_json'),
  error_text: text('error_text'),
  started_at: integer('started_at'),
  completed_at: integer('completed_at'),
  created_at: integer('created_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
  updated_at: integer('updated_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
});
export type ProvisionJob = InferSelectModel<typeof provisionJobs>;

// --- provision_events ---
export const provisionEvents = pgTable('provision_events', {
  id: serial('id').primaryKey(),
  job_id: integer('job_id').notNull().references(() => provisionJobs.id),
  level: text('level').notNull().default('info'),
  step_key: text('step_key'),
  message: text('message').notNull(),
  data: text('data'),
  created_at: integer('created_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
});
export type ProvisionEvent = InferSelectModel<typeof provisionEvents>;

// --- project_agent_assignments ---
export const projectAgentAssignments = pgTable('project_agent_assignments', {
  id: serial('id').primaryKey(),
  project_id: integer('project_id').notNull(),
  agent_name: text('agent_name').notNull(),
  role: text('role').default('member'),
  assigned_at: integer('assigned_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
});
export type ProjectAgentAssignment = InferSelectModel<typeof projectAgentAssignments>;

// --- adapter_configs ---
export const adapterConfigs = pgTable('adapter_configs', {
  id: serial('id').primaryKey(),
  workspace_id: integer('workspace_id').notNull().references(() => workspaces.id),
  framework: text('framework').notNull(),
  config: text('config').default('{}'),
  enabled: boolean('enabled').default(true),
  created_at: integer('created_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
  updated_at: integer('updated_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
});
export type AdapterConfig = InferSelectModel<typeof adapterConfigs>;

// --- skills ---
export const skills = pgTable('skills', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  source: text('source').notNull(),
  path: text('path').notNull(),
  description: text('description'),
  content_hash: text('content_hash'),
  registry_slug: text('registry_slug'),
  registry_version: text('registry_version'),
  security_status: text('security_status').default('unchecked'),
  installed_at: text('installed_at').$defaultFn(() => new Date().toISOString()),
  updated_at: text('updated_at').$defaultFn(() => new Date().toISOString()),
});
export type Skill = InferSelectModel<typeof skills>;

// --- api_keys ---
export const apiKeys = pgTable('api_keys', {
  id: serial('id').primaryKey(),
  user_id: integer('user_id').notNull(),
  label: text('label').notNull(),
  key_prefix: text('key_prefix').notNull(),
  key_hash: text('key_hash').notNull(),
  role: text('role').notNull().default('viewer'),
  scopes: text('scopes'),
  expires_at: integer('expires_at'),
  last_used_at: integer('last_used_at'),
  last_used_ip: text('last_used_ip'),
  workspace_id: integer('workspace_id').notNull().default(1),
  tenant_id: integer('tenant_id').notNull().default(1),
  is_revoked: boolean('is_revoked').default(false),
  created_at: integer('created_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
  updated_at: integer('updated_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
});
export type ApiKey = InferSelectModel<typeof apiKeys>;

// --- agent_api_keys ---
export const agentApiKeys = pgTable('agent_api_keys', {
  id: serial('id').primaryKey(),
  agent_id: integer('agent_id').notNull().references(() => agents.id),
  workspace_id: integer('workspace_id').notNull().default(1),
  name: text('name').notNull(),
  key_hash: text('key_hash').notNull(),
  key_prefix: text('key_prefix').notNull(),
  scopes: text('scopes').notNull().default('[]'),
  expires_at: integer('expires_at'),
  revoked_at: integer('revoked_at'),
  last_used_at: integer('last_used_at'),
  created_by: text('created_by'),
  created_at: integer('created_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
  updated_at: integer('updated_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
});
export type AgentApiKey = InferSelectModel<typeof agentApiKeys>;

// --- security_events ---
export const securityEvents = pgTable('security_events', {
  id: serial('id').primaryKey(),
  event_type: text('event_type').notNull(),
  severity: text('severity').notNull().default('info'),
  source: text('source'),
  agent_name: text('agent_name'),
  detail: text('detail'),
  ip_address: text('ip_address'),
  workspace_id: integer('workspace_id').notNull().default(1),
  tenant_id: integer('tenant_id').notNull().default(1),
  created_at: integer('created_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
});
export type SecurityEvent = InferSelectModel<typeof securityEvents>;

// --- agent_trust_scores ---
export const agentTrustScores = pgTable('agent_trust_scores', {
  id: serial('id').primaryKey(),
  agent_name: text('agent_name').notNull(),
  trust_score: real('trust_score').notNull().default(1.0),
  auth_failures: integer('auth_failures').notNull().default(0),
  injection_attempts: integer('injection_attempts').notNull().default(0),
  rate_limit_hits: integer('rate_limit_hits').notNull().default(0),
  secret_exposures: integer('secret_exposures').notNull().default(0),
  successful_tasks: integer('successful_tasks').notNull().default(0),
  failed_tasks: integer('failed_tasks').notNull().default(0),
  last_anomaly_at: integer('last_anomaly_at'),
  workspace_id: integer('workspace_id').notNull().default(1),
  updated_at: integer('updated_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
});
export type AgentTrustScore = InferSelectModel<typeof agentTrustScores>;

// --- mcp_call_log ---
export const mcpCallLog = pgTable('mcp_call_log', {
  id: serial('id').primaryKey(),
  agent_name: text('agent_name'),
  mcp_server: text('mcp_server'),
  tool_name: text('tool_name'),
  success: boolean('success').default(true),
  duration_ms: integer('duration_ms'),
  error: text('error'),
  workspace_id: integer('workspace_id').notNull().default(1),
  created_at: integer('created_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
});
export type McpCallLog = InferSelectModel<typeof mcpCallLog>;

// --- eval_runs ---
export const evalRuns = pgTable('eval_runs', {
  id: serial('id').primaryKey(),
  agent_name: text('agent_name').notNull(),
  eval_layer: text('eval_layer').notNull(),
  score: real('score'),
  passed: boolean('passed'),
  detail: text('detail'),
  golden_dataset_id: integer('golden_dataset_id'),
  workspace_id: integer('workspace_id').notNull().default(1),
  created_at: integer('created_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
});
export type EvalRun = InferSelectModel<typeof evalRuns>;

// --- eval_golden_sets ---
export const evalGoldenSets = pgTable('eval_golden_sets', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  entries: text('entries').notNull().default('[]'),
  created_by: text('created_by'),
  workspace_id: integer('workspace_id').notNull().default(1),
  created_at: integer('created_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
  updated_at: integer('updated_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
});
export type EvalGoldenSet = InferSelectModel<typeof evalGoldenSets>;

// --- eval_traces ---
export const evalTraces = pgTable('eval_traces', {
  id: serial('id').primaryKey(),
  agent_name: text('agent_name').notNull(),
  task_id: integer('task_id'),
  trace: text('trace').notNull().default('[]'),
  convergence_score: real('convergence_score'),
  total_steps: integer('total_steps'),
  optimal_steps: integer('optimal_steps'),
  workspace_id: integer('workspace_id').notNull().default(1),
  created_at: integer('created_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
});
export type EvalTrace = InferSelectModel<typeof evalTraces>;

// --- gateway_health_logs ---
export const gatewayHealthLogs = pgTable('gateway_health_logs', {
  id: serial('id').primaryKey(),
  gateway_id: integer('gateway_id').notNull(),
  status: text('status').notNull(),
  latency: integer('latency'),
  probed_at: integer('probed_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
  error: text('error'),
});
export type GatewayHealthLog = InferSelectModel<typeof gatewayHealthLogs>;

// --- gateways ---
export const gateways = pgTable('gateways', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  host: text('host').notNull().default('127.0.0.1'),
  port: integer('port').notNull().default(18789),
  token: text('token').notNull().default(''),
  is_primary: boolean('is_primary').default(false),
  status: text('status').notNull().default('unknown'),
  last_seen: integer('last_seen'),
  latency: integer('latency'),
  sessions_count: integer('sessions_count').notNull().default(0),
  agents_count: integer('agents_count').notNull().default(0),
  created_at: integer('created_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
  updated_at: integer('updated_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
});
export type Gateway = InferSelectModel<typeof gateways>;

// --- token_usage ---
export const tokenUsage = pgTable('token_usage', {
  id: serial('id').primaryKey(),
  model: text('model').notNull(),
  session_id: text('session_id').notNull(),
  input_tokens: integer('input_tokens').notNull().default(0),
  output_tokens: integer('output_tokens').notNull().default(0),
  workspace_id: integer('workspace_id').notNull().default(1),
  task_id: integer('task_id'),
  cost_usd: real('cost_usd'),
  agent_name: text('agent_name'),
  created_at: integer('created_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
});
export type TokenUsage = InferSelectModel<typeof tokenUsage>;

// --- direct_connections ---
export const directConnections = pgTable('direct_connections', {
  id: serial('id').primaryKey(),
  agent_id: integer('agent_id').notNull().references(() => agents.id),
  tool_name: text('tool_name').notNull(),
  tool_version: text('tool_version'),
  connection_id: text('connection_id').notNull(),
  status: text('status').notNull().default('connected'),
  last_heartbeat: integer('last_heartbeat'),
  metadata: text('metadata'),
  workspace_id: integer('workspace_id').notNull().default(1),
  created_at: integer('created_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
  updated_at: integer('updated_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
});
export type DirectConnection = InferSelectModel<typeof directConnections>;

// --- github_syncs ---
export const githubSyncs = pgTable('github_syncs', {
  id: serial('id').primaryKey(),
  repo: text('repo').notNull(),
  last_synced_at: integer('last_synced_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
  issue_count: integer('issue_count').notNull().default(0),
  sync_direction: text('sync_direction').notNull().default('inbound'),
  status: text('status').notNull().default('success'),
  error: text('error'),
  workspace_id: integer('workspace_id').notNull().default(1),
  project_id: integer('project_id'),
  changes_pushed: integer('changes_pushed').notNull().default(0),
  changes_pulled: integer('changes_pulled').notNull().default(0),
  created_at: integer('created_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
});
export type GithubSync = InferSelectModel<typeof githubSyncs>;

// --- claude_sessions ---
export const claudeSessions = pgTable('claude_sessions', {
  id: serial('id').primaryKey(),
  session_id: text('session_id').notNull(),
  project_slug: text('project_slug').notNull(),
  project_path: text('project_path'),
  model: text('model'),
  git_branch: text('git_branch'),
  user_messages: integer('user_messages').notNull().default(0),
  assistant_messages: integer('assistant_messages').notNull().default(0),
  tool_uses: integer('tool_uses').notNull().default(0),
  input_tokens: integer('input_tokens').notNull().default(0),
  output_tokens: integer('output_tokens').notNull().default(0),
  estimated_cost: real('estimated_cost').notNull().default(0),
  first_message_at: text('first_message_at'),
  last_message_at: text('last_message_at'),
  last_user_prompt: text('last_user_prompt'),
  is_active: boolean('is_active').default(false),
  scanned_at: integer('scanned_at').notNull(),
  created_at: integer('created_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
  updated_at: integer('updated_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
});
export type ClaudeSession = InferSelectModel<typeof claudeSessions>;

// --- access_requests ---
export const accessRequests = pgTable('access_requests', {
  id: serial('id').primaryKey(),
  provider: text('provider').notNull().default('google'),
  email: text('email').notNull(),
  provider_user_id: text('provider_user_id'),
  display_name: text('display_name'),
  avatar_url: text('avatar_url'),
  status: text('status').notNull().default('pending'),
  requested_at: integer('requested_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
  last_attempt_at: integer('last_attempt_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
  attempt_count: integer('attempt_count').notNull().default(1),
  reviewed_by: text('reviewed_by'),
  reviewed_at: integer('reviewed_at'),
  review_note: text('review_note'),
  approved_user_id: integer('approved_user_id').references(() => users.id),
});
export type AccessRequest = InferSelectModel<typeof accessRequests>;
