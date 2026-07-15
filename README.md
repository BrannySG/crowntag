# Crown Tag

Offline-playable graybox **Arena** for Crown Tag — Claim / Steal / Stun / Score in a 48×48 m layout. Packages follow ADR 0001; netcode / Durable Objects come later.

## Setup

```bash
pnpm install
```

## Run (offline arena)

```bash
pnpm dev:client
```

Opens the Vite client at http://localhost:5173. Click the canvas to capture the mouse.

### Controls

| Input | Action |
|-------|--------|
| Mouse | Look (camera-relative) |
| WASD | Move |
| Shift | Sprint |
| Space | Jump |
| Click | Hit (steal crown / stun + knockback) |
| R | Reset arena |

### Typecheck

```bash
pnpm typecheck
```

## Package map (ADR 0001)

| Package | Role |
|---------|------|
| `@crowntag/content` | Tweakable game data only (no rules logic) |
| `@crowntag/protocol` | Shared command / event / snapshot types |
| `@crowntag/sim` | Authoritative Arena rules — headless, no DOM/CF APIs |
| `@crowntag/client` | Three.js presentation (Vite) |
| `@crowntag/worker` | Cloudflare Worker stub; will host DOs later |

## Layout

```
packages/content    # @crowntag/content — tunables + arena layout
packages/protocol   # @crowntag/protocol — SimCommand / SimEvent / snapshots
packages/sim        # @crowntag/sim — World + fixed-timestep step
apps/client         # Three.js graybox client
apps/worker         # Wrangler Worker + public assets (stub)
```

## Architecture notes

- **Content** holds ADR 0005 movement/hit baselines and ADR 0003 layout (spawns, obstacles, claim radius).
- **Sim** `World` is authoritative: movement, hit cone, Claim, Steal, Stun, Knockback, hold-time Score. Deterministic fixed `dt` (`1/60`); no `Math.random`.
- **Client** gathers input, steps the sim on a fixed accumulator, and renders graybox meshes from content + snapshots. It does not mutate authoritative state except via `SimCommand`s.
