# PRD — Modular Garden Enrichment Trigger + Weekly Sweep

## Summary

Make Garden enrichment mostly event-driven, with Bookworm enriching new eligible items shortly after they are added, while keeping a weekly cron as a backstop/cleanup sweep.

The system must be modular from day one: subtype-specific enrichment (for example `font`, `image`, `material`, `pattern`) should plug into a shared pipeline, with each subtype owning its own schema and enrichment tools.

## Problem

Right now Garden enrichment is underpowered and inconsistent:
- Bookworm has enrichment instructions, but automation is weak
- Garden writes are not centralized through one create path
- many inserts happen via direct SQL/scripts, so there is no clean hook point
- the old enrichment cadence assumption (every 6 hours) is not what we want anymore
- we want ingredient-like objects such as fonts and images to gain richer metadata (`subtype`, `files[]`) without manual maintenance

## Goals

1. New eligible Garden items should trigger Bookworm enrichment automatically
2. Weekly cron should remain as a cleanup/backfill safety net
3. Enrichment writes must follow a strict output contract
4. Special subtypes (starting with fonts) should be first-class enriched ingredient items
5. The system should support many subtype-specific enrichers without changing the core pipeline each time
6. Existing direct-insert paths should gradually converge on a canonical create flow

## Non-Goals

- Full Garden schema redesign in v1
- Real-time enrichment for every temporary/triage item
- DB-level SQLite triggers that call external agents directly
- Large migration of historic Garden entries before the pipeline exists
- Hardcoding subtype logic directly into the main create route in a way that must be edited for every new subtype

## Success Criteria

- New `temporal='ever'` Garden items get queued for enrichment automatically
- Bookworm enriches them using the current prompt and write contract
- Weekly Sunday sweep catches leftovers (`enriched=0`)
- Font items gain `metadata.subtype='font'` and `metadata.files[]` when source pages expose useful assets
- No duplicate or conflicting enrichment writes

## User Stories

### 1. Save a liked font
As Cri, when I save a font source into Garden, I want Bookworm to enrich it automatically so I later get a useful searchable ingredient item without manually maintaining a list.

### 2. Backfill missed items
As Cri, if an item was inserted by an old script or enrichment failed, I want a weekly sweep to catch it.

### 3. Trust the shape of enriched data
As Cri, I want enriched metadata to use a stable shape so querying/filtering later is not JSON soup.

## Functional Requirements

### FR0 — Modular Enricher Architecture
The enrichment system must be designed around a registry/dispatcher model.

Core pipeline responsibilities:
- decide whether an item is eligible for enrichment
- determine subtype (if known or inferable)
- select the correct subtype enricher
- dispatch enrichment work
- merge the resulting metadata safely

Subtype enricher responsibilities:
- define the subtype-specific schema extension
- define the tool strategy used to enrich that subtype
- define any subtype-specific validation/normalization rules

This means the core pipeline should not contain font-specific scraping logic, image-specific palette logic, etc. Those belong in dedicated subtype enrichers.


### FR1 — Canonical Garden Create Path
Create or extend a canonical Garden create path in Eden (likely `POST /api/garden`) that:
- validates auth
- inserts the new Garden item into CC DB
- returns the created item
- optionally triggers post-insert enrichment routing

### FR2 — Enrichment Eligibility Rules
Only auto-trigger Bookworm when the new item is eligible:
- `temporal = 'ever'`
- not already `enriched = 1`
- has enough signal to enrich (typically `original_source` or useful content/media)

Do **not** auto-trigger for:
- `temporal in ('now', 'later')`
- obvious low-value/no-source junk
- items already enriched

### FR3 — Bookworm Invocation
On eligible create:
- send a targeted message to Bookworm with the new Garden item id
- Bookworm enriches that specific item first, not a blind whole-table sweep
- Bookworm writes back via the agreed metadata contract

### FR4 — Weekly Cleanup Cron
Keep a weekly cron that:
- scans for `temporal='ever' AND enriched=0`
- enriches up to a capped batch size
- reports summary to main

### FR5 — Base Metadata Contract
All enrichers must respect a shared base metadata contract:
- base metadata fields like `subtype`, `title`, `description`, `files`
- `metadata.files` shape = `{ title, url }[]`
- append/merge behavior over destructive replacement
- `original_source` remains canonical

### FR6 — Subtype-Specific Schema Extensions
Each special subtype may extend the base metadata contract with its own reserved fields.

Examples:
- `font` → `foundry`, `style`
- `image` → `palette`
- `material` → future fields like finish / category / palette

Subtype-specific fields should be defined per enricher rather than invented ad hoc during runs.

### FR7 — Subtype-Specific Tool Strategy
Each subtype enricher should declare the tools/strategies it uses.

Examples:
- `font` → page fetch + asset extraction + downloadable file discovery
- `image` → image analysis + palette extraction
- `repo` → GitHub/API fetch

This allows new subtypes to be added by registering:
1. subtype name
2. schema extension
3. enrichment instructions/tool strategy

without redesigning the whole system.

### FR8 — Font Enrichment
For font-like sources, the `font` enricher should attempt to extract:
- font/family name
- foundry/publisher
- style/classification if clear/high-confidence
- useful source assets into `metadata.files`
  - previews/specimens/images
  - specimen PDFs
  - direct `.woff2`, `.ttf`, `.otf` files when available

## Technical Approach

## Phase 1 — Spec + core plumbing
- confirm/create `POST /api/garden`
- define request shape and auth
- define response shape
- keep existing GET/PUT/DELETE intact
- define the base enrichment contract and subtype enricher interface

## Phase 2 — Enricher registry / dispatcher
- add a registry/dispatcher layer that maps items to subtype enrichers
- default/base enricher handles generic enrichment
- subtype enrichers plug in without changing route logic each time

Suggested shape (conceptual):
- `baseEnricher`
- `fontEnricher`
- `imageEnricher`
- future: `materialEnricher`, `patternEnricher`, etc.

## Phase 3 — Post-create hook
- after successful insert, decide whether item is enrichment-eligible
- determine subtype / select enricher
- if eligible, call Bookworm through a single integration path:
  - preferred: Eden server route invokes OpenClaw session message / agent message API
  - fallback: enqueue a local job/record for a small watcher to dispatch

## Phase 4 — Targeted Bookworm mode
Extend Bookworm’s Garden enrichment flow to support:
- one-item targeted enrichment by item id
- subtype-aware enrichment instructions/tool strategy
- existing sweep mode remains for cron

## Phase 5 — Migrate writers gradually
Find places still doing direct SQL inserts and migrate them over time to the canonical create path.

## Architecture Notes

### Recommended trigger point
**App/API layer, not DB layer.**

Reason:
- SQLite triggers cannot cleanly call OpenClaw sessions
- many current writers are heterogeneous
- the app layer is where auth, validation, and side effects belong

### Recommended modular structure
The app/API layer should use a modular enricher registry.

Example conceptual shape:
- `src/lib/garden-enrichment/base.ts`
- `src/lib/garden-enrichment/registry.ts`
- `src/lib/garden-enrichment/enrichers/font.ts`
- `src/lib/garden-enrichment/enrichers/image.ts`

Each enricher should expose:
- matching/eligibility rules
- subtype schema extension
- tool/instruction strategy
- merge policy if needed

### Recommended dispatch mechanism
Short-term:
- Eden server calls an existing internal messaging/API route to send Bookworm a targeted enrichment request

Long-term:
- introduce a lightweight enrichment queue table if retries/observability become important

## API Sketch

### POST /api/garden
Request:
```json
{
  "content": "Canela",
  "type": "link",
  "interest": "ingredient",
  "temporal": "ever",
  "note": "High-contrast editorial serif",
  "original_source": "https://..."
}
```

Response:
```json
{
  "item": {
    "id": "...",
    "content": "Canela",
    "type": "link",
    "interest": "ingredient",
    "temporal": "ever",
    "enriched": 0
  },
  "enrichment": {
    "queued": true,
    "reason": "eligible"
  }
}
```

## Bookworm Message Sketch

"Enrich Garden item `<id>` only. Read `~/bookworm/tasks/garden-enrichment.md` and apply the write contract. Do not scan the whole table unless the item is missing. Reply with concise summary only."

## Risks

1. **Direct SQL bypass remains**
   - event-driven enrichment only catches items created through the canonical path
   - mitigation: keep weekly sweep; gradually migrate scripts

2. **Rate limits / over-enrichment**
   - new-item enrichment could spam Bookworm if many items arrive in bursts
   - mitigation: cap/suppress; consider queue later

3. **Subtype sprawl / schema drift**
   - many new subtypes could become inconsistent if they are added casually
   - mitigation: require each subtype enricher to define its reserved fields and tool strategy explicitly

4. **Inconsistent metadata merges**
   - mitigation: use strict contract already added to Bookworm task

5. **Auth/integration friction inside Eden**
   - internal route must call OpenClaw safely and with correct credentials/session routing

## Open Questions

1. Should event-driven enrichment happen synchronously-after-insert or fire-and-forget?
   - recommendation: **fire-and-forget**
2. Should multiple new items be coalesced into one Bookworm run if saved in a burst?
   - recommendation: **not in v1**
3. Should Garden create be exposed only through Eden UI/API, or also via helper CLI/scripts?
   - recommendation: support Eden first, migrate scripts later

## Delivery Plan

### Milestone 1 — API foundation
- add/confirm `POST /api/garden`
- insert item with auth/validation
- return created item

### Milestone 2 — Modular enrichment foundation
- add base enrichment contract
- add enricher registry/dispatcher
- add first subtype enricher: `font`

### Milestone 3 — Auto-enrichment hook
- add enrichment eligibility check
- select correct enricher
- dispatch targeted message to Bookworm after insert

### Milestone 4 — Bookworm targeted mode
- update instructions/runner so Bookworm can enrich by item id cleanly
- make the task subtype-aware and extensible

### Milestone 5 — Verification
- test with one font URL and one image/reference item
- verify metadata shape and `files[]`
- verify weekly sweep still catches leftovers
- verify adding a second subtype does not require redesign of the core pipeline

## Definition of Done

- [ ] Canonical Garden create path exists
- [ ] Modular enricher registry/dispatcher exists
- [ ] New eligible Garden items auto-dispatch Bookworm enrichment
- [ ] Weekly sweep cron remains enabled as cleanup
- [ ] Bookworm supports targeted enrichment for one item
- [ ] At least one dedicated subtype enricher (`font`) is implemented against the modular interface
- [ ] Metadata contract is respected in writes
- [ ] End-to-end tested with at least one font item
