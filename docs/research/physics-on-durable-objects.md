# Research: Physics for predicted movement on Durable Objects

**Ticket:** [#3](https://github.com/BrannySG/crowntag/issues/3)  
**Date:** 2026-07-15  
**Scope:** Crown Tag V1 — third-person move / jump / sprint, stun / knockback, client prediction + reconciliation, sim ticking inside a Cloudflare Durable Object.

## Question

Should V1 use a **simple custom** capsule/AABB + gravity/impulses approach, or a **real physics engine** (e.g. Rapier)? Compare against DO CPU limits, Worker bundle size, and prediction/reconcile complexity. Bias toward simple custom unless knockback/jump reconciliation is painful without an engine.

## Recommendation

**Use a simple custom capsule (or AABB) controller with gravity, ground collision, and velocity impulses for stun/knockback.** Do **not** adopt Rapier (or another general physics engine) for V1.

V1’s movement needs are a fixed set of character rules on graybox static geometry, not a general rigid-body world. Rapier’s own character controller is still kinematic move-and-slide with **caller-supplied** gravity and trajectory; knockback remains game logic you apply yourself. Running the same custom integrate on client and DO keeps reconcile state tiny (`position`, `velocity`, `grounded`, stun timers) and avoids ~1.5 MB Wasm, async init, and cross-platform determinism package constraints. Jump and knockback reconciliation stay tractable via standard rewind-and-replay as long as the integrate is deterministic and shared.

Revisit Rapier only if post-V1 needs stacks of dynamic props, ragdolls, or complex terrain that a hand-rolled capsule cannot absorb.

---

## Constraints from primary sources

### Durable Objects / Workers (Cloudflare)

| Constraint | Value | Source |
| --- | --- | --- |
| DO = special Worker; Workers limits apply by plan | — | [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/) |
| CPU per request / WebSocket message | Default **30 s** active CPU; Paid configurable up to **5 min** via `limits.cpu_ms` | [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| CPU accounting | Active compute only; network / storage I/O does **not** count | Same |
| CPU reset on DO | Each incoming HTTP request or WebSocket message resets remaining CPU to the per-invocation budget | [DO limits footnote](https://developers.cloudflare.com/durable-objects/platform/limits/) |
| Wall time (DO RPC/HTTP/WebSocket while connected) | Unlimited while caller stays connected | [DO limits — wall time](https://developers.cloudflare.com/durable-objects/platform/limits/) |
| DO alarm handler wall time | **15 min** | Same |
| Individual DO | Single-threaded; soft ~**1 000** requests/s | [DO limits FAQ](https://developers.cloudflare.com/durable-objects/platform/limits/) |
| Memory per isolate | **128 MB** (JS heap **and** Wasm allocations) | [Workers limits — Memory](https://developers.cloudflare.com/workers/platform/limits/) |
| Worker size (after gzip) | Free **3 MB** / Paid **10 MB** (64 MB before compression) | [Workers limits — Worker size](https://developers.cloudflare.com/workers/platform/limits/) |
| Worker startup | Global scope must finish in **1 s** | [Workers limits — Startup](https://developers.cloudflare.com/workers/platform/limits/) |
| WebAssembly | Supported via `WebAssembly.instantiate` of precompiled modules; Wrangler bundles `.wasm`; **no threading**; SIMD supported; Wasm typically increases bundle size and startup cost | [Workers Wasm](https://developers.cloudflare.com/workers/runtime-apis/webassembly/), [Wasm in JS](https://developers.cloudflare.com/workers/runtime-apis/webassembly/javascript/) |
| Alarms | One alarm per DO; at-least-once; useful to wake/tick without inbound traffic | [DO Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/) |

**Implication for tick rate:** A 20–60 Hz room tick with ≤12 players + bots is well inside the default 30 s CPU budget **per message/alarm**, as long as each tick stays cheap (milliseconds, not hundreds). The binding constraint is **per-tick CPU and memory**, not the 30 s ceiling. Continuous ticking while WebSockets are open is allowed by wall-clock rules; use alarms if you need ticks when nobody is sending.

### Rapier (official)

| Fact | Source |
| --- | --- |
| Official JS is a **WebAssembly** module (`@dimforge/rapier2d` / `@dimforge/rapier3d`); must load/init asynchronously | [Rapier JS getting started](https://rapier.rs/docs/user_guides/javascript/getting_started_js/) |
| `-compat` packages embed Wasm as **base64** in JS → **larger** packages for broader bundler support | Same; [package README](https://www.npmjs.com/package/@dimforge/rapier3d) (via published `package/README.md`) |
| Default `@dimforge/rapier3d` is **locally** deterministic only — **not** guaranteed cross-platform (client browser ≠ DO isolate) | [Published package README — Feature selection](https://www.npmjs.com/package/@dimforge/rapier3d) |
| Cross-platform determinism requires `@dimforge/rapier3d-deterministic` (less optimized) | Same README; Rust feature docs: [Determinism](https://rapier.rs/docs/user_guides/rust/determinism/) |
| Full world snapshot: `world.takeSnapshot()` → `Uint8Array`; restore via `World.restoreSnapshot` | [JS serialization](https://rapier.rs/docs/user_guides/javascript/serialization/) |
| Character controller = kinematic **move-and-slide**; user provides desired translation; **gravity is emulated by the caller**; rotations unsupported; recommended shapes: cuboid, ball, or capsule | [JS character controller](https://rapier.rs/docs/user_guides/javascript/character_controller/) |
| Character controller is intentionally generic; docs note character control is often **game-specific** and the builtin may not fit all games | Same |

**Measured package artifact (primary: npm pack of published tarball):**

| Package | Version | `rapier_wasm3d_bg.wasm` size |
| --- | --- | --- |
| `@dimforge/rapier3d` | 0.19.3 | **1 570 176 bytes** (~1.50 MiB) |
| `@dimforge/rapier3d-deterministic` | 0.19.3 | **1 601 515 bytes** (~1.53 MiB) |

Unpacked npm sizes (registry metadata): `@dimforge/rapier3d` ≈ 2.87 MB; `@dimforge/rapier3d-compat` ≈ 8.21 MB (base64 embed). After gzip, ~1.5 MB Wasm fits Paid **10 MB** and usually Free **3 MB**, but consumes a large fraction of Free headroom and adds startup/parse cost toward the **1 s** startup limit ([Workers Wasm binary size note](https://developers.cloudflare.com/workers/runtime-apis/webassembly/)).

---

## Comparison for Crown Tag V1

### 1. DO CPU

| Approach | Fit |
| --- | --- |
| **Custom capsule** | Integrate gravity + collide vs static graybox for ≤12 players + fillers is O(n) AABB/capsule tests — expected sub-ms to low-ms per tick. Comfortably inside DO CPU budgets. |
| **Rapier** | Also feasible at this player count: one `world.step()` (and/or character-controller queries) per tick is designed for games. Not blocked by the 30 s limit. Cost is higher constant factors (Wasm + broad/narrow phase) for little V1 gain. |

**Verdict:** Neither is CPU-blocked at V1 scale. Custom stays cheaper and more predictable under the **128 MB** isolate budget.

### 2. Bundle size / startup

| Approach | Fit |
| --- | --- |
| **Custom** | Tens of KB of TS shared between client and Worker. Negligible vs Worker size and startup limits. |
| **Rapier** | ~1.5 MB Wasm in the **Worker/DO script** (and again on the client if predicted with the same engine). Allowed on Paid; painful on Free; increases isolate memory and startup risk. `-compat` makes it worse. |

**Verdict:** Strong preference for custom on Workers/DO footprint.

### 3. Prediction / reconciliation complexity

| Concern | Custom | Rapier |
| --- | --- | --- |
| Shared sim | Ship one pure `step(state, input, dt)` used by client + DO | Must load Wasm on both; match **deterministic** package + identical step order |
| State to reconcile | Small POD (pos/vel/flags) | Either replicate body transforms carefully, or ship/restore **snapshots** ([serialization](https://rapier.rs/docs/user_guides/javascript/serialization/)) — heavier wire and harder to debug |
| Jump | Discrete jump impulse + gravity + ground clamp — classic, well-understood | Still mostly your logic on a kinematic character ([gravity note](https://rapier.rs/docs/user_guides/javascript/character_controller/)) |
| Knockback / stun | Apply impulse to velocity; zero or damp while stunned; rewind-replay inputs | Impulse on dynamic bodies **or** bake into the movement vector you feed the character controller — still custom game rules layered on the engine |
| Cross-machine match | Use fixed-dt + careful float ops (or fixed-point) in one shared module | Must use `-deterministic` build; default npm build explicitly does **not** guarantee client↔server equality |

**Does jump/knockback reconciliation become painful without an engine?**  
**No**, for V1’s scope. Pain appears when you need stable stacking, many dynamic props, joints, or continuous collision against complex meshes. Crown Tag V1 is: walk on graybox, jump, sprint, one-hit stun + knockback. That is a **character motor + impulses**, which Rapier’s docs effectively describe as something you still largely author yourself even with the builtin controller.

Using Rapier **only** for capsule-vs-static queries would still pay Wasm cost while leaving gravity, jump, stun, and knockback as hand-written code — a poor trade for V1.

---

## Suggested V1 shape (design sketch, not an implementation)

1. **Shared module** (client + Worker/DO): capsule (or AABB) position/velocity; gravity; jump impulse; sprint speed; ground/ceiling/wall resolve against static colliders; knockback impulse; stun timer that gates input.
2. **Authority:** DO runs the sim; clients predict with the same `step`; reconcile by correcting to server state and replaying unacked inputs (fixed `dt`).
3. **Tick wake:** WebSocket-driven when clients are active; optional DO alarm to keep ticking / clean idle rooms ([Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)).
4. **Config:** expose speeds, gravity, jump, knockback, stun, hit range as tweakable numbers (per map issue #1 notes).

## When to reopen Rapier

- Dynamic arena props that players meaningfully push/stack.
- Non-trivial terrain (ramps/stairs) where autostep/slope logic from Rapier’s character controller saves real engineering time **and** you accept Wasm on DO + deterministic package discipline.
- Need for joints / ragdolls / many colliding dynamics beyond capsules.

---

## Sources (primary)

1. Cloudflare Durable Objects limits — https://developers.cloudflare.com/durable-objects/platform/limits/  
2. Cloudflare Workers limits — https://developers.cloudflare.com/workers/platform/limits/  
3. Cloudflare Workers WebAssembly — https://developers.cloudflare.com/workers/runtime-apis/webassembly/  
4. Cloudflare Wasm in JavaScript — https://developers.cloudflare.com/workers/runtime-apis/webassembly/javascript/  
5. Cloudflare Durable Objects Alarms — https://developers.cloudflare.com/durable-objects/api/alarms/  
6. Rapier JS getting started — https://rapier.rs/docs/user_guides/javascript/getting_started_js/  
7. Rapier JS character controller — https://rapier.rs/docs/user_guides/javascript/character_controller/  
8. Rapier JS serialization — https://rapier.rs/docs/user_guides/javascript/serialization/  
9. Rapier Rust determinism — https://rapier.rs/docs/user_guides/rust/determinism/  
10. `@dimforge/rapier3d` published package README (Feature selection / `-deterministic` / `-compat`) — npm package `@dimforge/rapier3d@0.19.3`  
11. Measured Wasm sizes from `npm pack` of `@dimforge/rapier3d@0.19.3` and `@dimforge/rapier3d-deterministic@0.19.3` (artifact `package/rapier_wasm3d_bg.wasm`)
