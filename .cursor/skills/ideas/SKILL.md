---
name: ideas
description: Dump raw ideas, feedback, or creative vision — the skill extracts actionable tasks and routes them into the right design doc. Use whenever you want to brain-dump, log feedback, capture a design vision, or just think out loud about the game.
disable-model-invocation: true
---

# Ideas Capture

Brain-dump freely. This skill listens, extracts, and organises — turning rambles into actionable tasks across the right docs.

## What this handles

- Raw creative vision ("I want the game to feel like...")
- Design feedback ("The loot reel feels wrong because...")
- Feature ideas ("What if we added...")
- UX observations ("Players probably get confused when...")
- Prioritisation nudges ("This should be built next, because...")
- Open questions ("I'm not sure whether to...")
- Friction notes ("I keep running into...")

## Hard boundaries

1. Do not modify product code, game features, runtime config, tests, or build files.
2. Do not implement, scaffold, or refactor anything in `apps/`, `packages/`, or `tools/` (source, not docs).
3. Documentation-only. In-scope: `creative/`, `docs/` (including `docs/adr/`), root refs (`README.md`, `CONTEXT.md`), `.cursor` rules/skills, and README files inside source folders.
4. Respect each doc's own conventions. Follow the existing format of the ADRs in `docs/adr/`.

## Workflow

### Step 1 — Intake

Read the user's full dump without interrupting. Extract every distinct concept, observation, or question. Label each one:

- **IDEA** — a new feature, mechanic, or system
- **FEEDBACK** — a reaction to something that already exists
- **VISION** — a direction, feel, or north-star statement
- **TASK** — a concrete, scoped thing to do
- **DECISION** — a question that must be answered before building

### Step 2 — Route

Each item lands in a **detail doc** (the write-up) and, if it is a creative-backlog
item, also gets a **row on the board** ([`creative/backlog.md`](../../creative/backlog.md)) —
the single source of truth for Priority / Status / Size.

| Content | Detail doc | Board row? |
|---|---|---|
| IDEA or VISION about features / systems / mechanics | `creative/design-ideas.md` | Yes |
| FEEDBACK or TASK about UX / polish / feel / housekeeping | `creative/ux-housekeeping.md` | Yes |
| Art/style direction | `creative/art-direction.md` | Only when it becomes a real, scoped task |
| Architectural decisions | `docs/adr/` (follow the existing ADR format) | No |
| Canonical vocabulary additions or corrections | `CONTEXT.md` | No |
| Operational or design reference | `README.md` / `.cursor/rules/` | No |

### Step 3 — Write it up

Add each item to its target detail doc using that doc's existing structure and tone:
- Add a **Review block** (Pros / Cons-Risks / Notes) with a date stamp.
- If an item clearly upgrades, contradicts, or reinforces an *existing* entry, note that inline.

### Step 4 — Cheap touch (NOT a full re-review)

Per the [creative docs protocol](../../.cursor/rules/creative-docs.mdc), capture is
a **cheap touch** — only the item you just wrote, plus its board row:

- Add or update **that item's row** on the board with a **Priority** ([priority scale](../../.cursor/rules/creative-docs.mdc)), a **Status** (Idea / Ready / In progress / Shipped / Blocked), and a **Size** (S / M / L).
- A `DECISION FIRST` gate ⇒ **Blocked**. An unscoped or multi-sprint idea ⇒ **Idea** (and size **L** can never be Ready until sliced).
- **Do NOT** re-read the whole doc, re-rate every other item, or refresh the Game Loop Snapshot. That expensive sweep runs only on an explicit **`/review`**.

### Step 5 — Digest back

After writing, give the user a short summary:

- What was captured (list by type: IDEA / FEEDBACK / VISION / TASK / DECISION)
- Where each item landed (detail doc + its new board row Status/Size)
- Any high-priority items or open DECISION gates (now **Blocked**) that need attention
- Any ideas that conflict with or reinforce existing entries — call them out explicitly

Keep the digest to 10 lines or fewer. Highlight the most important signal, not everything.

## Output style

- Concise and editorial. Not speculative implementation detail.
- New entries: actionable bullets with clear sequencing.
- Decision gates: flagged explicitly as **DECISION FIRST** with the question stated plainly.
- Digest: tight. Surface what matters.
