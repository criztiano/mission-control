import { logger } from '@/lib/logger';

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
  thumbnail?: { url: string };
}

interface GardenItem {
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
  custom_id: string;
  emoji?: { name: string };
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
 * Build a Discord embed for a garden item.
 */
export function buildGardenEmbed(item: GardenItem, overrides?: Partial<Embed>): Embed {
  let tags: string[] = [];
  try { tags = JSON.parse(item.tags || '[]'); } catch { /* ignore */ }

  const fields: EmbedField[] = [];

  if (item.interest) {
    fields.push({ name: 'Interest', value: item.interest, inline: true });
  }
  if (item.type) {
    fields.push({ name: 'Type', value: item.type, inline: true });
  }
  if (item.temporal) {
    fields.push({ name: 'Temporal', value: item.temporal, inline: true });
  }
  if (tags.length > 0) {
    fields.push({ name: 'Tags', value: tags.map(t => `\`${t}\``).join(' '), inline: false });
  }
  if (item.note) {
    fields.push({ name: 'Note', value: truncate(item.note, 200), inline: false });
  }

  return {
    title: truncate(item.content.split('\n')[0] || 'Garden Item', 256),
    description: truncate(item.content, 500),
    color: 0x8b5cf6, // purple default
    fields,
    footer: { text: `ID: ${item.id}` },
    timestamp: item.saved_at,
    url: item.original_source || undefined,
    ...overrides,
  };
}

/**
 * Build garden action buttons (Pin, Snooze, Dismiss).
 */
export function buildGardenButtons(itemId: string): DiscordActionRow[] {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 1, // Primary (blurple)
          label: 'Pin',
          custom_id: `garden_pin_${itemId}`,
          emoji: { name: '📌' },
        },
        {
          type: 2,
          style: 2, // Secondary (grey)
          label: 'Snooze',
          custom_id: `garden_snooze_${itemId}`,
          emoji: { name: '⏰' },
        },
        {
          type: 2,
          style: 4, // Danger (red)
          label: 'Dismiss',
          custom_id: `garden_dismiss_${itemId}`,
          emoji: { name: '🗑️' },
        },
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
  const embed = buildGardenEmbed(item);
  const components = buildGardenButtons(item.id);

  try {
    const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ embeds: [embed], components }),
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
