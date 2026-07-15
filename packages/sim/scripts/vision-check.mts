import { createArenaWorld } from '../src/index.ts';

function yawToward(fx: number, fz: number, tx: number, tz: number): number {
  return Math.atan2(fx - tx, fz - tz);
}

function dist(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz);
}

const idle = {
  forward: 0,
  strafe: 0,
  yaw: 0,
  sprint: false,
  jump: false,
  hit: false,
} as const;

function stepIdle(w: ReturnType<typeof createArenaWorld>, playerId: string): void {
  w.send({ type: 'setInput', fighterId: playerId, input: { ...idle } });
  w.step();
}

// --- 1. Facing away / no LOS: bot must NOT hard-chase holder ---
{
  const w = createArenaWorld();
  w.addPlayer('p1', 'Hero', 4); // south spawn
  // Walk player to center and Claim.
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
    for (let i = 0; i < 10; i++) stepIdle(w, 'p1');
  }
  if (w.getSnapshot().crown.holderId !== 'p1') {
    console.error('FAIL: player did not Claim');
    process.exit(1);
  }

  w.addBot('b-away', 'Away', 0);
  // Outside vision range, facing away — roam may drift but must not sprint-close.
  w._testSetFighterPose('b-away', 22, 22, yawToward(22, 22, 0, 0) + Math.PI);
  const before = w.getSnapshot().fighters.find((f) => f.id === 'b-away')!;
  const d0 = dist(before.x, before.z, 0, 0);
  for (let i = 0; i < 12; i++) stepIdle(w, 'p1');
  const after = w.getSnapshot().fighters.find((f) => f.id === 'b-away')!;
  const d1 = dist(after.x, after.z, 0, 0);
  // Soft-center roam drifts inward; must stay outside sprint-chase behavior.
  if (d0 - d1 > 4) {
    console.error('FAIL: facing-away bot closed too much', { d0, d1 });
    process.exit(1);
  }
  console.log('OK: facing away does not hard-chase', { d0, d1 });
}

// --- 2. Face holder with clear LOS: bot closes ---
{
  const w = createArenaWorld();
  w.addPlayer('p1', 'Hero', 4);
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
    for (let i = 0; i < 10; i++) stepIdle(w, 'p1');
  }

  w.addBot('b-see', 'Seer', 0);
  // South of origin on clear axis, facing holder at center.
  w._testSetFighterPose('b-see', 0, 12, yawToward(0, 12, 0, 0));
  const before = w.getSnapshot().fighters.find((f) => f.id === 'b-see')!;
  const d0 = dist(before.x, before.z, 0, 0);
  for (let i = 0; i < 50; i++) stepIdle(w, 'p1');
  const after = w.getSnapshot().fighters.find((f) => f.id === 'b-see')!;
  const d1 = dist(after.x, after.z, 0, 0);
  if (!(d1 < d0 - 4 || d1 < 4)) {
    console.error('FAIL: facing bot did not close on holder', { d0, d1 });
    process.exit(1);
  }
  console.log('OK: facing holder closes', { d0, d1 });
}

// --- 3. Unheld crown: facing away no beeline; face spawn then sprint-approach ---
{
  const w = createArenaWorld();
  w.addPlayer('p1', 'Hero', 4);
  // Park player far away so they do not Claim.
  w._testSetFighterPose('p1', 20, 20, 0);

  w.addBot('b-crown', 'CrownBot', 0);
  // Outside vision range, facing away — must not sprint-beeline to spawn.
  w._testSetFighterPose('b-crown', 22, 22, yawToward(22, 22, 0, 0) + Math.PI);
  const before = w.getSnapshot().fighters.find((f) => f.id === 'b-crown')!;
  const d0 = dist(before.x, before.z, 0, 0);
  for (let i = 0; i < 12; i++) stepIdle(w, 'p1');
  const mid = w.getSnapshot().fighters.find((f) => f.id === 'b-crown')!;
  const d1 = dist(mid.x, mid.z, 0, 0);
  if (d0 - d1 > 4) {
    console.error('FAIL: unheld facing-away bot beelined to spawn', { d0, d1 });
    process.exit(1);
  }
  console.log('OK: unheld facing away no sprint beeline', { d0, d1 });

  // Clear LOS on south axis, face spawn — should sprint-claim or close fast.
  w._testSetFighterPose('b-crown', 0, 14, yawToward(0, 14, 0, 0));
  const faceBefore = w.getSnapshot().fighters.find((f) => f.id === 'b-crown')!;
  const d2 = dist(faceBefore.x, faceBefore.z, 0, 0);
  for (let i = 0; i < 50; i++) stepIdle(w, 'p1');
  const faceAfter = w.getSnapshot().fighters.find((f) => f.id === 'b-crown')!;
  const d3 = dist(faceAfter.x, faceAfter.z, 0, 0);
  const claimed = w.getSnapshot().crown.holderId === 'b-crown';
  if (!(claimed || d3 < d2 - 5 || d3 < 3)) {
    console.error('FAIL: facing spawn did not approach/Claim', {
      d2,
      d3,
      holder: w.getSnapshot().crown.holderId,
    });
    process.exit(1);
  }
  console.log('OK: face spawn approaches or Claims', { d2, d3, claimed });
}

console.log('PASS');
