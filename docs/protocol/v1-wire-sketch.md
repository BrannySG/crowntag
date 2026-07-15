# V1 wire protocol (normative sketch)

Companion to [ADR 0002](../adr/0002-v1-netcode-wire-protocol.md). Shapes will become `@crowntag/protocol` types; names match `CONTEXT.md`.

## Join

1. `POST /join` `{ displayName }` → Matchmaker → `{ arenaId, wsUrl }`
2. Client opens WebSocket to Arena DO
3. Server `welcome` `{ fighterId, arenaId, tick, contentRevision }`

## Tick

- Authoritative sim: **20 Hz** fixed step in Arena DO
- Cap: content `Cap` (default 12), humans + bots

## Client → server

| Message | Fields | Notes |
|---------|--------|--------|
| `input` | `seq`, `moveX`, `moveZ`, `jump`, `sprint`, `hit` | `seq` monotonic per Fighter; axes normalized; booleans for jump/sprint/hit edge or held as defined by sim |

Send often (render loop OK); server consumes the latest input for each tick per Fighter. Ignore inputs for Fighters that are Stunned where sim says so.

## Server → client

| Message | Fields | Notes |
|---------|--------|--------|
| `welcome` | `fighterId`, `arenaId`, `tick`, `contentRevision` | Once per connection |
| `snapshot` | `tick`, `crown`, `fighters[]`, `scores[]` | Every tick; full state |
| `event` | `tick`, `kind`, payload | Reliable; kinds below |

### Snapshot fighter (sketch)

`id`, `kind` (`player`\|`bot`), `displayName`, `x`, `y`, `z`, `vx`, `vy`, `vz`, `yaw`, `grounded`, `stunUntilTick`, `isHolder`

### Crown

`state: held | at_spawn`, `holderId?`, `x,y,z` when at spawn

### Event kinds

- `join` / `leave` — Fighter entered/left
- `claim` — Claim of unheld Crown
- `hit` — Hit landed (`hitterId`, `targetId`)
- `steal` — Crown transferred
- `stun` — Stun+Knockback applied (`targetId`, impulse / `stunUntilTick`)

## Prediction / reconcile

1. Client predicts **own** movement (and local Claim) with `@crowntag/sim` + pending `input`s.
2. Remote Fighters: interpolate/extrapolate from snapshots (no full remote prediction required in V1).
3. On `snapshot` / `stun` / `steal`: if local Fighter diverges, **rewind** to last matching tick and **replay** buffered inputs.
4. Hit VFX may fire on local click; Steal/Stun/Knockback **outcomes** wait for server `event` (or snapshot) before becoming authoritative.
