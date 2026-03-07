Read @AGENTS.md for project conventions and commands.
Read @BUGFIX_NOTES.md FIRST — it contains the core problem, the failed attempt, and the strategy for the next fix. Do NOT repeat the failed approach.

## YOUR TASK
Videos don't play in the X Feed panel. Images work now. The DB has valid `.mp4` URLs from `video.twimg.com` but the browser can't load them (likely CDN hotlink protection or CORS).

## WHAT TO DO
1. Create a **server-side media proxy** at `/api/media-proxy/route.ts`:
   - Accept `?url=xxx` query param (URL-encoded video URL)
   - Validate URL is from `video.twimg.com` or `pbs.twimg.com` (security: don't proxy arbitrary URLs)
   - Fetch the video server-side with `fetch(url)` 
   - Stream the response back with correct `Content-Type` header
   - Handle errors gracefully (return 404/502)

2. Update `src/components/panels/xfeed-panel.tsx`:
   - Change video `src` from raw Twitter URL to `/api/media-proxy?url=${encodeURIComponent(videoUrl)}`
   - Also proxy images through the same endpoint (fixes any remaining broken images)
   - **TEMPORARILY remove the `onError` video hide handler** — replace with `console.error` so we can debug

3. Update CSP in `next.config.js`:
   - No need for `video.twimg.com` in `media-src` anymore since videos come from self
   - Keep `pbs.twimg.com` in `img-src` as fallback

4. **Validate:**
   - `npx next build` — must pass
   - Restart: `pkill -9 -f "next-server" 2>/dev/null; npx next start -p 3333 -H 0.0.0.0 &`
   - Open http://localhost:3333 → X Feed panel
   - Check if videos play with controls
   - Check browser console for errors
   - If videos STILL don't play → append failure to @BUGFIX_NOTES.md
   - If videos play → write `STATUS: COMPLETE` at bottom of @BUGFIX_NOTES.md

## CONSTRAINTS
- Use existing `<Button>` component for any new UI elements
- Tailwind v3.4 bracket syntax
- Dark mode primary
- Check `src/components/ui/` before creating new components
