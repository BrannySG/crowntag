# Crown Tag

Stub monorepo scaffold for **Crown Tag** — a multiplayer arena tag game.

## Setup

```bash
pnpm install
```

## Scripts

```bash
pnpm typecheck          # typecheck all packages
pnpm dev:worker         # run Worker stub locally (wrangler)
pnpm dev:client         # run Vite client stub locally
```

## Package map (ADR 0001)

| Package | Role |
|---------|------|
| `@crowntag/content` | Tweakable game data only (no rules logic) |
| `@crowntag/protocol` | Shared wire message types (client ↔ worker seam) |
| `@crowntag/sim` | Authoritative Arena rules — headless, no DOM/CF APIs |
| `@crowntag/client` | Three.js presentation + prediction (Vite) |
| `@crowntag/worker` | Cloudflare Worker + DOs; serves client as static assets |

## Layout

```
packages/content    # @crowntag/content
packages/protocol   # @crowntag/protocol
packages/sim        # @crowntag/sim
apps/client         # Vite client stub
apps/worker         # Wrangler Worker + public assets
```

This is a scaffold only — no real game logic yet.
