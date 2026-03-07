Read @AGENTS.md for project conventions and commands.
Read `specs/xfeed-media-fixes.md` for the full requirements.
Read the current xfeed panel: `src/components/panels/xfeed-panel.tsx`
Read `next.config.js` for current CSP settings.

Create an IMPLEMENTATION_PLAN.md with numbered tasks to implement the spec.
Each task should be small, focused, and independently testable.
Order by dependency (foundational changes first).

Key constraints:
- Tailwind v3.4 (bracket syntax: `h-[var(--name)]` not `h-(--name)`)
- Use `<Button>` component for ALL buttons (never raw `<button>`)
- Check `src/components/ui/` for existing components before creating anything
- Dark mode is primary
