import { GRACE_DURATION, HIT } from '@crowntag/content';
import { createArenaWorld, FIXED_DT } from '../src/index.ts';

function yawToward(fx: number, fz: number, tx: number, tz: number): number {
  return Math.atan2(fx - tx, fz - tz);
}

const idle = {
  forward: 0,
  strafe: 0,
  yaw: 0,
  sprint: false,
  jump: false,
  hit: false,
} as const;

const w = createArenaWorld();
w.addPlayer('holder', 'Holder', 0);
w.addPlayer('chaser', 'Chaser', 1);

// Place holder on Crown Spawn and chaser within Hit range, facing them.
{
  const snap = w.getSnapshot();
  const holder = snap.fighters.find((f) => f.id === 'holder')!;
  const chaser = snap.fighters.find((f) => f.id === 'chaser')!;
  const hx = 0;
  const hz = 0;
  const cx = 1.2;
  const cz = 0;
  w.applySnapshot({
    ...snap,
    crown: { holderId: null, x: 0, y: 0.35, z: 0 },
    fighters: [
      { ...holder, x: hx, y: 0, z: hz, yaw: 0, vx: 0, vy: 0, vz: 0, onGround: true },
      {
        ...chaser,
        x: cx,
        y: 0,
        z: cz,
        yaw: yawToward(cx, cz, hx, hz),
        vx: 0,
        vy: 0,
        vz: 0,
        onGround: true,
        hitCooldownRemaining: 0,
      },
    ],
  });
}

// One step: Claim should fire; Hit is not pressed yet.
{
  w.send({ type: 'setInput', fighterId: 'holder', input: { ...idle } });
  w.send({ type: 'setInput', fighterId: 'chaser', input: { ...idle } });
  const events = w.step();
  if (!events.some((e) => e.type === 'claimed' && e.fighterId === 'holder')) {
    console.error('FAIL: holder did not Claim', events);
    process.exit(1);
  }
  if (w.getSnapshot().crown.holderId !== 'holder') {
    console.error('FAIL: crown not held after Claim');
    process.exit(1);
  }
}

// Hit during Grace: must land but must NOT Steal.
{
  const snap = w.getSnapshot();
  const holder = snap.fighters.find((f) => f.id === 'holder')!;
  const chaser = snap.fighters.find((f) => f.id === 'chaser')!;
  const yaw = yawToward(chaser.x, chaser.z, holder.x, holder.z);
  w.send({ type: 'setInput', fighterId: 'holder', input: { ...idle } });
  w.send({
    type: 'setInput',
    fighterId: 'chaser',
    input: { ...idle, yaw, hit: true },
  });
  const events = w.step();
  const landed = events.some(
    (e) =>
      e.type === 'hitLanded' &&
      e.attackerId === 'chaser' &&
      e.targetId === 'holder',
  );
  const stolen = events.some((e) => e.type === 'stolen');
  if (!landed) {
    console.error('FAIL: expected hitLanded during Grace', events);
    process.exit(1);
  }
  if (stolen) {
    console.error('FAIL: Steal during Grace', events);
    process.exit(1);
  }
  if (w.getSnapshot().crown.holderId !== 'holder') {
    console.error('FAIL: holder changed during Grace');
    process.exit(1);
  }
  console.log('OK: Hit during Grace → hitLanded only');
}

// Wait out Grace (+ hit cooldown buffer).
const graceTicks = Math.ceil(GRACE_DURATION / FIXED_DT) + 2;
const cooldownTicks = Math.ceil(HIT.hitCooldown / FIXED_DT) + 1;
for (let i = 0; i < Math.max(graceTicks, cooldownTicks); i++) {
  w.send({ type: 'setInput', fighterId: 'holder', input: { ...idle } });
  w.send({ type: 'setInput', fighterId: 'chaser', input: { ...idle } });
  w.step();
}

// Hit after Grace: must Steal.
{
  const snap = w.getSnapshot();
  const holder = snap.fighters.find((f) => f.id === 'holder')!;
  const chaser = snap.fighters.find((f) => f.id === 'chaser')!;
  // Keep them in range in case Claim-walk drift; re-seat via snapshot without clearing Grace
  // (holder still set → graceRemaining is left alone; we already waited it out).
  w.applySnapshot({
    ...snap,
    crown: { ...snap.crown, holderId: 'holder' },
    fighters: [
      { ...holder, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, onGround: true },
      {
        ...chaser,
        x: 1.2,
        y: 0,
        z: 0,
        yaw: yawToward(1.2, 0, 0, 0),
        vx: 0,
        vy: 0,
        vz: 0,
        onGround: true,
        hitCooldownRemaining: 0,
        stunRemaining: 0,
      },
    ],
  });

  const yaw = yawToward(1.2, 0, 0, 0);
  w.send({ type: 'setInput', fighterId: 'holder', input: { ...idle } });
  w.send({
    type: 'setInput',
    fighterId: 'chaser',
    input: { ...idle, yaw, hit: true },
  });
  const events = w.step();
  const stolen = events.some(
    (e) => e.type === 'stolen' && e.fromId === 'holder' && e.toId === 'chaser',
  );
  if (!stolen) {
    console.error('FAIL: expected Steal after Grace', events, w.getSnapshot().crown);
    process.exit(1);
  }
  if (w.getSnapshot().crown.holderId !== 'chaser') {
    console.error('FAIL: chaser is not Holder after Steal');
    process.exit(1);
  }
  console.log('OK: Hit after Grace → stolen');
}

console.log('PASS');
