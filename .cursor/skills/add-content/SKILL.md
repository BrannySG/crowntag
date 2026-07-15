---
name: add-content
description: Checklists for adding or tuning game content — units, enemies, recipes, perks, levels, waves, economy values. Use whenever a task adds new content, tunes summon odds, drop values, spawn pacing, or asks "add a new unit/enemy/perk/level". Ensures every cross-referenced file is touched together.
---

# Add Content

All authored content lives in `packages/content/src` (data-driven TypeScript).
Content changes should not touch sim logic in `packages/sim` — if a tweak seems
to need a sim change, first ask whether it belongs in content instead (and see
the `extend-protocol` skill if it genuinely doesn't).

## Golden rules

1. **Definitions are plain typed objects** in keyed records (`UNITS`, `ENEMIES`)
   or arrays (`LEVELS`, `PERKS`). Follow the existing pattern per file.
2. **Vocabulary is canonical** — use `CONTEXT.md` terms (Unit, Set, Rarity,
   Corrupted, Run Currency...). A character is *either* a summonable Unit *or*
   a Corrupted enemy, never both.
3. **Art goes through the Sprite Pipeline** — read
   `.cursor/rules/sprite-generation.mdc` before generating any texture.
4. **Close-out:** `pnpm typecheck` + `pnpm test` green (the sim's
   `balance.test.ts` and `world.test.ts` exercise content), bump `GAME_VERSION`
   PATCH in `apps/client/src/version.ts`.

## Checklists by content type

### New Unit (summonable)

- [ ] `units.ts` — add to `UNITS`: id, name, `rarity`, `set` (one of the five
  Sets), `attack` (kind: projectile/burst/chain/aura/beam), `color`, `shape`
- [ ] `recipes.ts` — wire it into a Merge chain (what merges *into* it, what it
  merges *into*); Summon only rolls up to legendary, so mythic+ Units are
  reachable **only** via Recipes
- [ ] Portrait: `apps/client/src/assets/chars/char_<id>.png` + register in
  `apps/client/src/ui/portraits.ts` (`UNIT_PORTRAITS`)
- [ ] Field sprite (optional): `apps/client/src/assets/field/actor_<id>.png` +
  `apps/client/src/game/fieldTextures.ts`; without one the canvas draws the
  procedural `color`/`shape` placeholder

### New enemy (Corrupted)

- [ ] `enemies.ts` — add to `ENEMIES`: baseHp, baseSpeed, contactDamage, radius,
  xp, currency range, `kind` (grunt/swift/brute/elite/boss)
- [ ] Spawn it: weights in `waves.ts` `SPAWN_PHASES`, or as `eliteEnemyId` /
  boss chain entry in `levels.ts`
- [ ] Portrait + field sprite as above

### New Perk

- [ ] `perks.ts` — id, name, description, effect kind, icon, `bumps` Record for
  common/rare/epic/legendary/mythic
- [ ] No `upgradesFrom` / `maxStacks` / baked rarity on the def — rarity is rolled
  per Offer card to pick the bump magnitude
- [ ] Effect kind must map to what the sim already applies (perk-effect switch in
  `packages/sim/src/world.ts`); a genuinely new kind → sim change /
  `extend-protocol` skill
- [ ] Icon: `apps/client/src/assets/icons/perk-*.svg` if it needs a new one
- [ ] Remember `MAX_PERK_SLOTS` = 5 hard ceiling; default Run starts at 2 unique Perk
  lines, more via meta `perkSlots` Upgrade (further level-ups
  only upgrade owned lines)

### New Artifact

- [ ] `artifacts.ts` — id, name, description, rarity, icon,
  `CombatEffectDef`
- [ ] Statuses if needed in `STATUSES`
- [ ] New Combat Effect kind → `extend-protocol` / world combat dispatch
- [ ] Icon: `apps/client/src/assets/icons/` if it needs a new one
- [ ] No unique-slot limit; rarity is roll weight (and presentation) only

### New Level / Difficulty

- [ ] `levels.ts` — `LEVELS` entry: order, `backgroundKey`, spawn phases, elite
  times, boss chain (difficulty N = first N bosses of the chain)
- [ ] Background texture keyed by `backgroundKey` in
  `apps/client/src/assets/field/` + `fieldTextures.ts`
- [ ] Unlock flow is derived (clear level N-1 → level N; clear tier D → D+1) —
  no extra wiring

### Tuning only

- Summon odds / luck / trash refunds / magnet: `economy.ts`
- Spawn pacing / elite & boss timing: `waves.ts`
- Meta shop (shard payout, upgrade tracks): `meta.ts`
- Hero stats: `hero.ts`

## Verify

```bash
pnpm typecheck && pnpm test
```

`balance.test.ts` asserts pacing/economy invariants and will name what broke.
Then bump `GAME_VERSION` PATCH. For a visual check, use the `playtest` skill —
`window.__dev.summon(n)` and `__dev.grantCurrency(n)` get new Units on screen
without grinding.
