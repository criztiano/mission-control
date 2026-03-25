# Garden Canvas — "Now" Items on tldraw

**Status:** Draft — awaiting Cri's review

## Concept

Replace the flat "now" items list with a spatial infinite canvas powered by [tldraw](https://tldraw.dev). Items saved as "now" appear as draggable cards on the canvas. Cseno (or any agent) can programmatically organise, cluster, and rearrange items. Cri can manually drag things around too.

## Why tldraw

- Infinite canvas SDK for React — drop-in `<Tldraw />` component
- Rich shape system with custom shapes (our GardenCard)
- Freeform spatial layout (not a graph — no edges/connections forced)
- Multiplayer-ready (future: agent + human co-editing live)
- Editor API for programmatic control (agent can create/move/group shapes)
- Serialises to JSON — easy to persist

## Architecture

### New Page: `/garden/canvas`

- Full-screen tldraw canvas
- Loads "now" garden items as custom shapes
- Sidebar toggle: item list (for quick reference / search)
- Toolbar: "Organise" button (triggers agent spatial arrangement)

### Custom Shape: `GardenCard`

Each garden item renders as a tldraw shape with:
- **Title** (bold, truncated 2 lines)
- **Type badge** — tool 🔧 / technique 📐 / link 🔗 / note 📝 etc.
- **Interest color** — left border (info=blue, inspiration=purple, instrument=green, ingredient=orange, idea=yellow)
- **Skill badge** — if `skill_url` exists, show ⚡ chip linking to it
- **Source link** — small icon linking to original URL
- **Note preview** — first 2 lines of note if present

Card size: ~200x120px default, resizable

### Canvas State Persistence

- Canvas JSON stored in new DB column or separate table
- Auto-save on change (debounced 2s)
- Load on page mount
- Version history? (future — tldraw supports snapshots)

### Agent Spatial Organisation

When Cri says "organise my canvas" or similar:
1. Agent reads all items + their metadata
2. Clusters by theme/type/interest using simple heuristics:
   - Same type → nearby
   - Same tags → clustered
   - Related topics (semantic similarity via title) → adjacent
3. Generates x/y positions for each shape
4. Applies via tldraw Editor API
5. Uses tldraw's built-in grouping for clusters (optional labels)

**Layout zones** (configurable):
- Left: urgent / act-on-now
- Center: explore / read
- Right: reference / keep-handy
- Agent suggests zone, Cri can override by dragging

### Integration with Garden CRUD

- When an item is set to `triage_status = 'now'` → auto-creates a shape on the canvas
- When moved away from "now" (saved as "ever", dismissed) → shape removed from canvas
- When item metadata changes → shape updated
- Drag item off canvas edge → option to change triage status

## Tech Stack

- `tldraw` npm package (~2MB, acceptable for Eden)
- Custom shape: extend `BaseBoxShapeUtil` 
- Canvas state: `garden_canvas` table or JSON column on a settings table
- API: `GET/PUT /api/garden/canvas` — load/save canvas state
- React 18+ (Eden already uses this)

## DB Changes

```sql
CREATE TABLE garden_canvas (
  id TEXT PRIMARY KEY DEFAULT 'default',
  canvas_state TEXT NOT NULL DEFAULT '{}',  -- tldraw serialized JSON
  updated_at TEXT DEFAULT (datetime('now'))
);
```

## Phases

### Phase 1: Basic Canvas
- [ ] Install tldraw
- [ ] Create `/garden/canvas` page
- [ ] Custom GardenCard shape with title + type + interest color
- [ ] Load "now" items as shapes
- [ ] Persist canvas state to DB
- [ ] Manual drag & drop works

### Phase 2: Agent Organisation
- [ ] "Organise" button triggers clustering
- [ ] Cseno can programmatically move/group shapes
- [ ] Zone layout (urgent/explore/reference)
- [ ] Auto-place new items near similar ones

### Phase 3: Polish
- [ ] Sidebar item list with search
- [ ] Minimap for orientation
- [ ] Item detail on double-click (slide-in panel)
- [ ] Remove/archive from canvas (context menu)
- [ ] Dark theme matching Eden

## License

tldraw is Apache 2.0 for self-hosted. Free for our use case. Watermark appears without license key — cosmetic only, can hide with CSS if needed.

## Risks

- **Bundle size:** ~2MB added. Acceptable for Eden (already large).
- **tldraw updates:** SDK is actively developed, API may change. Pin version.
- **Canvas performance:** Should handle 50-100 shapes fine. If garden grows to 500+ "now" items, we'd need virtualisation or pagination (unlikely — "now" should be curated/small).
- **Mobile:** tldraw works on touch but the experience is better on desktop. Eden is primarily desktop anyway.

## Open Questions

1. Should we allow freehand drawing ON the canvas? (tldraw supports it natively, could be fun for Cri to annotate clusters)
2. Should items show a preview image if one exists? (media from tweets, screenshots)
3. Do we want "boards" (multiple canvases)? Or just one global "now" canvas?
