# X Feed Media Fixes - Implementation Plan

## Overview
Fix broken media in X Feed: video playback, broken images, multiple images, t.co link previews with OG cards.

## Dependencies
- Current xfeed panel: `src/components/panels/xfeed-panel.tsx`
- CSP config: `next.config.js`
- CC Database: `~/.openclaw/control-center.db`
- Lightbox component: `src/components/ui/lightbox.tsx` (already exists)

## Tasks

### ✅ 1. Create OG cache database schema and helper functions
**File**: `src/lib/og-cache.ts` ✅
- Create SQLite table schema for OG cache: `og_cache` (url, title, description, image, fetched_at)
- Export helper functions: `getOGCache(url)`, `setOGCache(url, data)`
- Use CC Database (`getCCDatabase()` from `src/lib/cc-db.ts`)
- Include migration logic (CREATE TABLE IF NOT EXISTS)

**Test**: Can create and query OG cache table ✅

---

### ✅ 2. Create OG preview API endpoint
**File**: `src/app/api/og-preview/route.ts` ✅
- Accept `?url=xxx` query param
- Check OG cache first (return cached if < 7 days old)
- Fetch URL with 5s timeout, follow redirects
- Parse HTML for `og:title`, `og:description`, `og:image` meta tags
- Save to cache and return JSON: `{ title, description, image, url }`
- Handle errors gracefully (return null data on failure)
- Rate limit: max 1 fetch per second (simple in-memory tracking)

**Test**: Fetch OG data for a known URL, verify caching works ✅

---

### 3. Detect and parse media URLs (images vs videos)
**File**: `src/components/panels/xfeed-panel.tsx` (helper function)
- Create `parseMedia(media_urls: string)` function
- Return: `{ images: string[], videos: { url: string, poster?: string }[] }`
- Video detection: contains `video.twimg.com` AND ends with `.mp4` (ignore query params)
- Handle old thumbnail URLs (`amplify_video_thumb`) as images
- Handle JSON parsing errors gracefully

**Test**: Parse various media_urls formats and verify correct categorization

---

### 4. Detect t.co links in tweet content
**File**: `src/components/panels/xfeed-panel.tsx` (helper function)
- Create `extractTcoLinks(content: string)` function
- Regex: `/https:\/\/t\.co\/\w+/g`
- Return array of t.co URLs found in content
- Deduplicate URLs

**Test**: Extract t.co links from sample tweet content

---

### 5. Create OG preview card component
**File**: `src/components/ui/og-card.tsx`
- Props: `url: string`
- Fetch OG data from `/api/og-preview?url=xxx` on mount
- Show loading state (small spinner)
- Render compact card: image left (80×80), title+description right
- Whole card clickable (link to original URL)
- Handle no-image case (show placeholder or hide image area)
- Handle fetch errors (hide card silently)
- Style: rounded, border, bg-surface-1, hover effect
- Use `<Button>` wrapper or `<a>` with button styling

**Test**: Render with known URL, verify loading and display

---

### 6. Update CSP for video.twimg.com
**File**: `next.config.js`
- Add `https://video.twimg.com` to `media-src` (already present, verify)
- Verify `https://pbs.twimg.com` in `img-src` (already present)
- Consider adding wildcard `https://*.twimg.com` if allowed

**Test**: Build passes, video and images load without CSP errors

---

### 7. Add image error handling
**File**: `src/components/panels/xfeed-panel.tsx` (TweetCard component)
- Add `onError` handler to `<img>` elements
- Set state to hide broken images (e.g., `brokenImages` Set)
- Don't show broken image icon
- Apply to both preview images and OG card images

**Test**: Broken image URLs hide gracefully

---

### 8. Implement multiple image grid layout
**File**: `src/components/panels/xfeed-panel.tsx` (TweetCard component)
- Replace single image preview with grid
- Layout:
  - 1 image: full width (max-h-[300px])
  - 2 images: 2-col grid (equal width)
  - 3+ images: 2×2 grid with cropping
- All images clickable → Lightbox
- Rounded corners, hover effect
- Use Tailwind grid: `grid grid-cols-2 gap-1`

**Test**: Display 1, 2, 3, 4 images correctly

---

### 9. Implement video playback
**File**: `src/components/panels/xfeed-panel.tsx` (TweetCard component)
- Render `<video>` element for video URLs
- Attributes: `controls`, `muted`, `preload="metadata"`, `poster` (if available)
- Styling: `rounded-lg`, `w-full`, `max-h-[400px]`, `object-cover`
- Add `onError` handler to hide failed videos
- Place below images (if both exist)

**Test**: Video URLs play with controls, poster shows, failed videos hide

---

### 10. Integrate OG preview cards into TweetCard
**File**: `src/components/panels/xfeed-panel.tsx` (TweetCard component)
- Extract t.co links from `tweet.content`
- Render `<OGCard>` for each t.co link below main content
- Position: after content, before media, separated with spacing
- Max 3 OG cards per tweet (avoid spam)

**Test**: Tweets with t.co links show OG preview cards

---

### 11. Update Lightbox to support multiple images with navigation
**File**: `src/components/ui/lightbox.tsx` (enhancement)
- Props: `images: string[]`, `initialIndex: number`, `onClose: () => void`
- Add ← / → buttons for navigation (if multiple images)
- Keyboard: Left/Right arrow keys to navigate
- Show index indicator (e.g., "2 / 4")
- Ensure Escape closes, backdrop click closes

**Test**: Navigate between multiple images in Lightbox

---

### 12. Wire up Lightbox with multiple images in TweetCard
**File**: `src/components/panels/xfeed-panel.tsx` (TweetCard component)
- Pass all images to Lightbox
- Set `initialIndex` based on clicked image
- Update `lightboxImage` state to `{ images: string[], index: number } | null`

**Test**: Click any image opens Lightbox at correct index, can navigate

---

### 13. Add visual polish and loading states
**File**: `src/components/panels/xfeed-panel.tsx` (TweetCard component)
- Loading skeleton for OG cards while fetching
- Smooth transitions for image hover effects
- Video poster fallback (show first frame or placeholder)
- Polish spacing and alignment
- Ensure dark mode styling is correct

**Test**: All media loads smoothly, no layout shift

---

### 14. Test end-to-end with real data
- Load X Feed panel with various tweet types
- Test videos play correctly
- Test multiple images show in grid and open in Lightbox
- Test t.co links show OG cards
- Test broken images/videos hide gracefully
- Verify no CSP errors in console

**Test**: All acceptance criteria met

---

### 15. Run build and verify CSP
**File**: `next.config.js`
- Run `npx next build`
- Verify no CSP violations in build output
- Test in production mode with `npx next start -p 3333`

**Test**: Build passes, no console errors, all media loads in production

---

## Acceptance Criteria (from spec)
- [ ] Build passes (`npx next build`)
- [ ] Video URLs render as `<video>` with playback controls
- [ ] Broken images hide gracefully (no broken icon)
- [ ] Multiple images show in grid layout
- [ ] t.co links in content show OG preview cards
- [ ] OG data cached in SQLite
- [ ] All media clickable (images → Lightbox, videos → play)
- [ ] CSP allows all Twitter media domains

## Key Constraints
- **Tailwind v3.4**: Use bracket syntax: `h-[var(--name)]`, `z-[-1]`
- **Button component**: Always use `<Button>` from `src/components/ui/button.tsx`
- **No raw HTML**: Never use `<button>`, `<select>`, `<textarea>` directly
- **Dark mode primary**: Test in dark mode
- **Existing components**: Check `src/components/ui/` before creating new ones

## Notes
- OG cache uses CC Database (shared with OpenClaw gateway)
- Rate limiting is simple in-memory (sufficient for single-user)
- Videos auto-mute by default (better UX)
- Lightbox already exists but needs multi-image enhancement
- CSP already has most Twitter domains, just verify video.twimg.com
