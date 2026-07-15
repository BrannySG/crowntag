import { createArenaWorld } from '../src/index.ts';

function yawToward(fx: number, fz: number, tx: number, tz: number): number {
  return Math.atan2(fx - tx, fz - tz);
}

const w = createArenaWorld();
w.addPlayer('p1', 'Hero');

{
  const p = w.getSnapshot().fighters.find((f) => f.id === 'p1')!;
  const yaw = yawToward(p.x, p.z, 0, 0);
  for (let i = 0; i < 120; i++) {
    w.send({
      type: 'setInput',
      fighterId: 'p1',
      input: { forward: 1, strafe: 0, yaw, sprint: true, jump: false, hit: false },
    });
    w.step();
    const cur = w.getSnapshot().fighters.find((f) => f.id === 'p1')!;
    if (Math.hypot(cur.x, cur.z) < 1.2) break;
  }
  for (let i = 0; i < 20; i++) {
    w.send({
      type: 'setInput',
      fighterId: 'p1',
      input: { forward: 0, strafe: 0, yaw: 0, sprint: false, jump: false, hit: false },
    });
    w.step();
  }
}

if (w.getSnapshot().crown.holderId !== 'p1') {
  console.error('FAIL: player did not Claim', w.getSnapshot().crown);
  process.exit(1);
}

w.fillBotsTowardCap(6);

function botStats() {
  const s = w.getSnapshot();
  const p = s.fighters.find((f) => f.id === 'p1')!;
  const bots = s.fighters.filter((f) => f.kind === 'bot');
  const ds = bots.map((b) => Math.hypot(b.x - p.x, b.z - p.z));
  return {
    avg: ds.reduce((a, b) => a + b, 0) / Math.max(1, ds.length),
    min: Math.min(...ds),
    walls: bots.filter((b) => Math.abs(b.x) > 22 || Math.abs(b.z) > 22).length,
    holder: s.crown.holderId,
  };
}

const t0 = botStats();
let bestMin = t0.min;
let wallHits = 0;
for (let i = 0; i < 60; i++) {
  w.send({
    type: 'setInput',
    fighterId: 'p1',
    input: { forward: 0, strafe: 0, yaw: 0, sprint: false, jump: false, hit: false },
  });
  w.step();
  const s = botStats();
  bestMin = Math.min(bestMin, s.min);
  wallHits = Math.max(wallHits, s.walls);
}

const t1 = botStats();
console.log(JSON.stringify({ t0, t1, bestMin, wallHits }, null, 2));

// Bots must close toward the player (or reach hit range) before/while engaging.
if (!(bestMin < t0.min - 3 || bestMin < 4)) {
  console.error('FAIL: bots never closed on player holder');
  process.exit(1);
}
if (wallHits > 3) {
  console.error('FAIL: bots glued to walls', wallHits);
  process.exit(1);
}
console.log('PASS');
