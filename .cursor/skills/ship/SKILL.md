---
name: ship
description: Turn the creative board into shipped work — read the backlog, propose a shortlist of Ready tasks, and (once greenlit) build them end-to-end with a full close-out. Use whenever you want to pick up and ship the next thing from the game's backlog.
disable-model-invocation: true
---

# Ship — board to shipped

The execution counterpart to `ideas`. `ideas` turns rambles into board items; `ship`
turns board items into shipped, closed-out work. The board
([`creative/backlog.md`](../../creative/backlog.md)) is the source of truth for
what is pickable.

## Hard boundaries

1. **Selection is cheap and reversible; building is not.** Always get a greenlight
   before writing product code.
2. Only ever build from the **Ready** pool. Never start an **Idea**, **Blocked**, or
   **L** item — those are not pickable (an L must be sliced into Ready S/M tasks
   first; a Blocked item needs its `DECISION FIRST` gate resolved).
3. Execute greenlit tasks **one at a time**, fully closing out each before the next.
4. Respect the load-bearing invariants in
   [`architecture.mdc`](../../.cursor/rules/architecture.mdc) (commands in /
   events out, sim stays headless, content is data-driven, presentation stays
   removable).

## Workflow

### Step 1 — Read the board

Read [`creative/backlog.md`](../../creative/backlog.md). Filter to **Status = Ready**
and **Size ∈ {S, M}**. Ignore everything else (Idea / Blocked / In progress / L).

If the Ready pool is empty, say so and stop — point the user at the top Blocked
items (and their gates) or Idea epics that need slicing/grilling first. Do not
invent work.

### Step 2 — Propose a shortlist

Present a **ranked shortlist of 3–5** Ready tasks. For each: the task name, its
Priority/Size, a one-line rationale (why it's worth doing now), and a pointer to its
detail write-up. Rank by Priority, then ROI (player-facing impact vs cost), then
sequencing (does shipping it unblock or set up others?).

Keep it tight — this is a menu, not a plan.

### Step 3 — Greenlight gate

Ask the user which to greenlight (one or several). **Wait for the pick.** Do not
write product code before this gate.

### Step 4 — Execute, one at a time

For each greenlit task, in order:

1. Set its board Status to **In progress**.
2. Read the full write-up in the detail doc for scope, decisions, and boundaries.
3. **Scope check:** if the work turns out larger than its size (an L hiding inside
   an S/M, or a hidden `DECISION FIRST`), stop and re-confirm with the user — either
   slice it, or move it back to Idea/Blocked. Do not silently balloon a task.
4. Build it, staying inside the architecture lanes
   ([`architecture.mdc`](../../.cursor/rules/architecture.mdc)); use the
   `codebase-map`, `add-content`, and `extend-protocol` skills for placement.

### Step 5 — Full close-out (definition of done)

A task is not done until **all** of these are true:

1. **Code complete** for the scoped task.
2. **`pnpm typecheck` and `pnpm test` are green** (run them; fix what you broke).
3. **`GAME_VERSION` bumped** — PATCH only, per [versioning.mdc](../../.cursor/rules/versioning.mdc)
   (edit only the one line in `apps/client/src/version.ts`).
4. **Playtested when player-facing** — run the `playtest` skill for anything a
   player can see or feel. Internal-only work (refactors, tooling, tests) skips this.
5. **Board updated** — the row's Status → **Shipped** (move it into the
   "Shipped — recent" table with its version).
6. **Write-up archived** — collapse the detail-doc write-up into a one-line pointer
   under that doc's "Shipped — archived (pointers only)" section.
7. **ADR only if it meets the bar** (hard to reverse, surprising without
   context, the result of a real trade-off) — `docs/adr/`, existing format.
   Most tasks won't need one.

Then move to the next greenlit task. When the set is done, give a tight summary:
what shipped, the new version, and what's now next-best on the board.

## Output style

- Shortlist: a ranked menu, one line of rationale each. No deep planning.
- Execution: act, don't narrate. Report the close-out checklist state per task.
- Summary: tight — what shipped, the version, and the next-best Ready pick.
