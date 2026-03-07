# X Feed Media Fixes

## Problems
1. **Broken images**: Some image URLs don't load (CSP, format, or dead URLs)
2. **No video playback**: Video URLs (`.mp4` from `video.twimg.com`) are rendered as `<img>` — need actual `<video>` element
3. **t.co links in text**: Tweet content contains `https://t.co/xxx` shortened URLs that could be images, videos, or articles — these should show OG preview cards
4. **Old video entries**: Some `media_urls` contain thumbnail URLs (`amplify_video_thumb`) not actual video — these should render as images (they ARE images, just thumbnails)

## Requirements

### Video Playback
- Detect video URLs: contains `video.twimg.com` and ends with `.mp4` (possibly with query params)
- Render with `<video>` element: controls, muted by default, poster thumbnail if available, rounded corners
- Fallback: if video fails to load, show thumbnail or hide gracefully

### Image Fixes
- Add `onError` handler to hide broken images instead of showing broken icon
- Support multiple images: show grid (2 images = 2-col, 3+ = 2x2 grid)
- All images clickable → Lightbox

### t.co Link Previews (OG Cards)
- Scan tweet `content` for `https://t.co/` URLs
- Create an API endpoint `/api/og-preview?url=xxx` that fetches the URL, follows redirects, extracts `og:title`, `og:description`, `og:image` meta tags
- Render as a compact card below tweet content: image left, title+description right, linked to actual URL
- Cache OG data in a simple SQLite table (`og_cache`: url, title, description, image, fetched_at) to avoid re-fetching
- Rate limit: max 1 fetch per second, timeout 5s per URL

### CSP Updates
- Ensure `video.twimg.com` is in `media-src` (for video playback)
- Add `*.twimg.com` wildcard if possible, or add specific subdomains as discovered

## Technical Notes
- Panel: `src/components/panels/xfeed-panel.tsx`
- CSP config: `next.config.js`
- DB: `~/.openclaw/control-center.db` table `tweets`
- Use `<Button>` component for any new buttons
- Tailwind v3.4 bracket syntax
- Dark mode primary

## Acceptance Criteria
- [ ] Build passes (`npx next build`)
- [ ] Video URLs render as `<video>` with playback controls
- [ ] Broken images hide gracefully (no broken icon)
- [ ] Multiple images show in grid layout
- [ ] t.co links in content show OG preview cards
- [ ] OG data cached in SQLite
- [ ] All media clickable (images → Lightbox, videos → play)
- [ ] CSP allows all Twitter media domains
