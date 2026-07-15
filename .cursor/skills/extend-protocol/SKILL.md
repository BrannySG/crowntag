---
name: extend-protocol
description: Step-by-step chain for adding a new SimCommand or SimEvent — from the protocol union through the sim World, a sim test, and the client projection. Use whenever a task adds new player-visible behavior that content alone can't express, adds a command/event, or extends the sim's rules.
---

# Extend the Protocol (SimCommand / SimEvent)

The sim is reached only through commands in, events out. Before starting,
confirm the behavior can't be a **content-only** change (see the `add-content`
skill) — the sim only gains *generic, reusable* rules.

Work through the chain in order; `pnpm typecheck` catches missed steps via
union exhaustiveness.

## 1. Protocol — `packages/sim/src/protocol.ts`

Add the command to the `SimCommand` union and the emitted event(s) to
`SimEvent`. Events carry everything presentation needs (positions, amounts,
ids) — the client must never reach into sim internals to render a reaction.

## 2. Sim — `packages/sim/src/world.ts`

- Commands queue via `send()` and drain at the start of `step()`; add a `case`
  to the `applyCommand()` switch (~line 478). Keep the case small — extract a
  private method if the logic is more than a few lines.
- **Headless invariant:** no browser APIs, no timers, no `Math.random` (use
  the seeded `rng.ts`), imports only from `@lotto/content`.
- Never mutate state without emitting the event that lets the client project
  the change. Invalid commands are a silent no-op, not a throw.

## 3. Sim test — `packages/sim/test/world.test.ts`

Follow the existing convention:

```ts
const world = new World({ seed: 42 });
world.send({ type: 'yourCommand', /* ... */ });
const events = world.step();
// assert on event types/payloads and on world.snapshot()
```

The `runSteps(world, n)` helper drives many ticks and auto-answers perk offers.
`_test*` methods on `World` (e.g. `_testGainXp`) exist for state setup —
mirror that convention if you need a new injector, never a public cheat.

## 4. Client projection

- **Snapshot state** (HP, currency, grid) flows automatically — the HUD reads
  `useGameStore().snapshot`.
- **Events:** `apps/client/src/game/loop.ts` routes each tick's events; if the
  new event drives HUD toasts or bench reveals, add its type to the `uiEvents`
  / `benchUiEvents` filters there. Canvas VFX read the main `eventQueue` in
  `CombatCanvas.tsx`'s ticker — add a handler there for in-world juice.
- SFX: map the event in `apps/client/src/audio/sfx.ts` `wireSfx` if it should
  make a sound.
- Presentation must stay removable: deleting the VFX/SFX reaction must not
  change sim outcomes.

## 5. Verify without grinding

`window.__dev` (see `verify-effects` skill) can drive the new surface
directly: `__dev.send({ type: 'yourCommand' })` dispatches the real command;
`__dev.emit({ type: 'yourEvent', ... })` fires the presentation reaction
synthetically to check VFX/HUD without sim setup.

## Close-out

`pnpm typecheck && pnpm test` green, bump `GAME_VERSION` PATCH in
`apps/client/src/version.ts`, and consider an ADR in `docs/adr/` if the change
is hard to reverse or the result of a real trade-off.
