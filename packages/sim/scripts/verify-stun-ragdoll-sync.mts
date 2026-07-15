/**
 * Headless check: stun duration 2s, stunned event carries impulse.
 * Run: pnpm --filter @crowntag/sim exec tsx scripts/verify-stun-ragdoll-sync.mts
 */
import { HIT } from '@crowntag/content';
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

if (HIT.stunDuration !== 2) {
  console.error('FAIL: HIT.stunDuration expected 2, got', HIT.stunDuration);
  process.exit(1);
}

const w = createArenaWorld();
w.addPlayer('attacker', 'Attacker', 0);
w.addPlayer('victim', 'Victim', 1);

{
  const snap = w.getSnapshot();
  const attacker = snap.fighters.find((f) => f.id === 'attacker')!;
  const victim = snap.fighters.find((f) => f.id === 'victim')!;
  const ax = 0;
  const az = 0;
  const vx = 0;
  const vz = 1.5;
  w.applySnapshot({
    ...snap,
    crown: { holderId: null, x: 8, y: 0.35, z: 8 },
    fighters: [
      {
        ...attacker,
        x: ax,
        y: 0,
        z: az,
        yaw: yawToward(ax, az, vx, vz),
        vx: 0,
        vy: 0,
        vz: 0,
        onGround: true,
        hitCooldownRemaining: 0,
        stunRemaining: 0,
      },
      {
        ...victim,
        x: vx,
        y: 0,
        z: vz,
        yaw: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        onGround: true,
        hitCooldownRemaining: 0,
        stunRemaining: 0,
      },
    ],
  });
}

const yaw = yawToward(0, 0, 0, 1.5);
w.send({ type: 'setInput', fighterId: 'victim', input: { ...idle } });
w.send({
  type: 'setInput',
  fighterId: 'attacker',
  input: { ...idle, yaw, hit: true },
});
const events = w.step();

const stunned = events.filter((e) => e.type === 'stunned');
if (stunned.length !== 1) {
  console.error('FAIL: expected 1 stunned event, got', events);
  process.exit(1);
}

const ev = stunned[0]!;
if (ev.type !== 'stunned') process.exit(1);

const impulseMag = Math.hypot(ev.impulseX, ev.impulseZ);
if (Math.abs(impulseMag - HIT.knockbackStrength) > 1e-3) {
  console.error('FAIL: impulse magnitude', impulseMag, 'expected', HIT.knockbackStrength, ev);
  process.exit(1);
}
if (ev.stunRemaining !== HIT.stunDuration) {
  console.error('FAIL: event stunRemaining', ev.stunRemaining);
  process.exit(1);
}

const afterHit = w.getSnapshot().fighters.find((f) => f.id === 'victim')!;
if (Math.abs(afterHit.stunRemaining - HIT.stunDuration) > 1e-3) {
  console.error('FAIL: victim stunRemaining', afterHit.stunRemaining);
  process.exit(1);
}

if (ev.impulseZ <= 0) {
  console.error('FAIL: expected +Z impulse', ev);
  process.exit(1);
}

const ticks = Math.ceil(HIT.stunDuration / FIXED_DT);
for (let i = 0; i < ticks - 1; i++) {
  w.send({ type: 'setInput', fighterId: 'attacker', input: { ...idle } });
  w.send({
    type: 'setInput',
    fighterId: 'victim',
    input: { ...idle, forward: 1 },
  });
  w.step();
}

const mid = w.getSnapshot().fighters.find((f) => f.id === 'victim')!;
if (mid.stunRemaining <= 0) {
  console.error('FAIL: stun ended too early', mid.stunRemaining);
  process.exit(1);
}

w.send({ type: 'setInput', fighterId: 'attacker', input: { ...idle } });
w.send({ type: 'setInput', fighterId: 'victim', input: { ...idle } });
w.step();

const done = w.getSnapshot().fighters.find((f) => f.id === 'victim')!;
if (done.stunRemaining > 1e-6) {
  console.error('FAIL: stun should be finished', done.stunRemaining);
  process.exit(1);
}

console.log('OK', {
  stunDuration: HIT.stunDuration,
  impulse: { x: ev.impulseX, z: ev.impulseZ },
  impulseMag,
  ticks,
});
