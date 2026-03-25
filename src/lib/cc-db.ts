import { randomUUID } from 'crypto';
import { logger } from './logger';
import { db } from '@/db/client';
import {
  issues,
  projects,
  issueComments,
  turns as turnsTable,
  garden,
  tweets,
  tweetRatings,
  plans as plansTable,
  digests,
  projectNotes,
  type Issue,
  type Project as CCProjectRow,
  type IssueComment,
  type Turn as TurnRow,
  type GardenItem as GardenItemRow,
  type Tweet as TweetRow,
  type Digest as DigestRow,
} from '@/db/schema';
import { eq, and, or, desc, asc, sql, inArray, isNull, isNotNull, ne, like, ilike } from 'drizzle-orm';

// --- New status & column types ---

export type IssueStatus = 'draft' | 'open' | 'closed';
export type KanbanColumn = 'drafts' | 'open' | 'closed';
export type BadgeType = 'idea' | 'proposal' | null;

// Known agents (non-human creators produce "proposal" badge)
const HUMAN_USERS = new Set(['cri']);

/**
 * Derive which kanban column an issue belongs to.
 */
export function deriveColumn(issue: { status: string; assignee: string }): KanbanColumn {
  const s = issue.status as IssueStatus;
  if (s === 'closed') return 'closed';
  if (s === 'draft') return 'drafts';
  return 'open';
}

/**
 * Derive badge type from status + creator.
 */
export function deriveBadge(status: string, creator: string): BadgeType {
  if (status !== 'draft') return null;
  if (!creator) return null;
  return HUMAN_USERS.has(creator.toLowerCase()) ? 'idea' : 'proposal';
}

/**
 * @deprecated Use db from @/db/client directly. Will be removed after Phase 3 migration.
 */
export function getCCDatabase(_readonly = true): never {
  throw new Error('getCCDatabase() is deprecated. Use Drizzle db from @/db/client instead.');
}

/**
 * @deprecated Use db from @/db/client directly. Will be removed after Phase 3 migration.
 */
export function getCCDatabaseWrite(): never {
  throw new Error('getCCDatabaseWrite() is deprecated. Use Drizzle db from @/db/client instead.');
}

/**
 * No-op: schema migrations handled by drizzle-kit.
 */
export function runCCMigrations(): void {
  logger.info('cc-db: runCCMigrations() is a no-op — schema handled by drizzle-kit');
}

// --- Raw row types from control-center.db ---

export interface CCIssue {
  id: string;
  project_id: string | null;
  title: string;
  description: string;
  status: IssueStatus;
  assignee: string;
  creator: string;
  priority: 'low' | 'normal' | 'high';
  created_at: string; // ISO
  updated_at: string; // ISO
  archived: boolean;
  schedule: string;
  parent_id: string | null;
  notion_id: string;
  plan_path: string | null;
  plan_id: string | null;
  last_turn_at: string | null;
  seen_at: string | null;
  picked: boolean;
  picked_at: string | null;
  picked_by: string;
  blocked_by: string; // JSON array of task IDs e.g. '["uuid1","uuid2"]'
}

export interface CCProject {
  id: string;
  title: string;
  description: string;
  emoji: string;
  created_at: string;
  updated_at: string;
  archived: boolean;
  schedule: string;
  repo_url: string;
  local_path: string;
}

export type PlanStatus = 'draft' | 'review' | 'approved' | 'rejected';

export interface CCPlan {
  id: string;
  title: string;
  content: string;
  task_id: string | null;
  project_id: string | null;
  author: string;
  status: PlanStatus;
  responses: string; // JSON blob
  created_at: string;
  updated_at: string;
}

export interface CCComment {
  id: string;
  issue_id: string;
  author: string;
  content: string;
  created_at: string; // ISO
  attachments?: string; // JSON array of {url, filename, originalName?}
}

// --- Turn types ---

export type TurnType = 'instruction' | 'result' | 'note';

export interface Turn {
  id: string;
  task_id: string;
  round_number: number;
  type: TurnType;
  author: string;
  content: string;
  links: Array<{ url: string; title?: string; type?: string }>;
  created_at: string;
  updated_at: string;
}

function parseTurnRow(row: TurnRow): Turn {
  let links: Turn['links'] = [];
  try { links = JSON.parse(row.links || '[]'); } catch { links = []; }
  return {
    id: row.id,
    task_id: row.task_id,
    round_number: row.round_number ?? 1,
    type: row.type as TurnType,
    author: row.author,
    content: row.content,
    links,
    created_at: row.created_at ?? new Date().toISOString(),
    updated_at: row.updated_at ?? new Date().toISOString(),
  };
}

export async function getTurns(taskId: string): Promise<Turn[]> {
  const rows = await db
    .select()
    .from(turnsTable)
    .where(eq(turnsTable.task_id, taskId))
    .orderBy(asc(turnsTable.round_number), asc(turnsTable.created_at));
  return rows.map(parseTurnRow);
}

export async function getCurrentRound(taskId: string): Promise<number> {
  const rows = await db
    .select({ max_round: sql<number | null>`MAX(${turnsTable.round_number})` })
    .from(turnsTable)
    .where(eq(turnsTable.task_id, taskId));
  return rows[0]?.max_round ?? 0;
}

export async function createTurn(
  taskId: string,
  turn: { assigned_to: string; content: string; links?: Turn['links']; type?: TurnType; author?: string }
): Promise<Turn> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const linksJson = JSON.stringify(turn.links || []);

  // Infer author from current issue assignee if not provided
  const issue = await getIssue(taskId);
  const turnAuthor = turn.author || issue?.assignee || 'system';

  // Note handling — kept for backward compat
  if (turn.type === 'note') {
    const currentMax = await getCurrentRound(taskId);

    await db.update(issues).set({ last_turn_at: now, updated_at: now }).where(eq(issues.id, taskId));

    await db.insert(turnsTable).values({
      id,
      task_id: taskId,
      round_number: currentMax,
      type: 'note',
      author: turnAuthor,
      content: turn.content,
      links: linksJson,
      created_at: now,
      updated_at: now,
    });

    return {
      id,
      task_id: taskId,
      round_number: currentMax,
      type: 'note',
      author: turnAuthor,
      content: turn.content,
      links: turn.links || [],
      created_at: now,
      updated_at: now,
    };
  }

  // Unified logic: every turn reassigns, resets picked, reopens if closed/done
  const currentMax = await getCurrentRound(taskId);
  const roundNumber = (currentMax ?? 0) + 1;

  // Update issue: reassign, reset picked, reopen if closed
  const issueRow = await getIssue(taskId);
  const newStatus = issueRow && (issueRow.status === 'done' || issueRow.status === 'closed') ? 'open' : (issueRow?.status ?? 'open');

  await db.update(issues).set({
    assignee: turn.assigned_to,
    picked: false,
    picked_at: null,
    last_turn_at: now,
    updated_at: now,
    status: newStatus,
  }).where(eq(issues.id, taskId));

  await db.insert(turnsTable).values({
    id,
    task_id: taskId,
    round_number: roundNumber,
    type: 'result',
    author: turnAuthor,
    content: turn.content,
    links: linksJson,
    created_at: now,
    updated_at: now,
  });

  return {
    id,
    task_id: taskId,
    round_number: roundNumber,
    type: 'result',
    author: turnAuthor,
    content: turn.content,
    links: turn.links || [],
    created_at: now,
    updated_at: now,
  };
}

export async function updateTurn(turnId: string, content: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .update(turnsTable)
    .set({ content, updated_at: now })
    .where(and(eq(turnsTable.id, turnId), eq(turnsTable.type, 'note')));
}

export async function setTaskPicked(taskId: string, agent?: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .update(issues)
    .set({ picked: true, picked_at: now, picked_by: agent || '' })
    .where(eq(issues.id, taskId));
}

export async function setTaskSeen(taskId: string): Promise<void> {
  const now = new Date().toISOString();
  await db.update(issues).set({ seen_at: now }).where(eq(issues.id, taskId));
}

// --- Priority mapping (CC uses low/normal/high, MC uses low/medium/high) ---

const PRIORITY_TO_MC: Record<string, string> = {
  low: 'low',
  normal: 'medium',
  high: 'high',
};

export const PRIORITY_FROM_MC: Record<string, string> = {
  low: 'low',
  medium: 'normal',
  high: 'high',
  urgent: 'high',
};

export function isoToUnix(iso: string): number {
  const d = new Date(iso);
  return Math.floor(d.getTime() / 1000);
}

// --- Query functions ---

type IssueWithExtras = CCIssue & { last_comment_at?: string | null; last_turn_type?: string | null; last_turn_by?: string | null };

export async function getIssues(opts?: {
  status?: string;
  assigned_to?: string;
  priority?: string;
  column?: KanbanColumn;
  limit?: number;
  offset?: number;
}): Promise<{ issues: IssueWithExtras[]; total: number }> {
  const limit = opts?.limit ?? 200;
  const offset = opts?.offset ?? 0;

  // Build conditions
  const conditions: ReturnType<typeof eq>[] = [];
  // archived = false
  const baseCondition = eq(issues.archived, false);

  let whereClause = sql`${issues.archived} = false`;

  if (opts?.status) {
    whereClause = sql`${whereClause} AND ${issues.status} = ${opts.status}`;
  }
  if (opts?.assigned_to) {
    whereClause = sql`${whereClause} AND LOWER(${issues.assignee}) = LOWER(${opts.assigned_to})`;
  }
  if (opts?.priority) {
    const ccPriority = PRIORITY_FROM_MC[opts.priority] || opts.priority;
    whereClause = sql`${whereClause} AND ${issues.priority} = ${ccPriority}`;
  }
  if (opts?.column) {
    switch (opts.column) {
      case 'drafts':
        whereClause = sql`${whereClause} AND ${issues.status} = 'draft'`;
        break;
      case 'open':
        whereClause = sql`${whereClause} AND ${issues.status} = 'open'`;
        break;
      case 'closed':
        whereClause = sql`${whereClause} AND ${issues.status} = 'closed'`;
        break;
    }
  }

  // Use raw SQL for the complex query with subqueries
  const rows = await db.execute(sql`
    SELECT i.*,
      (SELECT MAX(c.created_at) FROM issue_comments c WHERE c.issue_id = i.id) AS last_comment_at,
      (SELECT t.type FROM turns t WHERE t.task_id = i.id ORDER BY t.created_at DESC LIMIT 1) AS last_turn_type,
      (SELECT t.author FROM turns t WHERE t.task_id = i.id ORDER BY t.created_at DESC LIMIT 1) AS last_turn_by
    FROM issues i
    WHERE ${whereClause}
    ORDER BY COALESCE(i.last_turn_at, i.updated_at) DESC
    LIMIT ${limit} OFFSET ${offset}
  `);

  const countRows = await db.execute(sql`
    SELECT COUNT(*) as total FROM issues i WHERE ${whereClause}
  `);

  const total = Number((countRows.rows[0] as any)?.total ?? 0);
  const issueRows = (rows.rows as any[]).map(r => ({
    ...r,
    archived: Boolean(r.archived),
    picked: Boolean(r.picked),
  })) as IssueWithExtras[];

  return { issues: issueRows, total };
}

export async function getIssue(id: string): Promise<CCIssue | undefined> {
  const rows = await db.select().from(issues).where(eq(issues.id, id)).limit(1);
  if (!rows[0]) return undefined;
  return { ...rows[0], archived: Boolean(rows[0].archived), picked: Boolean(rows[0].picked) } as CCIssue;
}

export async function getProjects(): Promise<CCProject[]> {
  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.archived, false))
    .orderBy(asc(projects.title));
  return rows.map(r => ({ ...r, archived: Boolean(r.archived) })) as CCProject[];
}

export async function getProject(id: string): Promise<CCProject | undefined> {
  const rows = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!rows[0]) return undefined;
  return { ...rows[0], archived: Boolean(rows[0].archived) } as CCProject;
}

export async function getIssueComments(issueId: string): Promise<CCComment[]> {
  const rows = await db
    .select()
    .from(issueComments)
    .where(eq(issueComments.issue_id, issueId))
    .orderBy(asc(issueComments.created_at));
  return rows as CCComment[];
}

// --- Map CC issue -> MC Task shape ---

export function mapIssueToTask(issue: CCIssue & { last_comment_at?: string | null }, projectTitle?: string) {
  return {
    id: issue.id,
    title: issue.title,
    description: issue.description || '',
    status: issue.status,
    column: deriveColumn(issue),
    badge: deriveBadge(issue.status, issue.creator || ''),
    priority: PRIORITY_TO_MC[issue.priority] || 'medium',
    assigned_to: issue.assignee || '',
    creator: issue.creator || '',
    created_at: isoToUnix(issue.created_at),
    updated_at: isoToUnix(issue.updated_at),
    last_activity_at: issue.last_turn_at
      ? Math.max(isoToUnix(issue.updated_at), isoToUnix(issue.last_turn_at))
      : issue.last_comment_at
        ? Math.max(isoToUnix(issue.updated_at), isoToUnix(issue.last_comment_at))
        : isoToUnix(issue.updated_at),
    tags: [],
    metadata: {
      project_id: issue.project_id || '',
      project_title: projectTitle || '',
      parent_id: issue.parent_id || '',
      schedule: issue.schedule || '',
      source: 'control-center',
    },
    project_id: issue.project_id || '',
    project_title: projectTitle || '',
    plan_path: issue.plan_path || null,
    plan_id: issue.plan_id || null,
    last_turn_at: issue.last_turn_at ? isoToUnix(issue.last_turn_at) : null,
    seen_at: issue.seen_at ? isoToUnix(issue.seen_at) : null,
    picked: issue.picked ? 1 : 0,
    picked_at: issue.picked_at ? isoToUnix(issue.picked_at) : null,
    picked_by: issue.picked_by || '',
    blocked_by: parseBlockedBy(issue.blocked_by),
    last_turn_type: (issue as any).last_turn_type || null,
    last_turn_by: (issue as any).last_turn_by || null,
  };
}

// --- Map CC comment -> MC Comment shape ---

export function mapCCComment(c: CCComment) {
  let attachments: Array<{ url: string; filename: string; originalName?: string }> = [];
  if (c.attachments) {
    try {
      attachments = JSON.parse(c.attachments);
    } catch {
      attachments = [];
    }
  }

  return {
    id: c.id,
    task_id: c.issue_id,
    author: c.author,
    content: c.content,
    created_at: isoToUnix(c.created_at),
    mentions: [],
    replies: [],
    attachments,
  };
}

// --- Blocked-by helpers ---

export function parseBlockedBy(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

export async function getOpenBlockerIds(blockerIds: string[]): Promise<Set<string>> {
  if (blockerIds.length === 0) return new Set();
  const rows = await db
    .select({ id: issues.id })
    .from(issues)
    .where(and(inArray(issues.id, blockerIds), ne(issues.status, 'closed')));
  return new Set(rows.map(r => r.id));
}

export async function getBlockerDetails(blockerIds: string[]): Promise<Array<{ id: string; title: string; status: string }>> {
  if (blockerIds.length === 0) return [];
  const rows = await db
    .select({ id: issues.id, title: issues.title, status: issues.status })
    .from(issues)
    .where(inArray(issues.id, blockerIds));
  return rows as Array<{ id: string; title: string; status: string }>;
}

// --- Tweet types ---

export type TweetRating = 'fire' | 'meh' | 'noise';

export interface CCTweet {
  id: string;
  title: string;
  author: string;
  theme: string;
  verdict: string;
  action: string;
  source: string;
  tweet_link: string;
  digest: string;
  content: string;
  created_at: string;
  scraped_at: string;
  pinned: boolean;
  media_urls: string;
  triage_status: string;
  snooze_until: string | null;
  rating: TweetRating | null; // joined from tweet_ratings
  summary: string;
  digest_id: string | null;
  discord_message_id: string | null;
  discord_posted_at: string | null;
}

export interface TweetFilters {
  theme?: string;
  rating?: string;
  verdict?: string;
  digest?: string;
  pinned?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

// --- Tweet query functions ---

export async function getTweets(filters?: TweetFilters): Promise<{ tweets: CCTweet[]; total: number; themes: string[]; digests: string[] }> {
  const limit = filters?.limit ?? 50;
  const offset = filters?.offset ?? 0;

  // Build WHERE clause dynamically
  let whereClause = sql`true`;

  if (filters?.theme) {
    whereClause = sql`${whereClause} AND t.theme = ${filters.theme}`;
  }
  if (filters?.digest) {
    whereClause = sql`${whereClause} AND t.digest = ${filters.digest}`;
  }
  if (filters?.pinned) {
    whereClause = sql`${whereClause} AND t.pinned = true`;
  }
  if (filters?.search) {
    const term = `%${filters.search}%`;
    whereClause = sql`${whereClause} AND (t.content ILIKE ${term} OR t.title ILIKE ${term} OR t.author ILIKE ${term})`;
  }
  if (filters?.rating) {
    if (filters.rating === 'unrated') {
      whereClause = sql`${whereClause} AND r.rating IS NULL`;
    } else {
      whereClause = sql`${whereClause} AND r.rating = ${filters.rating}`;
    }
  }
  if (filters?.verdict) {
    if (filters.verdict === 'curated') {
      whereClause = sql`${whereClause} AND t.verdict IN ('keep', 'kept')`;
    } else {
      whereClause = sql`${whereClause} AND t.verdict = ${filters.verdict}`;
    }
  }

  const tweetRows = await db.execute(sql`
    SELECT t.*, r.rating FROM tweets t
    LEFT JOIN tweet_ratings r ON t.id = r.tweet_id
    WHERE ${whereClause}
    ORDER BY t.pinned DESC, t.scraped_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `);

  const countRows = await db.execute(sql`
    SELECT COUNT(*) as total FROM tweets t
    LEFT JOIN tweet_ratings r ON t.id = r.tweet_id
    WHERE ${whereClause}
  `);

  const themeRows = await db.execute(sql`
    SELECT DISTINCT theme FROM tweets WHERE theme IS NOT NULL AND theme != '' ORDER BY theme
  `);

  const digestRows = await db.execute(sql`
    SELECT DISTINCT digest FROM tweets WHERE digest IS NOT NULL AND digest != '' ORDER BY digest DESC
  `);

  const total = Number((countRows.rows[0] as any)?.total ?? 0);
  const tweetList = (tweetRows.rows as any[]).map(r => ({
    ...r,
    pinned: Boolean(r.pinned),
  })) as CCTweet[];
  const themes = (themeRows.rows as any[]).map(r => r.theme as string);
  const digestList = (digestRows.rows as any[]).map(r => r.digest as string);

  return { tweets: tweetList, total, themes, digests: digestList };
}

export async function rateTweet(id: string, rating: TweetRating | null): Promise<void> {
  if (rating === null) {
    await db.delete(tweetRatings).where(eq(tweetRatings.tweet_id, id));
  } else {
    await db
      .insert(tweetRatings)
      .values({ tweet_id: id, rating, rated_at: new Date().toISOString() })
      .onConflictDoUpdate({
        target: tweetRatings.tweet_id,
        set: { rating, rated_at: new Date().toISOString() },
      });
  }
}

export async function pinTweet(id: string, pinned: boolean): Promise<void> {
  await db.update(tweets).set({ pinned }).where(eq(tweets.id, id));
}

export async function triageUpdate(id: string, triageStatus: string): Promise<void> {
  await db.update(tweets).set({ triage_status: triageStatus }).where(eq(tweets.id, id));
}

export async function getTweetStats(): Promise<{ by_theme: Record<string, number>; by_rating: Record<string, number>; by_digest: Record<string, number>; total: number }> {
  const totalRows = await db.execute(sql`SELECT COUNT(*) as c FROM tweets`);
  const total = Number((totalRows.rows[0] as any)?.c ?? 0);

  const themeRows = await db.execute(sql`
    SELECT theme, COUNT(*) as c FROM tweets WHERE theme IS NOT NULL AND theme != '' GROUP BY theme
  `);
  const by_theme: Record<string, number> = {};
  for (const r of themeRows.rows as any[]) by_theme[r.theme] = Number(r.c);

  const ratingRows = await db.execute(sql`
    SELECT r.rating, COUNT(*) as c FROM tweet_ratings r GROUP BY r.rating
  `);
  const by_rating: Record<string, number> = {};
  for (const r of ratingRows.rows as any[]) by_rating[r.rating] = Number(r.c);

  const digestRows = await db.execute(sql`
    SELECT digest, COUNT(*) as c FROM tweets WHERE digest IS NOT NULL AND digest != '' GROUP BY digest ORDER BY digest DESC LIMIT 20
  `);
  const by_digest: Record<string, number> = {};
  for (const r of digestRows.rows as any[]) by_digest[r.digest] = Number(r.c);

  return { total, by_theme, by_rating, by_digest };
}

// --- Digest types & functions ---

export interface CCDigest {
  id: string;
  label: string;
  brief: string;
  stats_scraped: number;
  stats_kept: number;
  stats_dropped: number;
  created_at: string;
  discord_message_id: string | null;
  discord_thread_id: string | null;
}

export interface CreateDigestInput {
  label: string;
  brief: string;
  stats_scraped?: number;
  stats_kept?: number;
  stats_dropped?: number;
}

export async function createDigest(input: CreateDigestInput): Promise<CCDigest> {
  const id = randomUUID();
  const now = new Date().toISOString();

  await db.insert(digests).values({
    id,
    label: input.label,
    brief: input.brief,
    stats_scraped: input.stats_scraped ?? 0,
    stats_kept: input.stats_kept ?? 0,
    stats_dropped: input.stats_dropped ?? 0,
    created_at: now,
  });

  return {
    id,
    label: input.label,
    brief: input.brief,
    stats_scraped: input.stats_scraped ?? 0,
    stats_kept: input.stats_kept ?? 0,
    stats_dropped: input.stats_dropped ?? 0,
    created_at: now,
    discord_message_id: null,
    discord_thread_id: null,
  };
}

export async function updateDigestDiscordInfo(
  digestId: string,
  discordMessageId: string,
  discordThreadId: string
): Promise<void> {
  await db
    .update(digests)
    .set({ discord_message_id: discordMessageId, discord_thread_id: discordThreadId })
    .where(eq(digests.id, digestId));
}

export async function updateTweetSummary(tweetId: string, summary: string, digestId?: string): Promise<void> {
  if (digestId) {
    await db.update(tweets).set({ summary, digest_id: digestId }).where(eq(tweets.id, tweetId));
  } else {
    await db.update(tweets).set({ summary }).where(eq(tweets.id, tweetId));
  }
}

export async function getDigest(id: string): Promise<CCDigest | undefined> {
  const rows = await db.select().from(digests).where(eq(digests.id, id)).limit(1);
  if (!rows[0]) return undefined;
  return {
    id: rows[0].id,
    label: rows[0].label,
    brief: rows[0].brief,
    stats_scraped: rows[0].stats_scraped ?? 0,
    stats_kept: rows[0].stats_kept ?? 0,
    stats_dropped: rows[0].stats_dropped ?? 0,
    created_at: rows[0].created_at,
    discord_message_id: rows[0].discord_message_id ?? null,
    discord_thread_id: rows[0].discord_thread_id ?? null,
  };
}

export async function getDigests(limit = 20): Promise<CCDigest[]> {
  const rows = await db
    .select()
    .from(digests)
    .orderBy(desc(digests.created_at))
    .limit(limit);
  return rows.map(r => ({
    id: r.id,
    label: r.label,
    brief: r.brief,
    stats_scraped: r.stats_scraped ?? 0,
    stats_kept: r.stats_kept ?? 0,
    stats_dropped: r.stats_dropped ?? 0,
    created_at: r.created_at,
    discord_message_id: r.discord_message_id ?? null,
    discord_thread_id: r.discord_thread_id ?? null,
  }));
}

// --- Garden types ---

export interface CCGardenItem {
  id: string;
  content: string;
  type: string;
  interest: string;
  temporal: string;
  tags: string;        // JSON array
  note: string;
  original_source: string | null;
  media_urls: string;  // JSON array
  metadata: string;    // JSON blob
  enriched: boolean;
  instance_type: string;
  snooze_until: string | null;
  expires_at: string | null;
  created_at: string;
  saved_at: string;
}

export interface GardenFilters {
  interest?: string;
  type?: string;
  temporal?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface GardenStatsResult {
  byInterest: Record<string, number>;
  byType: Record<string, number>;
  total: number;
}

// --- Garden query functions ---

export async function getGardenItems(filters?: GardenFilters): Promise<{ items: CCGardenItem[]; total: number }> {
  const limit = filters?.limit ?? 100;
  const offset = filters?.offset ?? 0;

  let whereClause = sql`true`;

  if (filters?.interest) {
    whereClause = sql`${whereClause} AND ${garden.interest} = ${filters.interest}`;
  }
  if (filters?.type) {
    whereClause = sql`${whereClause} AND ${garden.type} = ${filters.type}`;
  }
  if (filters?.temporal) {
    whereClause = sql`${whereClause} AND ${garden.temporal} = ${filters.temporal}`;
  }
  if (filters?.search) {
    const term = `%${filters.search}%`;
    whereClause = sql`${whereClause} AND (${garden.content} ILIKE ${term} OR ${garden.note} ILIKE ${term} OR ${garden.tags} ILIKE ${term})`;
  }

  const rows = await db.execute(sql`
    SELECT * FROM garden WHERE ${whereClause} ORDER BY saved_at DESC LIMIT ${limit} OFFSET ${offset}
  `);
  const countRows = await db.execute(sql`
    SELECT COUNT(*) as total FROM garden WHERE ${whereClause}
  `);

  const total = Number((countRows.rows[0] as any)?.total ?? 0);
  const items = (rows.rows as any[]).map(r => ({
    ...r,
    enriched: Boolean(r.enriched),
  })) as CCGardenItem[];

  return { items, total };
}

export async function getGardenItem(id: string): Promise<CCGardenItem | undefined> {
  const rows = await db.select().from(garden).where(eq(garden.id, id)).limit(1);
  if (!rows[0]) return undefined;
  return { ...rows[0], enriched: Boolean(rows[0].enriched) } as CCGardenItem;
}

export async function updateGardenItem(id: string, fields: Partial<Pick<CCGardenItem, 'content' | 'interest' | 'type' | 'temporal' | 'tags' | 'note' | 'original_source' | 'instance_type'>>): Promise<void> {
  if (Object.keys(fields).length === 0) return;
  await db.update(garden).set(fields as any).where(eq(garden.id, id));
}

export async function deleteGardenItem(id: string): Promise<void> {
  await db.delete(garden).where(eq(garden.id, id));
}

export async function getGardenStats(): Promise<GardenStatsResult> {
  const totalRows = await db.execute(sql`SELECT COUNT(*) as c FROM garden`);
  const total = Number((totalRows.rows[0] as any)?.c ?? 0);

  const interestRows = await db.execute(sql`
    SELECT interest, COUNT(*) as c FROM garden WHERE interest IS NOT NULL AND interest != '' GROUP BY interest
  `);
  const byInterest: Record<string, number> = {};
  for (const r of interestRows.rows as any[]) byInterest[r.interest] = Number(r.c);

  const typeRows = await db.execute(sql`
    SELECT type, COUNT(*) as c FROM garden WHERE type IS NOT NULL AND type != '' GROUP BY type
  `);
  const byType: Record<string, number> = {};
  for (const r of typeRows.rows as any[]) byType[r.type] = Number(r.c);

  return { total, byInterest, byType };
}

// --- Inbox aggregation ---

export type InboxSourceType = 'task' | 'garden' | 'xfeed' | 'notification';

export interface InboxItem {
  id: string;
  source: InboxSourceType;
  title: string;
  subtitle: string;
  icon: string;
  badge: string;
  badgeColor: string;
  timestamp: number; // unix ms
  actionUrl?: string;
  metadata: Record<string, any>;
}

export interface InboxCounts {
  task: number;
  garden: number;
  xfeed: number;
  notification: number;
}

export async function getInboxCounts(): Promise<InboxCounts> {
  const taskRows = await db.execute(sql`
    SELECT COUNT(*) as c FROM issues WHERE status = 'draft' AND archived = false
  `);
  const taskCount = Number((taskRows.rows[0] as any)?.c ?? 0);

  const gardenRows = await db.execute(sql`
    SELECT COUNT(*) as c FROM garden WHERE temporal = 'now'
  `);
  const gardenCount = Number((gardenRows.rows[0] as any)?.c ?? 0);

  const xfeedRows = await db.execute(sql`
    SELECT COUNT(*) as c FROM tweets t
    LEFT JOIN tweet_ratings r ON t.id = r.tweet_id
    WHERE r.tweet_id IS NULL AND t.triage_status = 'pending'
  `);
  const xfeedCount = Number((xfeedRows.rows[0] as any)?.c ?? 0);

  return { task: taskCount, garden: gardenCount, xfeed: xfeedCount, notification: 0 };
}

export async function getInboxItems(source?: InboxSourceType, limit = 50): Promise<InboxItem[]> {
  const items: InboxItem[] = [];

  // Tasks: drafts needing attention
  if (!source || source === 'task') {
    const taskRows = await db
      .select()
      .from(issues)
      .where(and(eq(issues.status, 'draft'), eq(issues.archived, false)))
      .orderBy(desc(issues.updated_at))
      .limit(limit);

    for (const t of taskRows) {
      const badge = deriveBadge(t.status, t.creator || '');
      items.push({
        id: `task-${t.id}`,
        source: 'task',
        title: t.title,
        subtitle: badge === 'proposal' ? 'Agent proposal — needs review' : 'Draft — needs shaping',
        icon: badge === 'proposal' ? '📋' : '💡',
        badge: badge || 'draft',
        badgeColor: badge === 'proposal' ? 'blue' : 'amber',
        timestamp: new Date(t.updated_at).getTime(),
        actionUrl: `tasks?id=${t.id}`,
        metadata: {
          status: t.status,
          assignee: t.assignee,
          priority: t.priority,
          project_id: t.project_id,
        },
      });
    }
  }

  // Garden: temporal = 'now'
  if (!source || source === 'garden') {
    const gardenRows = await db
      .select()
      .from(garden)
      .where(eq(garden.temporal, 'now'))
      .orderBy(desc(garden.saved_at))
      .limit(limit);

    for (const g of gardenRows) {
      items.push({
        id: `garden-${g.id}`,
        source: 'garden',
        title: g.content.slice(0, 120),
        subtitle: g.note || g.type || 'Check out now',
        icon: '🌱',
        badge: g.interest || g.type || 'now',
        badgeColor: 'emerald',
        timestamp: new Date(g.saved_at || g.created_at).getTime(),
        actionUrl: 'garden',
        metadata: {
          interest: g.interest,
          type: g.type,
          temporal: g.temporal,
        },
      });
    }
  }

  // X Feed: single summary card with count
  if (!source || source === 'xfeed') {
    const xfeedRows = await db.execute(sql`
      SELECT COUNT(*) as c FROM tweets t
      LEFT JOIN tweet_ratings r ON t.id = r.tweet_id
      WHERE r.tweet_id IS NULL AND t.triage_status = 'pending'
    `);
    const xfeedCount = Number((xfeedRows.rows[0] as any)?.c ?? 0);

    if (xfeedCount > 0) {
      items.push({
        id: 'xfeed-summary',
        source: 'xfeed',
        title: `${xfeedCount} unrated tweet${xfeedCount === 1 ? '' : 's'}`,
        subtitle: 'Click to open X Feed panel',
        icon: '📡',
        badge: `${xfeedCount} pending`,
        badgeColor: 'purple',
        timestamp: Date.now(),
        actionUrl: 'xfeed',
        metadata: { count: xfeedCount },
      });
    }
  }

  // Sort by timestamp DESC
  items.sort((a, b) => b.timestamp - a.timestamp);

  return items.slice(0, limit);
}

// --- Project CRUD Operations ---

export async function createProject(
  title: string,
  description: string,
  emoji: string,
  repo_url?: string,
  local_path?: string
): Promise<CCProject> {
  const id = `proj-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const now = new Date().toISOString();

  await db.insert(projects).values({
    id,
    title,
    description: description || '',
    emoji: emoji || '📁',
    created_at: now,
    updated_at: now,
    archived: false,
    schedule: '',
    repo_url: repo_url || '',
    local_path: local_path || '',
  });

  logger.info({ projectId: id, title }, 'Created project');

  return {
    id,
    title,
    description: description || '',
    emoji: emoji || '📁',
    created_at: now,
    updated_at: now,
    archived: false,
    schedule: '',
    repo_url: repo_url || '',
    local_path: local_path || '',
  };
}

export async function updateProject(id: string, fields: Partial<Pick<CCProject, 'title' | 'description' | 'emoji' | 'repo_url' | 'local_path'>>): Promise<void> {
  const updates: Record<string, any> = { ...fields, updated_at: new Date().toISOString() };
  if (Object.keys(fields).length === 0) return;
  await db.update(projects).set(updates).where(eq(projects.id, id));
  logger.info({ projectId: id, fields }, 'Updated project');
}

export async function archiveProject(id: string): Promise<void> {
  await db
    .update(projects)
    .set({ archived: true, updated_at: new Date().toISOString() })
    .where(eq(projects.id, id));
  logger.info({ projectId: id }, 'Archived project');
}

export async function getProjectTaskCount(projectId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(issues)
    .where(and(eq(issues.project_id, projectId), eq(issues.archived, false)));
  return Number(rows[0]?.count ?? 0);
}

export async function getProjectLastActivity(projectId: string): Promise<number> {
  const rows = await db.execute(sql`
    SELECT MAX(updated_at) as last_updated FROM issues WHERE project_id = ${projectId} AND archived = false
  `);
  const lastUpdated = (rows.rows[0] as any)?.last_updated;
  if (!lastUpdated) return 0;
  return isoToUnix(lastUpdated);
}
