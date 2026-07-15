# Crown Tag

Real-time multiplayer web arena: Claim / Steal / Stun / Score across a graybox Arena.
Packages follow ADR 0001; hosted play uses a Cloudflare Worker + Arena Durable Object (ADR 0002).

## Setup

```bash
pnpm install
```

## Run hosted arena (two local clients)

Build the client, then start Wrangler (serves the client + `/join` + Arena WebSocket):

```bash
pnpm --filter @crowntag/client build
pnpm dev:worker
```

Open **two browser tabs** to http://localhost:8787 — enter different Display Names and Join.
You should see each other move and be able to Steal the Crown.

### Verify parallel Arenas (Matchmaker)

Cap defaults to **12** (`CAP` in `packages/content`). To see two Joins land in different Arenas without twelve clients:

1. Temporarily set `CAP = 1` in `packages/content/src/index.ts`.
2. Restart `pnpm dev:worker`.
3. Join from two tabs (or `curl` twice — see below). The first Join should get `arena-1`, the second `arena-2`.
4. Revert `CAP` to `12` when done.

Without changing Cap, you can still inspect routing:

```bash
curl -s -X POST http://127.0.0.1:8787/join -H "content-type: application/json" -d "{\"displayName\":\"A\"}"
curl -s -X POST http://127.0.0.1:8787/join -H "content-type: application/json" -d "{\"displayName\":\"B\"}"
```

With Cap 12 and empty rooms, both responses share `arena-1` (fullest non-full). With Cap 1 after the first Join has reserved a slot, the second response should show a different `arenaId`.

### Optional: Vite + Wrangler (HMR)

Terminal 1:

```bash
pnpm --filter @crowntag/client build
pnpm dev:worker
```

Terminal 2 (proxies `/join` and `/arena` to Wrangler):

```bash
pnpm dev:client
```

Then open two tabs to http://localhost:5173.

### Offline solo (no Worker)

```bash
pnpm dev:client
```

Open http://localhost:5173/?offline=1 — or use “Play offline instead” on the join screen.

### Controls

| Input | Action |
|-------|--------|
| Mouse | Look (camera-relative) |
| WASD | Move |
| Shift | Sprint |
| Space | Jump |
| Click | Hit (steal crown / stun + knockback) |
| R | Reset arena (**offline only**) |

### Typecheck

```bash
pnpm typecheck
```

## Package map (ADR 0001)

| Package | Role |
|---------|------|
| `@crowntag/content` | Tweakable game data only (no rules logic) |
| `@crowntag/protocol` | Shared sim + wire message types |
| `@crowntag/sim` | Authoritative Arena rules — headless, no DOM/CF APIs |
| `@crowntag/client` | Three.js presentation + prediction |
| `@crowntag/worker` | Worker, Matchmaker DO, Arena DO, static client assets |

## Layout

```
packages/content    # @crowntag/content — tunables + arena layout
packages/protocol   # @crowntag/protocol — sim + wire types
packages/sim        # @crowntag/sim — World + fixed-timestep step (20 Hz)
apps/client         # Three.js client (join UI + prediction)
apps/worker         # Wrangler Worker + Arena / Matchmaker DOs
```

## Architecture notes

- **Join:** `POST /join` `{ displayName }` → Matchmaker singleton (`getByName("global")`) returns `{ arenaId, wsUrl }` for the fullest non-full Arena, or creates `arena-N`. Cap (default 12 from `@crowntag/content`) is enforced on Matchmaker and again on Arena accept.
- **Arena DO:** Hibernation WebSocket API; authoritative `@crowntag/sim` ticks at **20 Hz** while players are connected; Disconnect returns Crown to Crown Spawn if that Fighter was Holder; occupancy is reported back to Matchmaker.
- **Client:** predicts own movement; reconciles Steal / Stun / Knockback from server snapshots and events.
- **Content** holds ADR 0005 movement/hit baselines and ADR 0003 layout.
- **Offline** (`?offline=1`) still runs a local World with dummies — no Worker required.
