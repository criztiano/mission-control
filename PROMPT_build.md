Study `specs/*` to learn the feature specifications.
Read @IMPLEMENTATION_PLAN.md and choose the most important remaining item.
Read @AGENTS.md for project conventions and build commands.

Before starting, check your available skills — use any that are relevant.

Before making changes, search the codebase — don't assume not implemented.
Implement ONE item. After implementing, run `npx next build` to validate.
If build passes: update @IMPLEMENTATION_PLAN.md (mark done), `git add -A && git commit` with a descriptive message, update STATUS.md.
If build fails: fix until it passes. If the same error appears twice, write CRITICAL BLOCKER in STATUS.md and stop.

When all items in IMPLEMENTATION_PLAN.md are complete, write COMPLETE in STATUS.md.

Rules:
- Use `Button` component for all buttons — never raw `<button>`
- Use `BlockEditor` for any multi-line editable text
- Icons from `iconoir-react` or inline SVGs
- Follow existing patterns in the codebase
- One task per iteration — don't try to do everything at once
