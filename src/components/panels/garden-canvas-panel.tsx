'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Tldraw,
  createShapeId,
  BaseBoxShapeUtil,
  HTMLContainer,
  type TLShape,
  type RecordProps,
  T,
  type TLShapeId,
  type Editor,
} from '@tldraw/tldraw'

// ---------------------------------------------------------------------------
// Register custom shape with tldraw's TypeScript module augmentation
// ---------------------------------------------------------------------------
declare module '@tldraw/tlschema' {
  interface TLGlobalShapePropsMap {
    'garden-card': {
      w: number
      h: number
      itemId: string
      title: string
      preview: string
      itemType: string
      tags: string[]
      source: string | null
    }
  }
}
import '@tldraw/tldraw/tldraw.css'
import { Button } from '@/components/ui/button'
import { Refresh } from 'iconoir-react'

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
  metadata: string
  created_at: string
}

type GardenCardShape = TLShape<'garden-card'>

// ---------------------------------------------------------------------------
// Type icons
// ---------------------------------------------------------------------------

function typeIcon(type: string): string {
  switch (type) {
    case 'tweet': return '🐦'
    case 'article': return '📰'
    case 'video': return '🎬'
    case 'book': return '📚'
    case 'note': return '📝'
    case 'idea': return '💡'
    case 'project': return '🚀'
    case 'task': return '✅'
    case 'link': return '🔗'
    case 'image': return '🖼️'
    default: return '🌱'
  }
}

// ---------------------------------------------------------------------------
// Custom Shape Util
// ---------------------------------------------------------------------------

class GardenCardShapeUtil extends BaseBoxShapeUtil<GardenCardShape> {
  static override type = 'garden-card' as const

  static override props: RecordProps<GardenCardShape> = {
    w: T.number,
    h: T.number,
    itemId: T.string,
    title: T.string,
    preview: T.string,
    itemType: T.string,
    tags: T.arrayOf(T.string),
    source: T.nullable(T.string),
  }

  override getDefaultProps(): GardenCardShape['props'] {
    return {
      w: 280,
      h: 160,
      itemId: '',
      title: '',
      preview: '',
      itemType: 'note',
      tags: [],
      source: null,
    }
  }

  override canEdit() { return false }
  override canResize() { return true }
  override isAspectRatioLocked() { return false }

  override component(shape: GardenCardShape) {
    const { title, preview, itemType, tags, source, w, h } = shape.props
    const icon = typeIcon(itemType)

    return (
      <HTMLContainer
        id={shape.id}
        style={{ width: w, height: h, pointerEvents: 'all' }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            background: 'hsl(240 6% 10%)',
            border: '1px solid hsl(240 5% 20%)',
            borderRadius: '10px',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          }}
        >
          {/* Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '8px 10px 4px',
            borderBottom: '1px solid hsl(240 5% 18%)',
            flexShrink: 0,
          }}>
            <span style={{ fontSize: '14px', lineHeight: 1 }}>{icon}</span>
            <span style={{
              fontSize: '11px',
              fontWeight: 600,
              color: 'hsl(240 5% 85%)',
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {title || preview.slice(0, 50)}
            </span>
            <span style={{
              fontSize: '9px',
              color: 'hsl(240 5% 50%)',
              background: 'hsl(240 5% 16%)',
              padding: '1px 5px',
              borderRadius: '4px',
              flexShrink: 0,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}>
              {itemType}
            </span>
          </div>

          {/* Content preview */}
          <div style={{
            flex: 1,
            padding: '6px 10px',
            overflow: 'hidden',
            fontSize: '11px',
            lineHeight: '1.45',
            color: 'hsl(240 5% 65%)',
          }}>
            {preview}
          </div>

          {/* Footer: tags + source */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            padding: '4px 10px 6px',
            borderTop: '1px solid hsl(240 5% 16%)',
            flexShrink: 0,
            overflow: 'hidden',
          }}>
            {tags.slice(0, 4).map((tag) => (
              <span key={tag} style={{
                fontSize: '9px',
                color: 'hsl(240 5% 55%)',
                background: 'hsl(240 5% 16%)',
                padding: '1px 5px',
                borderRadius: '10px',
                whiteSpace: 'nowrap',
              }}>
                {tag}
              </span>
            ))}
            {source && (
              <span style={{
                marginLeft: 'auto',
                fontSize: '9px',
                color: 'hsl(217 91% 55%)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '90px',
              }}>
                ↗ {source.replace(/^https?:\/\//, '').slice(0, 20)}
              </span>
            )}
          </div>
        </div>
      </HTMLContainer>
    )
  }

  override indicator(shape: GardenCardShape) {
    const { w, h } = shape.props
    return <rect width={w} height={h} rx={10} ry={10} />
  }
}

// ---------------------------------------------------------------------------
// Custom shape array for Tldraw
// ---------------------------------------------------------------------------

const customShapes = [GardenCardShapeUtil]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseMetadata(raw: string): Record<string, any> {
  try { return JSON.parse(raw) } catch { return {} }
}

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

function getContentPreview(content: string): { title: string; preview: string } {
  const lines = content.trim().split('\n').filter(Boolean)
  if (lines.length === 0) return { title: '', preview: '' }
  if (lines.length === 1) {
    const t = lines[0].slice(0, 80)
    return { title: t, preview: '' }
  }
  const title = lines[0].slice(0, 60)
  const preview = lines.slice(1).join(' ').slice(0, 120)
  return { title, preview }
}

function defaultPosition(index: number): { x: number; y: number } {
  const cols = 4
  const col = index % cols
  const row = Math.floor(index / cols)
  return { x: 40 + col * 320, y: 40 + row * 200 }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function GardenCanvasPanel() {
  const [items, setItems] = useState<GardenItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const editorRef = useRef<Editor | null>(null)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const initializedRef = useRef(false)

  const fetchItems = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/garden?temporal=now&limit=200')
      if (!res.ok) throw new Error('Failed to fetch garden items')
      const data = await res.json()
      setItems(data.items || [])
      setError(null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchItems() }, [fetchItems])

  // Load items onto canvas
  const loadItemsOntoCanvas = useCallback((editor: Editor, itemList: GardenItem[]) => {
    if (itemList.length === 0) return

    const existing = new Map<string, TLShapeId>()
    for (const shape of editor.getCurrentPageShapes()) {
      if (shape.type === 'garden-card') {
        existing.set((shape as GardenCardShape).props.itemId, shape.id)
      }
    }

    const toCreate: any[] = []
    const toUpdate: any[] = []

    itemList.forEach((item, index) => {
      const meta = parseMetadata(item.metadata)
      const tags = parseTags(item.tags)
      const { title, preview } = getContentPreview(item.content)
      const shapeId = createShapeId(`garden-${item.id}`)

      const hasPosition = meta.canvas_x !== undefined && meta.canvas_y !== undefined
      const pos = hasPosition
        ? { x: meta.canvas_x as number, y: meta.canvas_y as number }
        : defaultPosition(index)

      const props = {
        w: 280,
        h: 160,
        itemId: item.id,
        title,
        preview,
        itemType: item.type,
        tags,
        source: item.original_source || null,
      }

      if (existing.has(item.id)) {
        toUpdate.push({ id: existing.get(item.id), type: 'garden-card', props, x: pos.x, y: pos.y })
      } else {
        toCreate.push({ id: shapeId, type: 'garden-card', x: pos.x, y: pos.y, props })
      }
    })

    if (toCreate.length > 0) editor.createShapes(toCreate)
    if (toUpdate.length > 0) editor.updateShapes(toUpdate)
  }, [])

  const handleMount = useCallback((editor: Editor) => {
    editorRef.current = editor
    editor.user.updateUserPreferences({ colorScheme: 'dark' })

    if (items.length > 0 && !initializedRef.current) {
      initializedRef.current = true
      loadItemsOntoCanvas(editor, items)
      setTimeout(() => editor.zoomToFit({ animation: { duration: 400 } }), 100)
    }

    // Persist positions on drag
    const unsub = editor.store.listen(
      () => {
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = setTimeout(() => {
          persistPositions(editor)
        }, 800)
      },
      { source: 'user', scope: 'document' }
    )

    return () => { unsub() }
  }, [items, loadItemsOntoCanvas])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || items.length === 0 || initializedRef.current) return
    initializedRef.current = true
    loadItemsOntoCanvas(editor, items)
    setTimeout(() => editor.zoomToFit({ animation: { duration: 400 } }), 100)
  }, [items, loadItemsOntoCanvas])

  const persistPositions = useCallback(async (editor: Editor) => {
    const shapes = editor.getCurrentPageShapes()
    const gardenShapes = shapes.filter((s) => s.type === 'garden-card') as GardenCardShape[]

    for (const shape of gardenShapes) {
      const { itemId } = shape.props
      if (!itemId) continue
      const item = items.find((i) => i.id === itemId)
      if (!item) continue

      const meta = parseMetadata(item.metadata)
      const newMeta = { ...meta, canvas_x: shape.x, canvas_y: shape.y }

      fetch(`/api/garden/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metadata: JSON.stringify(newMeta) }),
      }).catch(() => {})
    }
  }, [items])

  const handleRefresh = useCallback(async () => {
    initializedRef.current = false
    await fetchItems()
  }, [fetchItems])

  if (loading && items.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-sm text-muted-foreground">Loading garden...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-red-400 mb-2">{error}</p>
          <Button variant="outline" size="sm" onClick={fetchItems}>Retry</Button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ height: 'calc(100vh - 56px)', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div className="flex justify-between items-center p-4 border-b border-border flex-shrink-0">
        <div>
          <h2 className="text-xl font-bold text-foreground">Garden Canvas</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {items.length} now item{items.length !== 1 ? 's' : ''} · drag to rearrange
          </p>
        </div>
        <Button variant="outline" size="icon" onClick={handleRefresh} title="Refresh">
          <Refresh className="w-4 h-4" />
        </Button>
      </div>

      {/* Canvas */}
      <div style={{ flex: 1, position: 'relative' }}>
        {items.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <p className="text-2xl mb-2">🌱</p>
              <p className="text-sm font-medium text-foreground mb-1">No &quot;now&quot; items</p>
              <p className="text-xs text-muted-foreground">Items tagged with temporal=&quot;now&quot; will appear here</p>
            </div>
          </div>
        ) : (
          <Tldraw
            shapeUtils={customShapes}
            onMount={handleMount}
          />
        )}
      </div>
    </div>
  )
}
