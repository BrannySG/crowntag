# Research: Cloudflare parallel arena rooms + matchmaking

**Ticket:** [#4](https://github.com/BrannySG/crowntag/issues/4)  
**Question:** How should Crown Tag V1 implement many parallel arenas (default cap 12 players, tweakable) on Cloudflare Workers/Pages + Durable Objects with WebSockets? Compare raw Durable Objects vs PartyServer, covering room lifecycle, hibernation, authoritative tick loop, and auto-matchmaking into the fullest non-full arena (or create a new one).

**Date:** 2026-07-15  
**Sources:** Cloudflare first-party docs and Cloudflare-owned PartyServer / Agents docs only (cited inline).

---

## Recommendation (V1)

Use a **single Workers project with static assets** (not Pages Functions + a separate DO Worker), two Durable Object classes — **`Matchmaker`** (singleton) and **`Arena`** (one instance per live arena) — and the **Hibernation WebSocket API** on arenas. Prefer **raw Durable Objects** for V1; treat PartyServer as an optional DX layer, not the architecture.

**Matchmaking:** Client `POST /join` (or equivalent) → Worker stubs the Matchmaker via `getByName("global")` → Matchmaker picks the fullest non-full arena or creates a new named arena → response returns `arenaId` + WebSocket path → client upgrades to that Arena DO. Player-cap and max-arena-count stay in config.

**Tick:** While an arena has players (or bots) and a match is live, keep an in-memory tick loop (`setTimeout` / `setInterval` or a self-rescheduling `setAlarm`). Expect continuous duration billing during active play — hibernation only helps empty/idle rooms. Persist authoritative state to DO storage across wake/eviction; put per-connection metadata on WebSocket attachments.

---

## 1. Platform fit: Workers + assets vs Pages

| Approach | Durable Objects | Notes |
| --- | --- | --- |
| **Workers + [static assets](https://developers.cloudflare.com/workers/static-assets/)** | Native in the same Worker | One deploy unit: client assets + API + DO classes. |
| **Pages + Functions** | DO must live in a **separate Worker**, bound into Pages | Docs: “You cannot create and deploy a Durable Object within a Pages project.” ([Pages bindings](https://developers.cloudflare.com/pages/functions/bindings/#durable-objects)) |

Cloudflare’s Pages→Workers migration guide also notes DO + Pages needs a separate Worker and that **Workers is simpler and recommended** for Durable Objects ([migrate from Pages](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/), footnote on DO).

**V1 implication:** Ship Crown Tag as **Workers + assets** (Wrangler `assets` / Vite plugin). Keep “Pages” in product language only if the public URL is already a Pages project — still bind DOs from a Worker, or migrate hosting to Workers.

---

## 2. Durable Objects as arena “atoms”

Cloudflare’s guidance: **one Durable Object per logical unit** (chat room, game session, user) — not a global singleton that becomes a bottleneck ([Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/), changelog framing of the same rule).

Relevant properties:

- Globally addressable by name (`idFromName` / [`getByName`](https://developers.cloudflare.com/changelog/post/2025-08-21-durable-objects-get-by-name/)); name available inside the object as `ctx.id.name` when addressed that way ([changelog](https://developers.cloudflare.com/changelog/post/2026-03-15-durable-object-id-name/)).
- Single-threaded coordination point — suitable for one authoritative arena sim ([What are Durable Objects?](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/)).
- Soft ~**1,000 requests/sec** per object; unlimited object count in a namespace ([limits FAQ](https://developers.cloudflare.com/durable-objects/platform/limits/#how-much-work-can-a-single-durable-object-do)).
- Docs explicitly call out **multiplayer games** as a WebSocket + DO use case ([What are Durable Objects?](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/), WebSockets section).
- “Thousands of clients per instance” is the documented WebSocket capacity framing ([Use WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)) — far above a 12-player arena cap.

**V1 mapping:**

| Class | Addressing | Role |
| --- | --- | --- |
| `Matchmaker` | `env.MATCHMAKER.getByName("global")` | Occupancy index, join/leave bookkeeping, create arena names |
| `Arena` | `env.ARENA.getByName(arenaId)` | Authoritative sim, player WebSockets, tick, bots |

Do **not** put all arenas in one DO. Do **not** put matchmaking state only in Worker memory (Workers are ephemeral and multi-isolate).

---

## 3. WebSockets and hibernation

### Two APIs

1. **Hibernation WebSocket API** (recommended) — `ctx.acceptWebSocket(server)`; handlers `webSocketMessage` / `webSocketClose` / `webSocketError`.
2. **Web Standard WebSocket API** — `ws.accept()` + `addEventListener`.

Sources: [Use WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [State API](https://developers.cloudflare.com/durable-objects/api/state/).

### Hibernation behavior

When no events (alarms, messages, etc.) for a short period, the DO can be evicted from memory while **clients stay connected to Cloudflare’s network**. In-memory state is **reset**; constructor runs again on wake ([hibernation how-it-works](https://developers.cloudflare.com/durable-objects/best-practices/websockets/#how-hibernation-works), [lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)).

Restore paths:

- DO **storage** for authoritative arena state.
- `serializeAttachment` / `deserializeAttachment` + `ctx.getWebSockets()` for per-connection metadata ([extended methods](https://developers.cloudflare.com/durable-objects/best-practices/websockets/#extended-methods)).
- `setWebSocketAutoResponse` for ping/pong **without waking** the DO ([State API](https://developers.cloudflare.com/durable-objects/api/state/#setwebsocketautoresponse)).

Hibernation is only for **server-side** accepted sockets; outbound sockets do not hibernate and can keep the DO alive ([Use WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)).

### What blocks hibernation

From the [lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/) doc, hibernation requires (among other things):

- No `setTimeout` / `setInterval` callbacks.
- No Web Standard WebSocket API (`accept()` path).
- No in-flight request/event processing, awaited `fetch`, outbound TCP/WebSocket, etc.

After ~10s idle with those conditions, the object hibernates. **Alarms, incoming requests, and scheduled callbacks prevent hibernation** ([Use WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)).

### Billing

- Hibernation: no billable duration while sleeping; clients can remain connected ([pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [Use WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)).
- Standard `accept()`: duration for the **entire** WebSocket lifetime ([pricing footnotes](https://developers.cloudflare.com/durable-objects/platform/pricing/)).
- Duration also accrues while idle-in-memory but **not hibernation-eligible** (e.g. tick timers still scheduled) ([pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)).

**V1 implication:** Always use **`acceptWebSocket`**. Active arenas with a tick loop **will not hibernate** and **will** incur duration — expected for a live authoritative game. Empty arenas should cancel timers/alarms so they can hibernate.

For high-frequency outbound state, Cloudflare recommends **batching** game updates (e.g. every 50–100ms) rather than one WebSocket frame per tiny delta ([Use WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)).

---

## 4. Authoritative tick loop

### Alarms API (facts)

- Each DO has **one** alarm at a time via `storage.setAlarm(timestamp)` ([Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)).
- Alarms do **not** auto-repeat; the handler must call `setAlarm` again ([Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)).
- At-least-once execution; retries with backoff if `alarm()` throws ([Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)).
- Alarm handler wall time max **15 minutes** ([limits](https://developers.cloudflare.com/durable-objects/platform/limits/)).
- Alarms wake the DO and prevent hibernation while scheduled/firing ([Use WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)).
- Guidance: **only schedule alarms when there is work**; avoid waking every object on short intervals for idle work ([Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)).

### Patterns for Crown Tag

| Pattern | Pros | Cons |
| --- | --- | --- |
| **A. In-memory `setTimeout`/`setInterval` while occupied** | Simple fixed Hz tick; natural for 20–60 Hz sim | Blocks hibernation; duration billed whole match |
| **B. Self-rescheduling `setAlarm` each tick** | Survives eviction mid-match better if you also persist state | Alarm jitter / overhead; CF discourages very short idle wakes; one alarm slot |
| **C. Hybrid** | Tick in-memory while players > 0; alarm for empty-room TTL / match end | Slightly more state machine |

**V1 recommendation: Pattern C.**

1. On first player (or when match becomes active): start in-memory tick at config Hz; process inputs; broadcast batched snapshots.
2. Persist enough state (scores, crown holder, bot seeds, etc.) so a crash/eviction can resume or soft-reset.
3. When player count hits 0 (and bots despawned or paused per product rules): clear timers, optionally `deleteAlarm`, allow hibernation; Matchmaker marks arena empty/reclaimable.
4. Use **alarms** for coarse events (empty-arena reclaim, max match length), not as the sole 50ms clock unless prototyping proves alarms are stable enough.

CPU: each HTTP/WebSocket message/alarm invocation gets a CPU budget (default 30s active CPU, configurable) ([limits](https://developers.cloudflare.com/durable-objects/platform/limits/)). A 12-player arena at modest tick rates is well within soft RPS limits.

---

## 5. Room lifecycle (concrete)

```text
Client                Worker                 Matchmaker DO              Arena DO
  |                     |                         |                        |
  |-- POST /join ------>|                         |                        |
  |                     |-- join(playerMeta) ----->|                        |
  |                     |                         |-- pick/create arena -->|
  |                     |                         |-- (optional) notify -->|
  |                     |<-- { arenaId, wsUrl } ---|                        |
  |<-- { arenaId... } --|                         |                        |
  |                                                                        |
  |-- WS /arena/:id ------------------------------------------------------>|
  |                     (Worker proxies upgrade to Arena stub)             |
  |                                                                        |
  |                     Arena: acceptWebSocket, register player,           |
  |                     start tick if needed, fill bots toward cap         |
  |                                                                        |
  |-- inputs / snapshots ... --------------------------------------------->|
  |                                                                        |
  |-- disconnect --------------------------------------------------------->|
  |                     Arena: crown→spawn, update roster, maybe stop tick |
  |                     RPC Matchmaker.reportOccupancy(arenaId, n)         |
```

**Arena states (suggested):** `empty` → `open` (accepting, < cap) → `full` → (optional) `closing` → reclaim / hibernate.

**Config knobs (tweakable):** `PLAYERS_PER_ARENA` (default 12), `MAX_ARENAS` (optional global ceiling), tick Hz, bot fill rules.

**Creating arenas:** Prefer deterministic names (`arena-${n}` or UUID stored in Matchmaker list) via `getByName`, so reconnect and Matchmaker lookups share the same id ([getByName](https://developers.cloudflare.com/durable-objects/api/namespace/#getbyname)).

**Capacity check:** Enforce join in **both** Matchmaker (routing) and Arena (authoritative accept). Race: two joins can target the same “fullest” slot — Arena must reject overflow and Matchmaker must refresh occupancy (RPC from Arena on connect/disconnect).

---

## 6. Auto-matchmaking algorithm

Desired product behavior ([issue #4](https://github.com/BrannySG/crowntag/issues/4) / map [#1](https://github.com/BrannySG/crowntag/issues/1)): name-then-go; join the **fullest non-full** arena; else create a new one.

**Matchmaker storage sketch:**

```text
arenas: [{ id, playerCount, updatedAt }, ...]  // or SQLite table
config: { playersPerArena, maxArenas }
```

**Join pseudocode:**

```text
open = arenas where playerCount < playersPerArena
if open empty:
  if maxArenas reached: reject or wait queue
  else create new arena id, playerCount=0, append
else:
  pick open with max(playerCount)  // fullest non-full; tie-break: oldest or lowest id
optimistic playerCount++
return arenaId
```

Arena confirms on WebSocket accept (or rolls back via Matchmaker if rejected). Disconnect decrements and may delete empty arena records after TTL.

This pattern needs **no third-party matchmaking service** — one singleton DO is enough at V1 scale (single-threaded; soft 1k RPS).

---

## 7. Raw Durable Objects vs PartyServer

### PartyServer (first-party / Cloudflare-owned)

- Package: [`partyserver`](https://github.com/cloudflare/partykit/tree/main/packages/partyserver) — “Build real-time applications powered by Durable Objects, inspired by PartyKit” ([README](https://raw.githubusercontent.com/cloudflare/partykit/main/packages/partyserver/README.md)).
- `Server` extends `DurableObject`; Cloudflare Agents docs describe the stack as **DurableObject → Server (partyserver) → Agent** ([Agent class internals](https://developers.cloudflare.com/agents/runtime/lifecycle/agent-class/)).
- Features: room-style routing (`routePartykitRequest`, `getServerByName`), lifecycle hooks (`onStart`, `onConnect`, `onMessage`, `onClose`, `onAlarm`), `broadcast`, hibernation via `static options = { hibernate: true }` ([README](https://raw.githubusercontent.com/cloudflare/partykit/main/packages/partyserver/README.md)).
- Still requires manual Wrangler DO bindings/migrations ([README](https://raw.githubusercontent.com/cloudflare/partykit/main/packages/partyserver/README.md)).
- Does **not** implement fullest-room matchmaking; you still own a lobby/index.

### Comparison for Crown Tag V1

| Concern | Raw DO | PartyServer |
| --- | --- | --- |
| WS hibernation | First-class `acceptWebSocket` | Unified API + `hibernate: true` |
| Tick / alarms | Direct `alarm()` + timers | Use `onAlarm()`; do not override `alarm` / WS handlers ([README](https://raw.githubusercontent.com/cloudflare/partykit/main/packages/partyserver/README.md)) |
| Matchmaking | Custom Matchmaker DO | Same — not provided |
| Room URL routing | Hand-rolled `/arena/:id` | `parties/:server/:name` helpers |
| Authoritative game sim | Full control | Same DO underneath; extra abstraction |
| Dependency / learning | Platform docs only | Extra package + hook conventions |
| Agents / future AI | N/A | Same lineage as Cloudflare Agents |

### Verdict

**Use raw Durable Objects for V1.** Crown Tag’s hard problems are matchmaking occupancy, authoritative tick, and netcode — not chat-style broadcast helpers. PartyServer does not remove the Matchmaker DO and adds a layer you must not fight when customizing `fetch` / hibernation / alarms. Revisit PartyServer later if room routing DX becomes the bottleneck.

---

## 8. Limits and scale check (V1)

| Limit | Value | V1 relevance |
| --- | --- | --- |
| Objects per namespace | Unlimited | Many parallel arenas OK ([limits](https://developers.cloudflare.com/durable-objects/platform/limits/)) |
| Soft RPS per object | ~1,000/s | 12 players + tick + bots fine ([limits FAQ](https://developers.cloudflare.com/durable-objects/platform/limits/#how-much-work-can-a-single-durable-object-do)) |
| WS message size | 32 MiB received | Irrelevant for game packets ([limits](https://developers.cloudflare.com/durable-objects/platform/limits/)) |
| Alarm wall time | 15 min | Irrelevant if ticks are short invocations ([limits](https://developers.cloudflare.com/durable-objects/platform/limits/)) |
| DO classes per account | 500 Paid / 100 Free | Two classes (`Matchmaker`, `Arena`) fine ([limits](https://developers.cloudflare.com/durable-objects/platform/limits/)) |

---

## 9. Concrete V1 pattern (spec-ready)

1. **Hosting:** One Worker with static assets + DO bindings; SQLite-backed DO classes via Wrangler migrations ([PartyServer/Agents examples use `new_sqlite_classes`](https://raw.githubusercontent.com/cloudflare/partykit/main/packages/partyserver/README.md); Cloudflare recommends SQLite-backed DOs generally).
2. **Classes:** `Matchmaker` (name `"global"`) + `Arena` (name = arena id).
3. **Join:** HTTP to Matchmaker → fullest non-full or create → return arena id.
4. **Play:** Worker upgrades WebSocket to `Arena` stub; Hibernation API; tags/attachments for player id.
5. **Sim:** Server-authoritative tick in-memory while occupied; batch outbound state ~50–100ms; persist key state; cancel tick when empty.
6. **Bots:** Spawn/despawn inside Arena toward `PLAYERS_PER_ARENA`; report occupancy to Matchmaker as humans+bots or humans-only — product choice, but Matchmaker “fullest” must use the same definition of “full”.
7. **Config:** `PLAYERS_PER_ARENA = 12` (default), optional `MAX_ARENAS`, tick rate, reclaim TTL — all env/vars, not hardcoded.
8. **Skip for V1:** PartyServer, Pages-native DO deploy, arena browser/private codes (already out of scope on map issue #1).

---

## Key citations

| Topic | URL |
| --- | --- |
| WebSockets + hibernation | https://developers.cloudflare.com/durable-objects/best-practices/websockets/ |
| DO lifecycle / hibernate conditions | https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/ |
| Alarms | https://developers.cloudflare.com/durable-objects/api/alarms/ |
| Rules of Durable Objects | https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/ |
| DO limits | https://developers.cloudflare.com/durable-objects/platform/limits/ |
| DO pricing / duration | https://developers.cloudflare.com/durable-objects/platform/pricing/ |
| What are Durable Objects? | https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/ |
| getByName | https://developers.cloudflare.com/durable-objects/api/namespace/#getbyname |
| Workers static assets | https://developers.cloudflare.com/workers/static-assets/ |
| Pages + DO binding caveat | https://developers.cloudflare.com/pages/functions/bindings/#durable-objects |
| PartyServer README | https://github.com/cloudflare/partykit/blob/main/packages/partyserver/README.md |
| Agents / Server layering | https://developers.cloudflare.com/agents/runtime/lifecycle/agent-class/ |
