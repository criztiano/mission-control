# Council Deliberation Engine — Spec

**Origin:** Karpathy's [llm-council](https://github.com/karpathy/llm-council) adapted for our agent team.
**Location:** New page/tab in Eden (`/council`)

## Concept

A structured deliberation UI where selected agents tackle a question through multiple rounds of proposals, peer feedback, improvement, and final synthesis. Every round is saved — you can scrub through to see how ideas evolved.

## Core Flow

```
Question → Round 1 (proposals) → Review (anonymous feedback)
→ Round 2 (improved proposals) → Review → ... → Final Vote → Chairman Synthesis
```

### Stages per Round

1. **Propose** — Each selected agent independently responds to the question (Round 1) or submits an improved version incorporating feedback (Round 2+)
2. **Review** — Each agent reviews all other proposals anonymously (Agent A, B, C — no names). Provides:
   - Structured feedback: strengths, weaknesses, suggestions
   - Score (1-5 or similar)
3. **Improve** — Each agent receives the anonymous feedback on their proposal and submits a revised version

Rounds 2-3 repeat the Review → Improve loop. Number of rounds is configurable (default: 2).

### Final Stage

4. **Vote** — After the last round, each agent ranks all final proposals (anonymous). Aggregate ranking calculated.
5. **Chairman** — Cseno (main agent) synthesizes the final answer from all proposals, feedback, rankings, and evolution.

## UI Components

### Config Bar (top of page)
- **Agent selector** — checkboxes to pick which agents participate (not all questions suit all agents)
- **Model override** — single dropdown to set the model for ALL agents in this session (e.g. ramp everyone to Opus for hard problems). Default: each agent's configured model.
- **Rounds** — number input (1-5, default 2)
- **Start button**

### Main View
- **Round tabs/timeline** — horizontal stepper showing Round 1, Round 2, ..., Vote, Synthesis
- **Per-round view:**
  - Tab panel per agent showing their proposal
  - Expandable section showing feedback they received (anonymous)
  - Diff view option: what changed between rounds
- **Vote view:**
  - Aggregate ranking chart (bar chart or table)
  - Each agent's individual ranking (expandable)
- **Synthesis view:**
  - Chairman's final answer
  - Collapsible "reasoning" showing what influenced the synthesis

### History
- All deliberations saved to DB
- Sidebar list of past deliberations (like Karpathy's conversation list)
- Each round's full state persisted — can revisit any point in time

## Data Model

### Tables

```sql
-- A deliberation session
CREATE TABLE deliberations (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  model_override TEXT,           -- NULL = use agent defaults
  max_rounds INTEGER DEFAULT 2,
  status TEXT DEFAULT 'active',  -- active | voting | complete
  chairman_synthesis TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Agents participating in a deliberation
CREATE TABLE deliberation_agents (
  deliberation_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  PRIMARY KEY (deliberation_id, agent_id),
  FOREIGN KEY (deliberation_id) REFERENCES deliberations(id)
);

-- Each agent's proposal per round
CREATE TABLE deliberation_proposals (
  id TEXT PRIMARY KEY,
  deliberation_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  round INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (deliberation_id) REFERENCES deliberations(id)
);

-- Anonymous feedback from one agent on another's proposal
CREATE TABLE deliberation_feedback (
  id TEXT PRIMARY KEY,
  deliberation_id TEXT NOT NULL,
  round INTEGER NOT NULL,
  reviewer_agent_id TEXT NOT NULL,    -- who wrote the feedback
  target_agent_id TEXT NOT NULL,      -- whose proposal is being reviewed
  anonymous_label TEXT NOT NULL,      -- "Proposal A", "Proposal B", etc.
  strengths TEXT,
  weaknesses TEXT,
  suggestions TEXT,
  score INTEGER,                      -- 1-5
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (deliberation_id) REFERENCES deliberations(id)
);

-- Final anonymous vote/ranking
CREATE TABLE deliberation_votes (
  id TEXT PRIMARY KEY,
  deliberation_id TEXT NOT NULL,
  voter_agent_id TEXT NOT NULL,
  rankings TEXT NOT NULL,             -- JSON array of agent_ids in ranked order
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (deliberation_id) REFERENCES deliberations(id)
);
```

## API Endpoints

```
POST   /api/council                    — Create new deliberation
GET    /api/council                    — List deliberations
GET    /api/council/:id                — Get full deliberation state
POST   /api/council/:id/round         — Trigger next round (fans out to agents)
POST   /api/council/:id/vote          — Trigger final voting
POST   /api/council/:id/synthesize    — Trigger chairman synthesis
```

## Backend Orchestration

Each stage fans out to agents via OpenClaw's `sessions_spawn` or direct API calls:

1. **Propose round:** Spawn N parallel agent sessions, each with the question + any prior feedback. Collect responses.
2. **Review round:** Spawn N parallel sessions, each agent gets anonymized proposals. Collect feedback.
3. **Improve round:** Spawn N parallel sessions, each agent gets their proposal + anonymous feedback. Collect revised proposals.
4. **Vote:** Spawn N parallel sessions, each gets all final proposals anonymized. Collect rankings.
5. **Synthesize:** Single call to Cseno/chairman with full context.

SSE streaming from backend to frontend (like Karpathy's version) so the UI updates as each agent completes.

## Agent Prompts

### Propose (Round 1)
```
You are {agent_name}, participating in a team deliberation.
Question: {question}
Provide your best answer/proposal. Be thorough but concise.
```

### Propose (Round 2+)
```
You are {agent_name}. Here is your previous proposal:
{previous_proposal}

You received this anonymous feedback:
{feedback_items}

Revise and improve your proposal based on the feedback.
Explain what you changed and why.
```

### Review
```
You are reviewing anonymous proposals for this question:
{question}

{proposals_anonymized}

For each proposal, provide:
1. Strengths (what's good)
2. Weaknesses (what's missing or wrong)
3. Suggestions (specific improvements)
4. Score (1-5)

Be honest and constructive. You don't know who wrote what.
```

### Vote
```
Rank these final proposals from best to worst:
{final_proposals_anonymized}

FINAL RANKING:
1. Proposal X
2. Proposal Y
...
```

### Chairman
```
You are chairing a deliberation on: {question}

{full_history: proposals, feedback, improvements, votes}

Synthesize the council's work into a final answer.
Note where consensus formed, where disagreement remained,
and which ideas survived the feedback rounds.
```

## Decisions (Cri, 19 Mar 2026)

1. **Personas: YES** — Agents use their actual roles/viewpoints (Ralph thinks like a PM, Cody like a builder, Scottie like an ops engineer). That's the whole point — different perspectives.
2. **Anonymous to agents, visible in UI** — During deliberation, agents don't know who wrote what. But the UI shows Cri who said what (analytics/insight). Anonymity is for preventing sycophancy between agents, not for hiding from the human.
3. **No spectator mode** — Not needed. Just show results when rounds complete.
4. **Priority: next up** — Nothing else in queue, assign to the team.
