# THROWWAY — Movement + Hit Feel Prototype

> **THROWWAY.** Not production. Not the real monorepo packages.
> Answers: *Does movement + jump + sprint + click-to-hit feel right (range, stun, knockback) before we lock numeric tuning into the V1 playable-scope spec?*
> Tied to GitHub issue **#10**. Lives on branch `prototypes/movement-hit-feel` only — do not merge to main.

## Run (one command)

```bash
pnpm --dir prototypes/movement-hit-feel install && pnpm --dir prototypes/movement-hit-feel dev
```

Opens Vite at http://localhost:5179

## Controls

| Key | Action |
|-----|--------|
| WASD | Move |
| Shift | Sprint |
| Space | Jump |
| Click | Hit (forward cone / range) |
| R | Reset arena state |

## What to judge

1. Move / sprint / jump pacing on a ~48×48 graybox floor
2. Hit range — can you clip dummies cleanly without feeling sticky or floaty
3. Stun + knockback on non-holders
4. Crown steal visual when you Hit the current holder

Live sliders (top-right) and labeled defaults at the top of `src/main.js` are the tuning surface.

## Stack

Self-contained: Vite + Three.js only. No Cloudflare, no netcode, no tests.
