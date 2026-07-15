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

Open http://localhost:8787 — enter a Display Name and Join.
With ≥1 human, **Bots fill toward Cap** (default 12), chase/Claim/flee, and appear on the on-screen **Leaderboard**. Open a second tab to Join as another Player (a Bot is despawned if the Arena is full).

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
| `@crowntag/worker` | Worker, Matchmaker stub, Arena DO, static client assets |

## Layout

```
packages/content    # @crowntag/content — tunables + arena layout
packages/protocol   # @crowntag/protocol — sim + wire types
packages/sim        # @crowntag/sim — World + fixed-timestep step (20 Hz)
apps/client         # Three.js client (join UI + prediction)
apps/worker         # Wrangler Worker + Arena / Matchmaker DOs
```

## Architecture notes

- **Join:** `POST /join` `{ displayName }` → Matchmaker stub always returns `arena-1` + `wsUrl` (full multi-arena Matchmaker is #17).
- **Arena DO:** Hibernation WebSocket API; authoritative `@crowntag/sim` ticks at **20 Hz** while players are connected; Disconnect returns Crown to Crown Spawn if that Fighter was Holder.
- **Bots (ADR 0004):** While ≥1 human is present, sim fills Fighters toward Cap with curated Display Names; Join into a full Arena despawns a Bot (prefer non-Holder, then lowest Score). Bots Claim free Crown, chase the Holder and Hit in range, or flee when holding. Last human Disconnect despawns Bots and allows the Arena to idle.
- **Leaderboard:** Client HUD ranks Fighters (including Bots) by hold-time Score.
- **Client:** predicts own movement; reconciles Steal / Stun / Knockback from server snapshots and events.
- **Content** holds Cap, bot name list, ADR 0005 movement/hit baselines, and ADR 0003 layout.
- **Offline** (`?offline=1`) still runs a local World with dummies — no Worker required.
