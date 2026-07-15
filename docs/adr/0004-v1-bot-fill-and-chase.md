# V1 bot fill, despawn, and chase

V1 Bots live in `@crowntag/sim` and count toward **Cap**. While an Arena has ≥1 human Player, the server **fills to Cap** with Bots; when a Player Joins and the Arena is full, **despawn a Bot** (prefer non-Holder, then lowest Score) to free the slot. When the last Player Disconnects, despawn remaining Bots and allow the Arena DO to idle/hibernate.

Bot chase is **imperfect knowledge** (private sim-only sense; humans keep an omniscient HUD). Bots hard-chase the Crown/Holder only after **seeing** it (range + FOV + LOS vs obstacles) or briefly after **hearing** a nearby Claim/Steal. Unseen: they **roam** spawn/cover waypoints with a soft center bias toward Crown Spawn. After losing sight they **investigate** the last known position until memory expires, then resume roam. When holding, they **flee** only fighters within a short awareness range (not map-wide). No pack-follow; no `Math.random` (deterministic from fighter id / fixed tables). Tunables live in `@crowntag/content` `BOT_VISION`.

Display Names come from a curated `@crowntag/content` name list (human-like, no `Bot###`); Bots appear on the **Leaderboard**. Near-human jukes/prediction stay out of scope.
