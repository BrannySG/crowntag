---
name: codebase-map
description: Navigation and code-placement guide for the LottoTD Survivors monorepo — which file owns what, where new code belongs, and the known gotchas. Use when unsure where code should live (world.ts vs content, store.ts vs CombatCanvas), when orienting in an unfamiliar area, or before editing one of the large files.
---

# Codebase Map

Three-layer pnpm monorepo: **content** (`packages/content`, `@lotto/content`) →
**sim** (`packages/sim`, `@lotto/sim`) → **client** (`apps/client`,
`@lotto/client`). No server yet. Layer rules live in
`.cursor/rules/architecture.mdc`.

## Sim — `packages/sim/src`

- `world.ts` (~1400 lines, the one monolith) — the entire deterministic sim:
  `World` class, `send(cmd)` queueing, `step()` (one 1/30s tick), the
  `applyCommand()` switch (~line 478), perk-effect switch (~line 726), attack
  resolution per kind (~line 1067), and `_test*` helpers for tests/dev.
  There is no `systems/` split yet — search within the file, don't read it
  end-to-end.
- `protocol.ts` — `SimCommand` / `SimEvent` unions. The whole client API.
- `rng.ts` — seeded RNG; determinism depends on it. Never use `Math.random`
  in sim code.
- Headless invariant: no browser APIs, no timers, imports only from
  `@lotto/content`. Time advances only via `step()`.

## Content — `packages/content/src`

Pure data + pure functions (see `add-content` skill for checklists):
`units.ts`, `enemies.ts`, `recipes.ts`, `perks.ts`, `waves.ts`, `levels.ts`,
`economy.ts`, `meta.ts`, `hero.ts`, `types.ts`.

## Client — `apps/client/src`

- `state/store.ts` — Zustand `useGameStore`: owns the `World` instance,
  `sendCommand()`, snapshot, and three event channels (`eventQueue` for canvas
  VFX, `uiEvents` for HUD toasts, `benchUiEvents` for summon/merge reveals).
- `state/meta.ts` — `useMetaStore`: shards, upgrades, unlock progress;
  persisted to localStorage `lotto-td-meta-v1`.
- `game/loop.ts` — fixed-timestep sim driver (RAF + accumulator, 30 Hz),
  routes each tick's events to the store channels + SFX, handles run-end.
- `game/devHooks.ts` — `window.__dev` debug harness (see `verify-effects`
  skill). Dev-only surface; keep presentation-side.
- `game/CombatCanvas.tsx` (~1330 lines) — the entire Pixi Combat Space:
  app lifecycle, actor rendering, and all canvas VFX inside one `useEffect`
  closure. Its ticker consumes `eventQueue` then clears it.
- `ui/` — React Bench Space + HUD: `BenchPanel.tsx` (~780 lines, grid,
  drag-merge, `BurstFX`), `HudOverlay.tsx`, `PerkModal.tsx`, `LevelSelect.tsx`,
  `ResultsScreen.tsx`, `UpgradeShop.tsx`, `UnitCard/Chip.tsx`,
  `portraits.ts` (unit id → portrait art), `rarity.ts` (rarity → color).
- `audio/sfx.ts` — `wireSfx(events)`: SimEvent → Web Audio one-shots.
- `App.tsx` — single-page composition: title overlay, canvas, panels, modals,
  build badge. No router.
- `styles.css` (~5000+ lines) — all styling. Search, don't read.
- `version.ts` — `GAME_VERSION`; bump PATCH every change.

## Placement rules of thumb

| New thing | Where |
|---|---|
| Number/definition tweak | `packages/content` (never hardcode in sim/client) |
| Game rule / behavior | `world.ts` + protocol event (see `extend-protocol`) |
| Canvas juice reacting to an event | `CombatCanvas.tsx` ticker, driven by `eventQueue` |
| DOM juice (bench, modals) | `ui/` component + `styles.css`, driven by `benchUiEvents`/store |
| HUD-visible state | project through the store from snapshot/events |
| Dev/agent tooling | `game/devHooks.ts` |

## Known gotchas

- **Two clocks:** the sim runs at a fixed 30 Hz via `loop.ts`; Pixi's ticker
  runs at display rate and owns VFX TTLs. `__dev.slowmo()` scales both;
  scaling only one desyncs feel.
- **`eventQueue` is transient** — CombatCanvas clears it every frame. Anything
  that must outlive a frame needs its own store projection (or the `__dev`
  event log for debugging).
- **`world.paused`** — the sim self-pauses on `perkOffered` until `choosePerk`
  arrives; a "stuck" game usually means an unanswered perk offer.
- **Run-end idempotency** — `loop.ts` guards `recordRun` against duplicate
  `runEnded`; don't add a second grant path.
- **Sprites are optional** — units/enemies without a field sprite render as
  procedural shapes from their `color`/`shape` def; not a bug.
- **Determinism** — same seed + same command sequence = same run. Sim tests
  rely on this; keep `Math.random` out of `packages/sim`.
