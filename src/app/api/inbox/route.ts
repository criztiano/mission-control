import { NextRequest, NextResponse } from 'next/server'
import { getInboxItems, getInboxCounts, type InboxSourceType, type InboxItem } from '@/lib/cc-db'
import { db } from '@/db/client'
import { sql } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const source = searchParams.get('source') as InboxSourceType | null
    const limit = parseInt(searchParams.get('limit') || '50', 10)

    // Fire all 4 queries in parallel — items, inbox counts, notification count, notification rows
    const [items, counts, notifCountRows, notifRows] = await Promise.all([
      getInboxItems(source || undefined, limit),
      getInboxCounts(),
      db.execute(sql`SELECT COUNT(*) as c FROM notifications WHERE read_at IS NULL`),
      // Always fetch notification rows speculatively — cheap query and avoids a serial round-trip
      db.execute(sql`
        SELECT * FROM notifications WHERE read_at IS NULL ORDER BY created_at DESC LIMIT ${limit}
      `),
    ])

    // Merge notification count into counts
    counts.notification = Number((notifCountRows.rows[0] as any)?.c ?? 0)

    // Add notification items if not filtered or filtered to notifications
    if (!source || source === 'notification') {
      for (const n of notifRows.rows as any[]) {
        items.push({
          id: `notification-${n.id}`,
          source: 'notification' as InboxSourceType,
          title: n.title,
          subtitle: n.message,
          icon: '🔔',
          badge: n.type,
          badgeColor: 'amber',
          timestamp: n.created_at * 1000,
          actionUrl: n.source_type === 'task' ? `tasks?id=${n.source_id}` : undefined,
          metadata: {
            recipient: n.recipient,
            type: n.type,
            source_type: n.source_type,
            source_id: n.source_id,
          },
        } as InboxItem)
      }

      // Re-sort after adding notifications
      items.sort((a, b) => b.timestamp - a.timestamp)
    }

    return NextResponse.json({ items: items.slice(0, limit), counts })
  } catch (error) {
    console.error('Inbox API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch inbox' },
      { status: 500 }
    )
  }
}
