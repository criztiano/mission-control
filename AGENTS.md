# AGENTS.md — Eden (Mission Control)

## What This Is

Eden is the web dashboard for managing OpenClaw agents, tasks, garden items, and feeds. It's a **Next.js 15 app** with a SQLite backend, designed for a single-user multi-agent household.

- **Repo:** `github.com/builderz-labs/mission-control`
- **Local URL:** `http://localhost:3333`
- **Build/deploy:** `npx next build && npx next start -p 3333 -H 0.0.0.0`
- **Env vars require rebuild** — Next.js Turbopack bakes them at build time

## Tech Stack

| Layer | Tech |
|-------|------|
| Framework | Next.js 15 (App Router, Turbopack) |
| Language | TypeScript |
| UI | React 19, Tailwind CSS |
| Components | Custom (`src/components/ui/`), iconoir-react icons |
| Rich text | BlockNote (`@blocknote/react`) |
| State | Zustand (`src/store/index.ts`) |
| Database | better-sqlite3 (two DBs — see below) |
| Auth | Cookie-based sessions, API key auth |
| Charts | Recharts |
| Graphs | @xyflow/react (agent network) |

## Database

**Two SQLite databases:**

1. **App DB** (`config.dbPath`) — users, sessions, agents, webhooks, audit logs, settings
   - Access: `src/lib/db.ts` → `getDatabase()`
   - Migrations: `src/lib/migrations.ts`

2. **CC DB** (`~/.openclaw/control-center.db`) — tasks/issues, garden items, tweets/xfeed
   - Access: `src/lib/cc-db.ts` → `getCCDatabase()`
   - Tables: `issues`, `issue_comments`, `garden`, `tweets`, `projects`
   - Shared with OpenClaw gateway — external processes also read/write this DB

**Important:** The CC DB is the **source of truth** for tasks and garden. Don't create parallel storage.

## Project Structure

```
src/
├── app/
│   ├── api/              # API routes (Next.js route handlers)
│   │   ├── tasks/        # CRUD for issues/tasks (CC DB)
│   │   ├── garden/       # Garden items (CC DB)
│   │   ├── xfeed/        # X/Twitter feed (CC DB)
│   │   ├── agents/       # Agent management
│   │   ├── auth/         # Login, users, sessions
│   │   ├── sessions/     # OpenClaw session management
│   │   └── ...
│   ├── layout.tsx        # Root layout (dark theme, nav)
│   └── globals.css       # Tailwind + HSL color system
├── components/
│   ├── ui/               # Reusable primitives ⬇️
│   ├── layout/           # App shell (nav-rail, header-bar, live-feed)
│   ├── panels/           # Main content panels (one per nav item)
│   ├── dashboard/        # Overview/stats components
│   ├── chat/             # Agent chat interface
│   └── hud/              # Connection status overlay
├── lib/                  # Server utilities, DB, auth, config
├── store/                # Zustand store (client state)
└── types/                # Shared TypeScript types
```

## UI Components (`src/components/ui/`)

**Always use these instead of raw HTML elements:**

| Component | File | Usage |
|-----------|------|-------|
| `Button` | `button.tsx` | All buttons. Variants: `default`, `outline`, `ghost`, `destructive`, `destructive-outline`, `secondary`. Sizes: `default`, `sm`, `xs`, `icon`, `icon-sm`, `icon-xs`, `icon-lg`, `icon-xl`, `lg`, `xl` |
| `PropertyChip` | `property-chip.tsx` | Inline editable property badges (status, priority, assignee). Supports `colorFn`, `searchable`, `options`, `align` |
| `BlockEditor` | `block-editor.tsx` | Rich text editor (BlockNote). Use for task descriptions, notes |
| `AgentAvatar` | `agent-avatar.tsx` | Agent/user avatars with color coding |
| `DigitalClock` | `digital-clock.tsx` | Header clock display |
| `OnlineStatus` | `online-status.tsx` | Connection indicator dot |
| `ThemeToggle` | `theme-toggle.tsx` | Dark/light mode switch |

**Rules:**
- Never use raw `<button>` — always `<Button>` with appropriate variant/size
- Icon-only buttons: use `size="icon"` (or `icon-sm`, `icon-xs`) + `title` attribute for accessibility
- Destructive actions: `variant="destructive-outline"` for buttons, ghost trash icon for inline delete
- Icons: use `iconoir-react` or inline SVGs (16×16 default, match `[&_svg]:size-4` from Button)
- **Every multi-line editable text area must use `BlockEditor`** — never use raw `<textarea>`. Single-line inputs (`<input type="text">`) are fine. If a user can write more than one line, it's a BlockEditor.

## Navigation Structure

The app uses a **nav rail** (left sidebar) with collapsible sections:

| Section | Panels |
|---------|--------|
| **Core** | Inbox, Tasks, Garden, Feed, Crew |
| **Observe** | Overview, Sessions, Activity, Logs, Tokens, Memory |
| **Automate** | Cron, Spawn, Webhooks, Alerts |
| **Admin** | Users, Audit, History, Gateways, Config, Integrations |

Each panel = one file in `src/components/panels/`. Panel selection is managed by Zustand store (`activePanel`).

## Styling Conventions

- **Tailwind CSS** with HSL custom properties (defined in `globals.css`)
- Dark theme is primary — test in dark mode first
- Color tokens: `bg-card`, `text-foreground`, `border-border`, `bg-surface-1`, `text-muted-foreground`
- Status colors: green=done, yellow=in_progress, purple=review, red=blocked/destructive
- Responsive: use `sm:` breakpoint for mobile→desktop. Mobile-first.
- Transitions: `transition-colors` for interactive elements
- Spacing: `gap-2`, `p-4` for panels, `px-4 py-2.5` for list rows

## Patterns

### API Routes
- All in `src/app/api/` using Next.js route handlers
- Auth check: `requireAuth(request)` from `src/lib/auth.ts`
- CC DB access: `getCCDatabase()` from `src/lib/cc-db.ts`
- Return JSON: `NextResponse.json({ data })`

### Task/Issue Model
```typescript
interface Task {
  id: number
  title: string
  description?: string  // Markdown
  status: 'inbox' | 'assigned' | 'in_progress' | 'review' | 'quality_review' | 'done'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  assigned_to?: string  // Agent name or 'cri'
  created_by: string
  tags?: string[]
  metadata?: any
}
```

### Panel Component Pattern
```typescript
export function MyPanel() {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => { /* fetch from /api/... */ }, [])
  useEffect(() => { fetchData() }, [fetchData])

  // Optional: smart polling
  useSmartPoll(fetchData, 15000)

  return (
    <div className="h-full flex flex-col">
      {/* Fixed header */}
      <div className="flex justify-between items-center p-4 border-b border-border flex-shrink-0">
        <h2 className="text-xl font-bold text-foreground">Panel Title</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={fetchData} title="Refresh">
            {/* refresh icon */}
          </Button>
        </div>
      </div>
      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* content */}
      </div>
    </div>
  )
}
```

### Modal Pattern
- Fixed header (title, nav, close) + scrollable middle + fixed footer (actions/input)
- Backdrop: `fixed inset-0 bg-black/60 backdrop-blur-sm`
- Card: `bg-card border border-border rounded-lg max-w-2xl w-full max-h-[90vh] flex flex-col`
- Close on backdrop click + Escape key
- Navigation with ↑/↓ arrows between items

## Key Libraries

- **`useSmartPoll`** (`src/lib/use-smart-poll.ts`) — polls with backoff, pauses when tab hidden
- **`useMissionControl`** (`src/store/index.ts`) — Zustand store for active panel, sidebar state, theme
- **`class-variance-authority`** — used for Button variants
- **`cn()`** (`src/lib/utils.ts`) — clsx + tailwind-merge utility

## Don'ts

- Don't use Notion API for tasks — everything is in SQLite (CC DB)
- Don't create new UI primitive components without checking `src/components/ui/` first
- Don't use `<button>` or inline styles — use `<Button>` and Tailwind
- Don't hardcode colors — use CSS custom properties via Tailwind tokens
- Don't put business logic in components — keep it in API routes or `src/lib/`
- Don't use `useState` for server data that should be in the URL or store
