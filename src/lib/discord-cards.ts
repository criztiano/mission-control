import { logger } from '@/lib/logger';
import type { CCTweet, TweetRating, Turn } from '@/lib/cc-db';

const TASKS_CHANNEL_ID = '1482407953763012618';

const DISCORD_API = 'https://discord.com/api/v10';

interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

interface Embed {
  title?: string;
  description?: string;
  color?: number;
  fields?: EmbedField[];
  footer?: { text: string };
  timestamp?: string;
  url?: string;
}

export interface GardenItem {
  id: string;
  content: string;
  type: string;
  interest: string;
  temporal: string;
  tags: string;
  note: string;
  original_source: string | null;
  media_urls: string;
  metadata: string;
  saved_at: string;
}

interface DiscordButton {
  type: 2;
  style: number;
  label: string;
  custom_id?: string;
  url?: string;
  emoji?: { name: string };
  disabled?: boolean;
}

interface DiscordActionRow {
  type: 1;
  components: DiscordButton[];
}

function getBotToken(): string {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error('DISCORD_BOT_TOKEN not configured');
  return token;
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 3) + '...';
}

/**
 * Color map for card states.
 */
function getCardColor(interest: string, temporal: string): number {
  if (temporal === 'never') return 0x374151; // dim grey — dismissed
  if (interest === 'instrument') return 0x3b82f6; // blue
  if (interest === 'ingredient') return 0x8b5cf6; // purple
  if (interest === 'idea') return 0xf59e0b; // amber
  if (interest === 'knowledge') return 0x10b981; // green
  return 0x6b7280; // grey — untriaged
}

/**
 * Build a Discord embed for a garden item.
 */
export function buildGardenEmbed(item: GardenItem, overrides?: Partial<Embed>): Embed {
  let tags: string[] = [];
  try { tags = JSON.parse(item.tags || '[]'); } catch { /* ignore */ }

  const parts: string[] = [];
  if (item.note) parts.push(item.note);
  if (tags.length > 0) parts.push(tags.map(t => `\`${t}\``).join(' '));

  const statusParts: string[] = [];
  if (item.interest) statusParts.push(`**Interest:** ${item.interest}`);
  if (item.temporal) statusParts.push(`**Temporal:** ${item.temporal}`);
  if (statusParts.length > 0) parts.push(statusParts.join(' • '));

  const color = getCardColor(item.interest, item.temporal);
  const typeEmoji: Record<string, string> = { link: '🔗', note: '📝', repo: '📦', font: '🔤' };
  const footerText = `${typeEmoji[item.type] || '📎'} ${item.type || 'item'}`;

  return {
    title: truncate(item.content.split('\n')[0] || 'Garden Item', 256),
    description: parts.length > 0 ? truncate(parts.join('\n\n'), 1000) : undefined,
    color,
    footer: { text: footerText },
    url: item.original_source || undefined,
    ...overrides,
  };
}

/**
 * Build Components V2 garden card with section headers.
 * Selected interest/temporal buttons render as Primary (blurple), unselected as Secondary (grey).
 * Uses Container (17) + Text Display (10) + Separator (14) + Action Row (1).
 */
export function buildGardenCardV2(item: GardenItem): Record<string, unknown>[] {
  let tags: string[] = [];
  try { tags = JSON.parse(item.tags || '[]'); } catch { /* ignore */ }

  // Build description
  const lines: string[] = [];
  if (item.note) lines.push(item.note);
  if (item.original_source) {
    try {
      const domain = new URL(item.original_source).hostname.replace('www.', '');
      lines.push(`**Source:** ${domain}`);
    } catch {
      lines.push(`**Source:** ${item.original_source}`);
    }
  }
  if (tags.length > 0) lines.push(tags.map(t => `\`${t}\``).join(' '));

  const title = item.content.split('\n')[0] || 'Garden Item';
  const headerText = `🌱 **${truncate(title, 200)}**\n\n${lines.join('\n')}`;

  const itemId = item.id;
  const currentInterest = item.interest?.toLowerCase() || '';
  const currentTemporal = item.temporal?.toLowerCase() || '';

  // Helper: style 1 (Primary/blurple) if selected, style 2 (Secondary/grey) if not
  const iStyle = (val: string) => currentInterest === val ? 1 : 2;
  const tStyle = (val: string) => currentTemporal === val ? 1 : 2;

  return [
    {
      type: 17, // Container
      components: [
        { type: 10, content: headerText },
        { type: 14 },
        { type: 10, content: '**Interest**' },
        {
          type: 1,
          components: [
            { type: 2, style: iStyle('info'), label: 'Info', custom_id: `garden_info_${itemId}`, emoji: { name: '📚' } },
            { type: 2, style: iStyle('inspiration'), label: 'Inspiration', custom_id: `garden_inspiration_${itemId}`, emoji: { name: '✨' } },
            { type: 2, style: iStyle('instrument'), label: 'Instrument', custom_id: `garden_instrument_${itemId}`, emoji: { name: '🔧' } },
            { type: 2, style: iStyle('ingredient'), label: 'Ingredient', custom_id: `garden_ingredient_${itemId}`, emoji: { name: '🧩' } },
            { type: 2, style: iStyle('idea'), label: 'Idea', custom_id: `garden_idea_${itemId}`, emoji: { name: '💡' } },
          ],
        },
        { type: 10, content: '**Timeframe**' },
        {
          type: 1,
          components: [
            { type: 2, style: tStyle('now'), label: 'Now', custom_id: `garden_now_${itemId}`, emoji: { name: '⚡' } },
            { type: 2, style: tStyle('later'), label: 'Later', custom_id: `garden_later_${itemId}`, emoji: { name: '⏰' } },
            { type: 2, style: tStyle('ever'), label: 'Ever', custom_id: `garden_ever_${itemId}`, emoji: { name: '🌱' } },
          ],
        },
      ],
    },
  ];
}

/**
 * Legacy button builder (for embed-style cards).
 */
export function buildGardenButtons(itemId: string): DiscordActionRow[] {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 1, label: 'Instrument', custom_id: `garden_instrument_${itemId}`, emoji: { name: '🔧' } },
        { type: 2, style: 1, label: 'Ingredient', custom_id: `garden_ingredient_${itemId}`, emoji: { name: '🧩' } },
        { type: 2, style: 1, label: 'Idea', custom_id: `garden_idea_${itemId}`, emoji: { name: '💡' } },
        { type: 2, style: 1, label: 'Info', custom_id: `garden_info_${itemId}`, emoji: { name: '📚' } },
        { type: 2, style: 1, label: 'Inspiration', custom_id: `garden_inspiration_${itemId}`, emoji: { name: '✨' } },
      ],
    },
    {
      type: 1,
      components: [
        { type: 2, style: 3, label: 'Now', custom_id: `garden_now_${itemId}`, emoji: { name: '⚡' } },
        { type: 2, style: 2, label: 'Later', custom_id: `garden_later_${itemId}`, emoji: { name: '⏰' } },
        { type: 2, style: 2, label: 'Ever', custom_id: `garden_ever_${itemId}`, emoji: { name: '🌱' } },
      ],
    },
  ];
}

/**
 * Post a garden card to a Discord channel via bot token.
 */
export async function postGardenCard(
  item: GardenItem,
  channelId: string
): Promise<string | null> {
  const token = getBotToken();
  const v2Components = buildGardenCardV2(item);

  try {
    const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ flags: 32768, components: v2Components }),
    });

    if (!res.ok) {
      const err = await res.text();
      logger.error({ status: res.status, err }, 'Failed to post garden card');
      return null;
    }

    const data = await res.json();
    logger.info({ messageId: data.id, channelId, gardenId: item.id }, 'Garden card posted');
    return data.id;
  } catch (error) {
    logger.error({ err: error }, 'Error posting garden card');
    return null;
  }
}

/**
 * Update an existing Discord message (edit embed + components).
 */
export async function updateCard(
  messageId: string,
  channelId: string,
  embed: Embed,
  components?: DiscordActionRow[]
): Promise<boolean> {
  const token = getBotToken();

  try {
    const body: Record<string, unknown> = { embeds: [embed] };
    if (components) body.components = components;

    const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages/${messageId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bot ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      logger.error({ status: res.status, err }, 'Failed to update card');
      return false;
    }

    return true;
  } catch (error) {
    logger.error({ err: error }, 'Error updating card');
    return false;
  }
}

// --- X Feed Tweet Card Components V2 ---

interface V2TextDisplay {
  type: 10; // Text Display
  content: string;
}

interface V2Separator {
  type: 14; // Separator
  divider?: boolean;
  spacing?: number;
}

interface V2LinkButton {
  type: 2;
  style: 5; // Link
  label: string;
  url: string;
  emoji?: { name: string };
}

interface V2ActionButton {
  type: 2;
  style: 1 | 2; // Primary or Secondary
  label: string;
  custom_id: string;
  emoji?: { name: string };
}

interface V2ActionRow {
  type: 1;
  components: Array<V2ActionButton | V2LinkButton>;
}

interface V2Container {
  type: 17; // Container
  components: Array<V2TextDisplay | V2Separator | V2ActionRow>;
}

/**
 * Build a Components V2 tweet card for Discord.
 * Returns the container payload for a single tweet.
 */
export function buildTweetCardV2(
  tweet: CCTweet,
  currentRating?: TweetRating | null,
  currentHighlight?: boolean
): V2Container {
  const author = tweet.author || 'Unknown';
  const theme = tweet.theme || '';
  const themeBadge = theme ? ` \`${theme}\`` : '';
  // Theme-based emoji
  const themeEmoji: Record<string, string> = {
    'AI/LLM': '🤖',
    'Apple/Tech': '🍎',
    'Dev Tools': '🛠️',
    'Creative Coding': '🎨',
    'Hardware': '⚙️',
    'Design/UX': '✏️',
    'News': '📰',
    'Politics': '🏛️',
    'Crypto': '🪙',
    'Science': '🔬',
    'Gaming': '🎮',
    'Music': '🎵',
    'Finance': '💰',
  };
  const headerEmoji = themeEmoji[theme] || '🐦';

  // Worm's one-liner: prefer summary field (v2), fall back to action, then content
  const oneLiner = tweet.summary
    || tweet.action
    || (tweet.verdict && !['kept', 'keep', 'curated'].includes(tweet.verdict.toLowerCase()) ? tweet.verdict : '')
    || truncate(tweet.content || '', 120);
  const tweetLink = tweet.tweet_link || '';

  // Button styles based on current rating
  const fireStyle: 1 | 2 = currentRating === 'fire' ? 1 : 2;
  const noiseStyle: 1 | 2 = currentRating === 'noise' ? 1 : 2;

  const components: V2Container['components'] = [
    {
      type: 10, // Worm's one-liner summary at top
      content: `**${oneLiner}**`,
    },
    {
      type: 10, // Author + theme below
      content: `${headerEmoji} ${author}${themeBadge}`,
    },
    {
      type: 14, // Separator
      divider: true,
      spacing: 1,
    },
    {
      type: 1, // Action Row — ratings + open + act
      components: [
        {
          type: 2,
          style: fireStyle,
          label: '',
          custom_id: `xfeed_fire_${tweet.id}`,
          emoji: { name: '🔥' },
        },
        {
          type: 2,
          style: noiseStyle,
          label: '',
          custom_id: `xfeed_noise_${tweet.id}`,
          emoji: { name: '🗑️' },
        },
        {
          type: 2,
          style: 5, // Link
          label: 'Open',
          url: tweetLink,
          emoji: { name: '🔗' },
        },
        {
          type: 2,
          style: 2, // Secondary
          label: 'Act',
          custom_id: `xfeed_task_${tweet.id}`,
          emoji: { name: '📋' },
        },
      ],
    },
    {
      type: 1, // Second Action Row — Uze signals
      components: [
        {
          type: 2,
          style: currentHighlight ? 1 : 2, // Primary if highlighted, Secondary if not
          label: 'Highlight',
          custom_id: `xfeed_highlight_${tweet.id}`,
          emoji: { name: '⭐' },
        },
        {
          type: 2,
          style: 2, // Secondary — opens modal for note
          label: 'Highlight + Note',
          custom_id: `xfeed_highlightnote_${tweet.id}`,
          emoji: { name: '✏️' },
        },
      ],
    },
  ];

  return {
    type: 17,
    components,
  };
}

/**
 * Post a tweet card to a Discord channel.
 */
export async function postTweetCard(
  tweet: CCTweet,
  channelId: string,
  currentRating?: TweetRating | null,
  currentHighlight?: boolean
): Promise<string | null> {
  const token = getBotToken();
  const card = buildTweetCardV2(tweet, currentRating, currentHighlight);

  try {
    const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        components: [card],
        flags: 32768, // Components V2 flag
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      logger.error({ status: res.status, err, tweetId: tweet.id }, 'Failed to post tweet card');
      return null;
    }

    const data = await res.json();
    logger.info({ messageId: data.id, channelId, tweetId: tweet.id }, 'Tweet card posted');
    return data.id;
  } catch (error) {
    logger.error({ err: error, tweetId: tweet.id }, 'Error posting tweet card');
    return null;
  }
}

// --- Task Card (Components V2) ---

interface TaskCardData {
  taskId: string;
  title: string;
  description?: string;
  project?: string;
  planId?: string | null;
  turn: {
    author: string;
    content: string;
    links?: Turn['links'];
  };
}

/**
 * Build a Components V2 task card for Discord #tasks.
 */
export function buildTaskCard(data: TaskCardData): V2Container {
  const { taskId, title, description, project, turn } = data;

  const turnPreview = truncate(turn.content.replace(/[#*`]/g, ''), 200);
  const projectLine = project ? ` · \`${project}\`` : '';

  const components: V2Container['components'] = [
    {
      type: 10,
      content: `⚡ **${truncate(title, 100)}**${projectLine}`,
    },
    { type: 14, divider: true, spacing: 1 },
    {
      type: 10,
      content: `**${turn.author}:** ${turnPreview}`,
    },
  ];

  // Action row: link buttons (if any) + Dunk / Ask / View
  const actionButtons: Array<V2ActionButton | V2LinkButton> = [];

  // Turn links as clickable buttons (max 3 to stay within Discord's 5-button row limit)
  const links = turn.links || [];
  for (const link of links.slice(0, 3)) {
    actionButtons.push({
      type: 2,
      style: 5, // Link
      label: truncate(link.title || link.type || 'Link', 25),
      url: link.url,
      emoji: link.type === 'pr' ? { name: '🔀' } : link.type === 'diff' ? { name: '📝' } : { name: '🔗' },
    });
  }

  const appUrl = process.env.APP_URL || 'http://localhost:3333';

  // Core action buttons
  actionButtons.push(
    {
      type: 2,
      style: 1, // Primary
      label: 'Dunk',
      custom_id: `task_dunk_${taskId}`,
      emoji: { name: '✅' },
    },
    {
      type: 2,
      style: 2, // Secondary
      label: 'Ask',
      custom_id: `task_ask_${taskId}`,
      emoji: { name: '❓' },
    },
  );

  // View button: plan link if plan exists, otherwise generic tasks view
  if (data.planId) {
    actionButtons.push({
      type: 2,
      style: 5, // Link
      label: 'Plan',
      url: `${appUrl}/plans/${data.planId}`,
      emoji: { name: '📋' },
    });
  } else {
    actionButtons.push({
      type: 2,
      style: 5, // Link
      label: 'View',
      url: `${appUrl}/?tab=tasks`,
      emoji: { name: '↗' },
    });
  }

  components.push({
    type: 1,
    components: actionButtons.slice(0, 5), // Discord max 5 per row
  });

  return { type: 17, components };
}

/**
 * Post a task card to Discord #tasks channel.
 */
export async function postTaskCard(data: TaskCardData): Promise<string | null> {
  const token = getBotToken();
  const card = buildTaskCard(data);

  try {
    const res = await fetch(`${DISCORD_API}/channels/${TASKS_CHANNEL_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        components: [card],
        flags: 32768, // Components V2 flag
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      logger.error({ status: res.status, err, taskId: data.taskId }, 'Failed to post task card');
      return null;
    }

    const data2 = await res.json();
    logger.info({ messageId: data2.id, taskId: data.taskId }, 'Task card posted to #tasks');
    return data2.id;
  } catch (error) {
    logger.error({ err: error, taskId: data.taskId }, 'Error posting task card');
    return null;
  }
}
