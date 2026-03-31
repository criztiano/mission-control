'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import ReactMarkdown from 'react-markdown'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Refresh, Leaf, ViewGrid, List, Xmark, OpenNewWindow, Check, Circle, FloppyDisk } from 'iconoir-react'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GardenItem {
  id: string
  content: string
  type: string
  interest: string
  temporal: string
  tags: string
  note: string
  original_source: string | null
  media_urls: string
  metadata: string
  enriched: boolean | number
  instance_type: string
  snooze_until: string | null
  expires_at: string | null
  created_at: string
  saved_at: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INTEREST_OPTIONS = ['information', 'inspiration', 'instrument', 'ingredient', 'idea'] as const
const TYPE_OPTIONS = ['tweet', 'link', 'article', 'repo', 'note', 'image', 'video', 'pdf'] as const
const TEMPORAL_OPTIONS = ['now', 'soon', 'later', 'ever'] as const

const INTEREST_STYLES: Record<string, { bg: string; text: string; border: string; icon: string }> = {
  information: { bg: 'bg-blue-500/15',   text: 'text-blue-300',   border: 'border-blue-500/25',   icon: '🔬' },
  inspiration: { bg: 'bg-purple-500/15', text: 'text-purple-300', border: 'border-purple-500/25', icon: '✨' },
  instrument:  { bg: 'bg-green-500/15',  text: 'text-green-300',  border: 'border-green-500/25',  icon: '🔧' },
  ingredient:  { bg: 'bg-orange-500/15', text: 'text-orange-300', border: 'border-orange-500/25', icon: '🧱' },
  idea:        { bg: 'bg-yellow-500/15', text: 'text-yellow-300', border: 'border-yellow-500/25', icon: '💡' },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString()
}

function parseTags(raw: string): string[] {
  try { return JSON.parse(raw) } catch { return [] }
}

function parseMediaUrls(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

function sourceDomain(url: string | null): string | null {
  if (!url) return null
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return null }
}

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|ogg|mov)(\?|$)/i.test(url) || url.includes('video')
}

// ---------------------------------------------------------------------------
// Interest Badge
// ---------------------------------------------------------------------------

function InterestBadge({ interest, size = 'sm' }: { interest: string; size?: 'sm' | 'xs' }) {
  const s = INTEREST_STYLES[interest] ?? INTEREST_STYLES.information
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full border font-medium',
      s.bg, s.text, s.border,
      size === 'xs' ? 'text-[9px] px-1.5 py-0' : 'text-[10px] px-2 py-0.5',
    )}>
      {s.icon} {interest}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Filter Bar
// ---------------------------------------------------------------------------

interface Filters {
  interest: string
  type: string
  temporal: string
  search: string
}

type ViewMode = 'grid' | 'list'

function FilterBar({
  filters,
  onChange,
  viewMode,
  onViewMode,
  onRefresh,
  loading,
}: {
  filters: Filters
  onChange: (f: Partial<Filters>) => void
  viewMode: ViewMode
  onViewMode: (v: ViewMode) => void
  onRefresh: () => void
  loading: boolean
}) {
  return (
    <div className="flex-shrink-0 border-b border-border px-4 py-2.5 space-y-2">
      {/* Row 1: interest chips + view toggle + refresh */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          onClick={() => onChange({ interest: '' })}
          className={cn(
            'px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors border',
            !filters.interest
              ? 'bg-primary/15 text-primary border-primary/30'
              : 'bg-secondary text-muted-foreground border-border hover:text-foreground',
          )}
        >
          All
        </button>
        {INTEREST_OPTIONS.map((i5) => {
          const s = INTEREST_STYLES[i5]
          const active = filters.interest === i5
          return (
            <button
              key={i5}
              onClick={() => onChange({ interest: active ? '' : i5 })}
              className={cn(
                'px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors border',
                active ? `${s.bg} ${s.text} ${s.border}` : 'bg-secondary text-muted-foreground border-border hover:text-foreground',
              )}
            >
              {s.icon} {i5}
            </button>
          )
        })}

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onViewMode('grid')}
            title="Grid view"
            className={viewMode === 'grid' ? 'bg-secondary text-foreground' : ''}
          >
            <ViewGrid className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onViewMode('list')}
            title="List view"
            className={viewMode === 'list' ? 'bg-secondary text-foreground' : ''}
          >
            <List className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onRefresh} disabled={loading} title="Refresh">
            <Refresh className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {/* Row 2: type + temporal dropdowns + search */}
      <div className="flex items-center gap-2">
        <select
          value={filters.type}
          onChange={(e) => onChange({ type: e.target.value })}
          className="bg-secondary text-foreground text-xs rounded-md px-2 py-1 border border-border focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
        >
          <option value="">All types</option>
          {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>

        <select
          value={filters.temporal}
          onChange={(e) => onChange({ temporal: e.target.value })}
          className="bg-secondary text-foreground text-xs rounded-md px-2 py-1 border border-border focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
        >
          <option value="">All time</option>
          {TEMPORAL_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>

        <input
          type="text"
          placeholder="Search…"
          value={filters.search}
          onChange={(e) => onChange({ search: e.target.value })}
          className="flex-1 bg-secondary text-foreground text-xs rounded-md px-2 py-1 border border-border focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/50"
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Garden Card (masonry)
// ---------------------------------------------------------------------------

function GardenCard({ item, index, onClick }: { item: GardenItem; index: number; onClick: () => void }) {
  const tags = parseTags(item.tags)
  const mediaUrls = parseMediaUrls(item.media_urls)
  const firstMedia = mediaUrls[0]
  const domain = sourceDomain(item.original_source)
  const isVideo = firstMedia ? isVideoUrl(firstMedia) : false

  return (
    <motion.button
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, delay: Math.min(index * 0.02, 0.3) }}
      onClick={onClick}
      className="w-full text-left bg-card border border-border rounded-xl overflow-hidden hover:border-primary/30 transition-colors break-inside-avoid mb-3 block"
      style={{ breakInside: 'avoid' }}
    >
      {/* Media */}
      {firstMedia && (
        <div className="w-full overflow-hidden">
          {isVideo ? (
            <video
              src={firstMedia}
              className="w-full object-cover max-h-48"
              muted
              playsInline
              preload="metadata"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={firstMedia}
              alt=""
              className="w-full object-cover max-h-48"
              loading="lazy"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          )}
        </div>
      )}

      <div className="p-3 space-y-2">
        {/* Title / content */}
        {item.content && (
          <p className={cn(
            'text-sm leading-snug',
            item.content.length > 100 ? 'font-medium line-clamp-2' : 'font-semibold',
            'text-foreground',
          )}>
            {item.content.split('\n')[0] || item.content}
          </p>
        )}

        {/* Badges row */}
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground border border-border">
            {item.type}
          </span>
          <InterestBadge interest={item.interest} size="xs" />
          {item.enriched ? (
            <Check className="w-3 h-3 text-green-400 shrink-0" />
          ) : (
            <Circle className="w-3 h-3 text-muted-foreground/30 shrink-0" />
          )}
        </div>

        {/* Tags */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.slice(0, 5).map((t) => (
              <span key={t} className="text-[9px] px-1 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">
                {t}
              </span>
            ))}
          </div>
        )}

        {/* Footer: domain + time */}
        <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground/60">
          {domain && <span className="truncate">{domain}</span>}
          <span className="shrink-0 ml-auto">{relativeTime(item.saved_at || item.created_at)}</span>
        </div>
      </div>
    </motion.button>
  )
}

// ---------------------------------------------------------------------------
// Garden List Row
// ---------------------------------------------------------------------------

function GardenListRow({ item, index, onClick }: { item: GardenItem; index: number; onClick: () => void }) {
  const tags = parseTags(item.tags)
  const domain = sourceDomain(item.original_source)

  return (
    <motion.button
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.12, delay: Math.min(index * 0.015, 0.25) }}
      onClick={onClick}
      className="w-full text-left flex items-center gap-3 px-4 py-2.5 bg-card border border-border rounded-lg hover:border-primary/30 transition-colors"
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground truncate font-medium">
          {item.content.split('\n')[0] || item.content}
        </p>
        {tags.length > 0 && (
          <div className="flex gap-1 mt-0.5">
            {tags.slice(0, 3).map((t) => (
              <span key={t} className="text-[9px] px-1 py-0 rounded-full bg-secondary text-muted-foreground border border-border">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground border border-border shrink-0">
        {item.type}
      </span>
      <InterestBadge interest={item.interest} size="xs" />
      {domain && <span className="text-[10px] text-muted-foreground/60 shrink-0 hidden sm:block">{domain}</span>}
      <span className="text-[10px] text-muted-foreground/60 shrink-0">{relativeTime(item.saved_at || item.created_at)}</span>
    </motion.button>
  )
}

// ---------------------------------------------------------------------------
// Detail Sheet
// ---------------------------------------------------------------------------

function DetailSheet({ item, onClose, onUpdate }: { item: GardenItem; onClose: () => void; onUpdate: () => void }) {
  const [itemType, setItemType] = useState(item.type)
  const [interest, setInterest] = useState(item.interest)
  const [temporal, setTemporal] = useState(item.temporal)
  const [note, setNote] = useState(item.note || '')
  const [tags, setTags] = useState<string[]>(() => parseTags(item.tags))
  const [tagInput, setTagInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  const mediaUrls = parseMediaUrls(item.media_urls)
  const domain = sourceDomain(item.original_source)

  const handleSave = async () => {
    setSaving(true)
    try {
      await fetch(`/api/garden/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: itemType, interest, temporal, note, tags: JSON.stringify(tags) }),
      })
      setDirty(false)
      onUpdate()
    } finally {
      setSaving(false)
    }
  }

  const markDirty = (fn: () => void) => { fn(); setDirty(true) }

  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && tagInput.trim()) {
      e.preventDefault()
      const t = tagInput.trim().toLowerCase()
      if (!tags.includes(t)) markDirty(() => setTags([...tags, t]))
      setTagInput('')
    }
  }

  const interestStyle = INTEREST_STYLES[interest] ?? INTEREST_STYLES.information

  return (
    <motion.div
      initial={{ x: 60, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 60, opacity: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="w-[400px] shrink-0 border-l border-border bg-card h-full flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <span className={cn('text-[10px] px-2 py-0.5 rounded-full border font-medium', interestStyle.bg, interestStyle.text, interestStyle.border)}>
            {interestStyle.icon} {interest}
          </span>
          <span className="text-[10px] text-muted-foreground font-mono">{item.id.slice(0, 8)}</span>
        </div>
        <div className="flex items-center gap-1">
          {dirty && (
            <Button size="icon-sm" onClick={handleSave} disabled={saving} title="Save">
              <FloppyDisk className="w-3.5 h-3.5" />
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <Xmark className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* Media gallery */}
          {mediaUrls.length > 0 && (
            <div className="space-y-2">
              {mediaUrls.map((url, i) => (
                isVideoUrl(url) ? (
                  <video key={i} src={url} controls className="w-full rounded-lg border border-border max-h-48" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={url} alt="" className="w-full rounded-lg border border-border object-cover" loading="lazy" />
                )
              ))}
            </div>
          )}

          {/* Content — markdown rendered */}
          <div className="prose prose-sm prose-invert max-w-none">
            <ReactMarkdown>{item.content}</ReactMarkdown>
          </div>

          {/* Source link */}
          {item.original_source && (
            <a
              href={item.original_source}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors break-all"
            >
              <OpenNewWindow className="w-3 h-3 shrink-0" />
              {domain || item.original_source}
            </a>
          )}

          {/* Editable fields */}
          <div className="space-y-3">
            {/* Type */}
            <div>
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">Type</label>
              <select
                value={itemType}
                onChange={(e) => markDirty(() => setItemType(e.target.value))}
                className="w-full bg-secondary text-foreground text-xs rounded px-2 py-1.5 border border-border focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            {/* Interest */}
            <div>
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">Interest</label>
              <div className="flex flex-wrap gap-1.5">
                {INTEREST_OPTIONS.map((i5) => {
                  const s = INTEREST_STYLES[i5]
                  return (
                    <button
                      key={i5}
                      onClick={() => markDirty(() => setInterest(i5))}
                      className={cn(
                        'text-[10px] px-2 py-0.5 rounded-full border font-medium transition-colors',
                        interest === i5 ? `${s.bg} ${s.text} ${s.border}` : 'bg-secondary text-muted-foreground border-border hover:text-foreground',
                      )}
                    >
                      {s.icon} {i5}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Temporal */}
            <div>
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">Temporal</label>
              <div className="flex gap-1.5">
                {TEMPORAL_OPTIONS.map((t) => (
                  <button
                    key={t}
                    onClick={() => markDirty(() => setTemporal(t))}
                    className={cn(
                      'text-[10px] px-2 py-0.5 rounded-full border font-medium transition-colors',
                      temporal === t
                        ? 'bg-primary/15 text-primary border-primary/30'
                        : 'bg-secondary text-muted-foreground border-border hover:text-foreground',
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Tags */}
            <div>
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">Tags</label>
              <div className="flex flex-wrap gap-1 mb-1.5">
                {tags.map((t) => (
                  <span key={t} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">
                    {t}
                    <button
                      onClick={() => markDirty(() => setTags(tags.filter((x) => x !== t)))}
                      className="hover:text-red-400 leading-none"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                placeholder="Add tag + Enter"
                className="w-full text-xs bg-secondary border border-border rounded px-2 py-1 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* Note */}
            <div>
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">Note</label>
              <textarea
                value={note}
                onChange={(e) => markDirty(() => setNote(e.target.value))}
                rows={3}
                placeholder="Personal note…"
                className="w-full text-xs bg-secondary border border-border rounded px-2 py-1.5 text-foreground resize-y placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {/* Meta */}
          <div className="text-[10px] text-muted-foreground/50 space-y-0.5">
            <p>Saved {relativeTime(item.saved_at || item.created_at)}</p>
            {item.enriched ? (
              <p className="flex items-center gap-1 text-green-400"><Check className="w-3 h-3" /> Enriched</p>
            ) : null}
          </div>
        </div>
      </ScrollArea>

      {/* Save footer */}
      {dirty && (
        <div className="shrink-0 p-3 border-t border-border">
          <Button onClick={handleSave} disabled={saving} className="w-full gap-2" size="sm">
            <FloppyDisk className="w-3.5 h-3.5" />
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      )}
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

export function GardenPanel() {
  const [items, setItems] = useState<GardenItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<Filters>({ interest: '', type: '', temporal: '', search: '' })
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [selectedItem, setSelectedItem] = useState<GardenItem | null>(null)

  const fetchItems = useCallback(async (silent?: boolean) => {
    if (!silent) setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filters.interest) params.set('interest', filters.interest)
      if (filters.type) params.set('type', filters.type)
      if (filters.temporal) params.set('temporal', filters.temporal)
      if (filters.search) params.set('search', filters.search)
      params.set('limit', '200')
      const res = await fetch(`/api/garden?${params}`)
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      setItems(data.items || [])
      setError(null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => { fetchItems() }, [fetchItems])
  useSmartPoll(() => fetchItems(true), 60000)

  // Local search filter (client-side for speed)
  const filtered = useMemo(() => {
    if (!filters.search.trim()) return items
    const q = filters.search.toLowerCase()
    return items.filter((item) => {
      const tags = parseTags(item.tags).join(' ')
      return item.content.toLowerCase().includes(q) || tags.includes(q)
    })
  }, [items, filters.search])

  const updateFilters = useCallback((partial: Partial<Filters>) => {
    setFilters((prev) => ({ ...prev, ...partial }))
  }, [])

  if (loading && items.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-sm text-muted-foreground">Loading garden…</span>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
        <Leaf className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">Garden</h2>
        {filtered.length > 0 && (
          <span className="text-xs text-muted-foreground font-mono">{filtered.length}</span>
        )}
      </div>

      {/* Filter bar */}
      <FilterBar
        filters={filters}
        onChange={updateFilters}
        viewMode={viewMode}
        onViewMode={setViewMode}
        onRefresh={() => fetchItems()}
        loading={loading}
      />

      {/* Content */}
      <div className="flex-1 overflow-hidden flex">
        {/* Main area */}
        <div className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="p-4">
              {error ? (
                <div className="flex flex-col items-center justify-center py-16 gap-2">
                  <p className="text-sm text-red-400">{error}</p>
                  <Button variant="outline" size="sm" onClick={() => fetchItems()}>Retry</Button>
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-2">
                  <Leaf className="w-8 h-8 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">
                    {filters.interest || filters.type || filters.temporal || filters.search
                      ? 'No items match the current filters'
                      : 'Knowledge garden is empty'}
                  </p>
                </div>
              ) : viewMode === 'grid' ? (
                /* CSS Masonry grid */
                <div
                  style={{
                    columns: 'var(--garden-cols, 2)',
                    columnGap: '12px',
                  }}
                  className="[--garden-cols:2] sm:[--garden-cols:2] md:[--garden-cols:3] lg:[--garden-cols:4]"
                >
                  {filtered.map((item, i) => (
                    <GardenCard
                      key={item.id}
                      item={item}
                      index={i}
                      onClick={() => setSelectedItem(item)}
                    />
                  ))}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {filtered.map((item, i) => (
                    <GardenListRow
                      key={item.id}
                      item={item}
                      index={i}
                      onClick={() => setSelectedItem(item)}
                    />
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Detail sheet */}
        <AnimatePresence>
          {selectedItem && (
            <DetailSheet
              key={selectedItem.id}
              item={selectedItem}
              onClose={() => setSelectedItem(null)}
              onUpdate={() => {
                fetchItems(true)
                // Refresh selected item from the list
                setSelectedItem((prev) => {
                  if (!prev) return null
                  const updated = items.find((i) => i.id === prev.id)
                  return updated || prev
                })
              }}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
