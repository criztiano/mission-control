import {
  pgTable,
  text,
  integer,
  serial,
  boolean,
  real,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';

// --- projects ---
export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description').default(''),
  emoji: text('emoji').default('📁'),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
  archived: boolean('archived').default(false),
  schedule: text('schedule').default('nightly'),
  repo_url: text('repo_url').default(''),
  local_path: text('local_path').default(''),
});
export type Project = InferSelectModel<typeof projects>;

// --- project_resources ---
export const projectResources = pgTable('project_resources', {
  id: text('id').primaryKey(),
  project_id: text('project_id').references(() => projects.id),
  kind: text('kind').notNull(),
  label: text('label').default(''),
  value: text('value').notNull(),
  created_at: text('created_at').notNull(),
});
export type ProjectResource = InferSelectModel<typeof projectResources>;

// --- issues ---
export const issues = pgTable('issues', {
  id: text('id').primaryKey(),
  project_id: text('project_id').references(() => projects.id),
  title: text('title').notNull(),
  description: text('description').default(''),
  status: text('status').notNull().default('idea'),
  assignee: text('assignee').default(''),
  priority: text('priority').default('normal'),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
  archived: boolean('archived').default(false),
  schedule: text('schedule').default(''),
  parent_id: text('parent_id'), // self-reference, can't use .references() easily
  notion_id: text('notion_id').default(''),
  creator: text('creator').default(''),
  plan_path: text('plan_path'),
  last_turn_at: text('last_turn_at'),
  seen_at: text('seen_at'),
  picked: boolean('picked').default(false),
  picked_at: text('picked_at'),
  picked_by: text('picked_by').default(''),
  blocked_by: text('blocked_by').default('[]'),
  plan_id: text('plan_id'),
});
export type Issue = InferSelectModel<typeof issues>;

// --- issue_resources ---
export const issueResources = pgTable('issue_resources', {
  id: text('id').primaryKey(),
  issue_id: text('issue_id').references(() => issues.id),
  kind: text('kind').notNull(),
  label: text('label').default(''),
  value: text('value').notNull(),
  created_at: text('created_at').notNull(),
});
export type IssueResource = InferSelectModel<typeof issueResources>;

// --- issue_comments ---
export const issueComments = pgTable('issue_comments', {
  id: text('id').primaryKey(),
  issue_id: text('issue_id').notNull().references(() => issues.id),
  author: text('author').notNull(),
  content: text('content').notNull(),
  created_at: text('created_at').notNull(),
  attachments: text('attachments').default('[]'),
});
export type IssueComment = InferSelectModel<typeof issueComments>;

// --- issue_dependencies ---
export const issueDependencies = pgTable(
  'issue_dependencies',
  {
    issue_id: text('issue_id').notNull().references(() => issues.id),
    depends_on: text('depends_on').notNull().references(() => issues.id),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.issue_id, t.depends_on] }),
  })
);
export type IssueDependency = InferSelectModel<typeof issueDependencies>;

// --- issue_activity ---
export const issueActivity = pgTable('issue_activity', {
  id: text('id').primaryKey(),
  issue_id: text('issue_id').notNull().references(() => issues.id),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  detail: text('detail').default(''),
  created_at: text('created_at').notNull(),
});
export type IssueActivity = InferSelectModel<typeof issueActivity>;

// --- tweets ---
export const tweets = pgTable('tweets', {
  id: text('id').primaryKey(),
  title: text('title').notNull().default(''),
  author: text('author').notNull().default(''),
  theme: text('theme').notNull().default(''),
  verdict: text('verdict').notNull().default(''),
  action: text('action').notNull().default(''),
  source: text('source').notNull().default(''),
  tweet_link: text('tweet_link').notNull().default(''),
  digest: text('digest').notNull().default(''),
  content: text('content').notNull().default(''),
  created_at: text('created_at').notNull(),
  scraped_at: text('scraped_at').notNull(),
  pinned: boolean('pinned').default(false),
  media_urls: text('media_urls').notNull().default('[]'),
  triage_status: text('triage_status').notNull().default('pending'),
  snooze_until: text('snooze_until'),
  local_media_urls: text('local_media_urls').notNull().default('[]'),
  discord_message_id: text('discord_message_id'),
  discord_posted_at: text('discord_posted_at'),
  summary: text('summary').notNull().default(''),
  digest_id: text('digest_id'),
  highlighted: boolean('highlighted').default(false),
  highlight_note: text('highlight_note').default(''),
  top_replies: text('top_replies').default('[]'),
  reply_count: integer('reply_count').default(0),
  retweet_count: integer('retweet_count').default(0),
  like_count: integer('like_count').default(0),
  engage: boolean('engage').default(false),
  engage_reason: text('engage_reason'),
});
export type Tweet = InferSelectModel<typeof tweets>;

// --- tweet_ratings ---
export const tweetRatings = pgTable('tweet_ratings', {
  tweet_id: text('tweet_id').primaryKey().references(() => tweets.id),
  rating: text('rating').notNull(), // 'fire' | 'meh' | 'noise'
  rated_at: text('rated_at').notNull(),
});
export type TweetRating = InferSelectModel<typeof tweetRatings>;

// --- tweet_interactions ---
export const tweetInteractions = pgTable('tweet_interactions', {
  id: serial('id').primaryKey(),
  tweet_id: text('tweet_id').notNull().references(() => tweets.id),
  action: text('action').notNull(),
  created_at: text('created_at').notNull(),
});
export type TweetInteraction = InferSelectModel<typeof tweetInteractions>;

// --- garden ---
export const garden = pgTable('garden', {
  id: text('id').primaryKey(),
  title: text('title').notNull().default(''),
  content: text('content').notNull(),
  type: text('type').notNull().default('tweet'),
  interest: text('interest').notNull().default('information'),
  temporal: text('temporal').notNull().default('ever'),
  tags: text('tags').notNull().default('[]'),
  note: text('note').notNull().default(''),
  original_source: text('original_source'),
  media_urls: text('media_urls').notNull().default('[]'),
  metadata: text('metadata').notNull().default('{}'),
  enriched: boolean('enriched').default(false),
  instance_type: text('instance_type').notNull().default('instance'),
  snooze_until: text('snooze_until'),
  expires_at: text('expires_at'),
  group: text('group'),
  created_at: text('created_at').notNull(),
  saved_at: text('saved_at').notNull(),
});
export type GardenItem = InferSelectModel<typeof garden>;

// --- project_notes ---
export const projectNotes = pgTable('project_notes', {
  id: text('id').primaryKey(),
  project_id: text('project_id').notNull().references(() => projects.id),
  content: text('content').notNull(),
  pinned: boolean('pinned').default(false),
  created_at: text('created_at').notNull(),
});
export type ProjectNote = InferSelectModel<typeof projectNotes>;

// --- og_cache ---
export const ogCache = pgTable('og_cache', {
  url: text('url').primaryKey(),
  title: text('title'),
  description: text('description'),
  image: text('image'),
  fetched_at: text('fetched_at').notNull(),
});
export type OGCacheEntry = InferSelectModel<typeof ogCache>;

// --- turns ---
export const turns = pgTable('turns', {
  id: text('id').primaryKey(),
  task_id: text('task_id').notNull().references(() => issues.id),
  round_number: integer('round_number').notNull().default(1),
  type: text('type').notNull(), // 'instruction' | 'result' | 'note'
  author: text('author').notNull(),
  content: text('content').notNull().default(''),
  links: text('links').default('[]'),
  created_at: text('created_at').$defaultFn(() => new Date().toISOString()),
  updated_at: text('updated_at').$defaultFn(() => new Date().toISOString()),
});
export type Turn = InferSelectModel<typeof turns>;

// --- digests ---
export const digests = pgTable('digests', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  brief: text('brief').notNull().default(''),
  items: text('items').notNull().default('[]'),
  stats: text('stats'),
  stats_scraped: integer('stats_scraped').default(0),
  stats_kept: integer('stats_kept').default(0),
  stats_dropped: integer('stats_dropped').default(0),
  created_at: text('created_at').notNull(),
  discord_message_id: text('discord_message_id'),
  discord_thread_id: text('discord_thread_id'),
});
export type Digest = InferSelectModel<typeof digests>;

// --- plans ---
export const plans = pgTable('plans', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  task_id: text('task_id'),
  project_id: text('project_id'),
  author: text('author').notNull(),
  status: text('status').notNull().default('draft'),
  responses: text('responses').notNull().default('{}'),
  created_at: text('created_at').$defaultFn(() => new Date().toISOString()),
  updated_at: text('updated_at').$defaultFn(() => new Date().toISOString()),
});
export type Plan = InferSelectModel<typeof plans>;

// --- dispatch_queue ---
// Replaces filesystem-based dispatch-pending.json and dispatch-watchdog.json
// Tracks dispatched tasks and pending dispatches — works on Vercel (no filesystem needed)
export const dispatchQueue = pgTable('dispatch_queue', {
  id: text('id').primaryKey(), // random UUID
  task_id: text('task_id').notNull().references(() => issues.id),
  agent_id: text('agent_id').notNull(),
  status: text('status').notNull().default('pending'), // 'pending' | 'dispatched' | 'completed' | 'failed'
  turn_count_at_dispatch: integer('turn_count_at_dispatch').default(0),
  retry_count: integer('retry_count').default(0),
  dispatched_at: text('dispatched_at'),
  completed_at: text('completed_at'),
  created_at: text('created_at').$defaultFn(() => new Date().toISOString()),
});
export type DispatchQueueEntry = InferSelectModel<typeof dispatchQueue>;
