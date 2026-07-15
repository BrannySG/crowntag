/**
 * Minimal Rapier smoke: dynamic capsule + static floor must land and rotate.
 * Run: node scripts/ragdoll-physics-smoke.mjs
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const clientRapier = path.resolve(
  __dirname,
  '../apps/client/node_modules/@dimforge/rapier3d-compat',
);

let RAPIER;
try {
  RAPIER = (await import(pathToFileUrl(clientRapier + '/rapier.mjs'))).default;
} catch {
  RAPIER = require(clientRapier);
}

function pathToFileUrl(p) {
  const resolved = path.resolve(p).replace(/\\/g, '/');
  return resolved.startsWith('/') ? `file://${resolved}` : `file:///${resolved}`;
}

await RAPIER.init();

const world = new RAPIER.World({ x: 0, y: -20, z: 0 });
world.timestep = 1 / 60;

const floorBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.05, 0));
world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.05, 50), floorBody);

const capsuleBody = world.createRigidBody(
  RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(0, 1.2, 0)
    .setLinearDamping(1.2)
    .setAngularDamping(1.5)
    .setCanSleep(false),
);
world.createCollider(RAPIER.ColliderDesc.capsule(0.4, 0.2).setMass(1), capsuleBody);

const rot0 = capsuleBody.rotation();
capsuleBody.applyImpulse({ x: 4, y: 2, z: 1 }, true);
capsuleBody.applyTorqueImpulse({ x: 0.5, y: 0.2, z: 0.8 }, true);

for (let i = 0; i < 90; i++) {
  world.step();
}

const t = capsuleBody.translation();
const rot = capsuleBody.rotation();
const yOk = t.y < 0.4;
const rotDelta =
  Math.abs(rot.x - rot0.x) +
  Math.abs(rot.y - rot0.y) +
  Math.abs(rot.z - rot0.z) +
  Math.abs(rot.w - rot0.w);
const rotOk = rotDelta > 0.05;

world.free();

const pass = yOk && rotOk;
console.log(
  pass ? 'PASS' : 'FAIL',
  `| finalY=${t.y.toFixed(3)} (need < 0.4)`,
  `| rotDelta=${rotDelta.toFixed(3)} (need > 0.05)`,
);
if (!pass) process.exit(1);
