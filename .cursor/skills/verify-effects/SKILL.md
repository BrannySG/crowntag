---
name: verify-effects
description: Verify transient visuals (VFX, particle bursts, damage popups, animations, juice) and set up game states instantly using the window.__dev harness — event log, freeze-on-event, slow-mo, and command/event injection (summon, level up, grant currency, fire any effect on demand) — instead of screenshot-retry loops or grinding real playtime. Use whenever a change involves short-lived effects, whenever a screenshot needs to land at an exact moment, whenever reaching a game state would take real play time, or whenever two browser screenshots in a row failed to capture what you were looking for.
---

# Verify Effects — no screenshot roulette

Transient effects (bursts, zaps, popups, ~300–700 ms animations) cannot be
reliably caught by "screenshot and hope". **Hard rule: after 2 failed attempts
to screenshot a live moment, stop and switch to the harness below.** Repeating
navigate → wait → screenshot is the loop this skill exists to break.

The dev build exposes `window.__dev` (see `apps/client/src/game/devHooks.ts`).
Drive it from the browser via CDP `Runtime.evaluate` with `returnByValue: true`.
It is presentation-side only — it gates the sim loop and Pixi ticker, never
mutates world state.

## Ladder of evidence — start at 1, stop as soon as the question is answered

### 1. Event log (usually sufficient — no screenshot at all)

Every SimEvent is recorded to a 500-entry ring buffer. If the question is
"did the effect fire / with what values", read the log and be done:

```js
window.__dev.events('burstExploded')          // [{ tick, t, type, event }]
window.__dev.events().map(e => e.type)        // recent event types
window.__dev.clearEvents()                    // reset before the action you test
```

A logged event proves the trigger side. Only climb to step 2 if the *look* of
the effect is what changed.

### 2. Freeze-on-event (exact-moment screenshot, deterministic)

Arm a one-shot trigger, cause the event, poll `frozen`, screenshot at leisure:

```js
window.__dev.freezeOnEvent('enemyDied', 120)  // delayMs: how far into the animation to freeze
// ...play until the event fires...
window.__dev.frozen                           // poll via Runtime.evaluate until true
// take screenshot — game is fully frozen mid-effect
window.__dev.thaw()                           // ALWAYS thaw when done
```

`delayMs` picks the moment within the animation (real ms after the event):
~60 for the first flash, ~120 default mid-animation, ~300+ for tails/fades.
Need a different moment? `thaw()`, re-arm with a new `delayMs` — don't retry
live screenshots.

### 3. Slow-mo (when you need to see motion, not one frame)

```js
window.__dev.slowmo(0.2)   // sim + Pixi at 20% speed; screenshots land easily
window.__dev.slowmo(1)     // ALWAYS restore
```

### Also available

```js
window.__dev.paused = true   // hard pause sim (rendering continues)
window.__dev.step(5)         // run exactly 5 sim ticks while paused
window.__dev.snapshot()      // current world snapshot (state assertions)
```

## Fire events and set up states — don't grind

Never play minutes of real time to reach a state. During an active run:

```js
__dev.emit({ type: 'burstExploded', x: 0, y: 0, radius: 80 })
                              // fire ANY SimEvent's presentation reaction
                              // (VFX + HUD + SFX) synthetically; sim untouched.
                              // Payload shapes: packages/sim/src/protocol.ts.
                              // Sim coords: hero at (0,0), enemies spawn at r≈480.
__dev.send({ type: 'summonUnit' })   // dispatch any real SimCommand
__dev.summon(4)               // grant summon cost ×4, then 4 real summons
__dev.levelUp()               // real level-up → perk offer fires naturally
__dev.gainXp(200)             // partial XP (bar juice without leveling)
__dev.grantCurrency(500)      // fund luck/summon purchases
```

`emit` is the fastest way to verify a *look*: combine with freeze —
`freezeOnEvent(type)` then `emit({...})` — for a deterministic screenshot of
any effect with zero gameplay setup. `emit` is presentation-only, so use
`send`/`summon`/`levelUp` when the *state change* itself is under test.
Note `levelUp` legitimately pauses the sim with a perk offer — answer it with
`__dev.send({ type: 'choosePerk', index: 0 })` or the UI.

## Effect → event cheat sheet

| Effect | Event type to log / freeze on |
|---|---|
| Explosion burst / shockwave | `burstExploded` |
| Chain lightning | `chainZap` |
| Beam | `beamFired` |
| Aura pulse | `auraPulsed` |
| Death particles | `enemyDied` |
| Damage popup numbers | `damageDealt` |
| Drop pickup flyer (to HUD) | `dropCollected` |
| Hero hit flash / screen shake | `heroDamaged` |
| Boss/elite entrance (vignette, toast) | `bossSpawned`, `eliteSpawned` |
| Summon/merge burst (DOM, not canvas) | `unitSummoned`, `unitsMerged` |

DOM-side bursts (`unitSummoned`/`unitsMerged`) also leave inspectable elements:
query `.burst-fx`, `.sparkle-burst`, `.legendary-vignette-fx` instead of
racing a screenshot.

## Rules

- **Budget: 2 live-screenshot attempts** per moment, then use the harness.
- Prefer the cheapest rung: event log > freeze > slow-mo > live screenshot.
- **Always clean up**: `thaw()` and `slowmo(1)` before ending the playtest;
  a frozen game invalidates every check after it.
- `window.__dev` exists only in dev builds. If it's `undefined`, verify the
  dev server (not a preview/prod build) is what's loaded.
- Don't add debug code to the game to verify an effect — extend `devHooks.ts`
  only if the harness is genuinely missing a capability.
