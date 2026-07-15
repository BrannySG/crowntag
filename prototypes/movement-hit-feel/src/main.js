/**
 * THROWWAY PROTOTYPE — Movement + Hit Feel (issue #10)
 * Question: Does WASD + jump + sprint + click-to-hit feel right
 * (range / stun / knockback / crown steal) before locking V1 numbers?
 *
 * === DEFAULT TUNABLES (also exposed as live sliders) ===
 */
const DEFAULTS = {
  moveSpeed: 8,           // m/s walk
  sprintMult: 1.6,        // sprint = moveSpeed * this
  jumpImpulse: 9,         // vertical impulse
  gravity: 22,            // m/s²
  hitRange: 2.4,          // meters forward reach
  hitArcDeg: 90,          // degrees cone in front of facing
  hitCooldown: 0.35,      // seconds between hits
  stunDuration: 0.7,      // seconds stun on non-holder
  knockbackStrength: 11,  // impulse applied away from attacker
  playerRadius: 0.45,
  dummyRadius: 0.5,
};

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Tunable state (mutated by sliders)
// ---------------------------------------------------------------------------
const T = { ...DEFAULTS };

const ARENA = 48;
const HALF = ARENA / 2;

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
const app = document.getElementById('app');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2a32);
scene.fog = new THREE.Fog(0x2a2a32, 40, 90);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 200);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
app.appendChild(renderer.domElement);

const hemi = new THREE.HemisphereLight(0xc8d0e8, 0x3a3028, 0.85);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 0.9);
sun.position.set(20, 40, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -30;
sun.shadow.camera.right = 30;
sun.shadow.camera.top = 30;
sun.shadow.camera.bottom = -30;
scene.add(sun);

// Floor (48×48)
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(ARENA, ARENA),
  new THREE.MeshStandardMaterial({ color: 0x4a4a52, roughness: 0.85, metalness: 0.05 }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// Perimeter walls (3 m, ADR 0003)
const wallMat = new THREE.MeshStandardMaterial({ color: 0x5a5a64, roughness: 0.9 });
function addWall(w, h, d, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  scene.add(m);
  return m;
}
addWall(ARENA + 0.6, 3, 0.6, 0, 1.5, -HALF);
addWall(ARENA + 0.6, 3, 0.6, 0, 1.5, HALF);
addWall(0.6, 3, ARENA, -HALF, 1.5, 0);
addWall(0.6, 3, ARENA, HALF, 1.5, 0);

// Cover boxes (graybox peek cover)
const coverMat = new THREE.MeshStandardMaterial({ color: 0x6e6e78, roughness: 0.8 });
const covers = [
  [4, 1.1, 2, -8, 0.55, -6],
  [2, 1.1, 5, 10, 0.55, 4],
  [3, 1.1, 3, -4, 0.55, 12],
  [6, 1.1, 1.5, 6, 0.55, -14],
  [1.5, 1.1, 4, -14, 0.55, 2],
  [2.5, 1.1, 2.5, 14, 0.55, -8],
];
const obstacles = [];
for (const [w, h, d, x, y, z] of covers) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), coverMat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  scene.add(m);
  obstacles.push({ mesh: m, halfW: w / 2, halfD: d / 2 });
}

// Crown pedestal (center) — visual only
const pedestal = new THREE.Mesh(
  new THREE.CylinderGeometry(1.2, 1.4, 0.35, 16),
  new THREE.MeshStandardMaterial({ color: 0x8a7a4a, roughness: 0.6 }),
);
pedestal.position.set(0, 0.175, 0);
pedestal.receiveShadow = true;
scene.add(pedestal);

// Low pillars around pedestal
for (let i = 0; i < 6; i++) {
  const a = (i / 6) * Math.PI * 2;
  const p = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.4, 1.2, 8),
    new THREE.MeshStandardMaterial({ color: 0x707078 }),
  );
  p.position.set(Math.cos(a) * 5, 0.6, Math.sin(a) * 5);
  p.castShadow = true;
  scene.add(p);
  obstacles.push({ mesh: p, halfW: 0.4, halfD: 0.4 });
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------
const playerMat = new THREE.MeshStandardMaterial({ color: 0x3d8bfd });
const playerMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.9, 4, 8), playerMat);
playerMesh.castShadow = true;
scene.add(playerMesh);

const facingArrow = new THREE.Mesh(
  new THREE.ConeGeometry(0.18, 0.5, 6),
  new THREE.MeshStandardMaterial({ color: 0xa0c8ff }),
);
facingArrow.rotation.x = Math.PI / 2;
scene.add(facingArrow);

/** Crown visual — follows current holder */
const crown = new THREE.Mesh(
  new THREE.ConeGeometry(0.35, 0.45, 5),
  new THREE.MeshStandardMaterial({ color: 0xf5c542, emissive: 0x664400, emissiveIntensity: 0.35 }),
);
crown.castShadow = true;
scene.add(crown);

const HIT_FLASH = new THREE.Mesh(
  new THREE.SphereGeometry(0.3, 8, 8),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }),
);
scene.add(HIT_FLASH);

function makeDummy(id, x, z, color, moving) {
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.4, 0.9, 4, 8),
    new THREE.MeshStandardMaterial({ color }),
  );
  body.castShadow = true;
  body.position.set(x, 0.9, z);
  scene.add(body);
  const label = makeLabel(id);
  scene.add(label);
  return {
    id,
    mesh: body,
    label,
    pos: new THREE.Vector3(x, 0, z),
    vel: new THREE.Vector3(),
    stunT: 0,
    moving,
    home: new THREE.Vector3(x, 0, z),
    phase: Math.random() * Math.PI * 2,
  };
}

function makeLabel(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, 128, 32);
  ctx.fillStyle = '#eee';
  ctx.font = '16px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(text, 64, 22);
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  sprite.scale.set(1.6, 0.4, 1);
  return sprite;
}

const dummies = [
  makeDummy('Holder', 0, -10, 0xc44, false),
  makeDummy('Patrol-A', 12, 8, 0x6a8a6a, true),
  makeDummy('Patrol-B', -12, -4, 0x6a7a9a, true),
  makeDummy('Static', 8, -8, 0x8a6a8a, false),
];

/** Who holds the crown: 'player' | dummy.id */
let crownHolder = 'Holder';

const player = {
  pos: new THREE.Vector3(0, 0, 14),
  vel: new THREE.Vector3(),
  yaw: Math.PI, // face toward center (-Z camera behind → look + toward origin)
  onGround: true,
  stunT: 0,
  hitCd: 0,
};

/** Camera yaw (radians). WASD is relative to this — not world axes. */
let camYaw = Math.PI;
const LOOK_SENS = 0.0022;

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const keys = new Set();
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyR') resetArena();
  if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

renderer.domElement.addEventListener('click', () => {
  if (document.pointerLockElement !== renderer.domElement) {
    renderer.domElement.requestPointerLock();
  }
});

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  camYaw -= e.movementX * LOOK_SENS;
  player.yaw = camYaw;
});

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button === 0 && document.pointerLockElement === renderer.domElement) tryHit();
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------------------
// Sliders UI
// ---------------------------------------------------------------------------
const SLIDER_DEFS = [
  { key: 'moveSpeed', label: 'move speed', min: 3, max: 16, step: 0.1 },
  { key: 'sprintMult', label: 'sprint mult', min: 1, max: 2.5, step: 0.05 },
  { key: 'jumpImpulse', label: 'jump impulse', min: 4, max: 16, step: 0.1 },
  { key: 'gravity', label: 'gravity', min: 8, max: 40, step: 0.5 },
  { key: 'hitRange', label: 'hit range', min: 1, max: 5, step: 0.05 },
  { key: 'hitArcDeg', label: 'hit arc °', min: 30, max: 180, step: 5 },
  { key: 'hitCooldown', label: 'hit cooldown', min: 0.1, max: 1.2, step: 0.05 },
  { key: 'stunDuration', label: 'stun duration', min: 0.1, max: 2, step: 0.05 },
  { key: 'knockbackStrength', label: 'knockback', min: 2, max: 25, step: 0.5 },
];

const slidersEl = document.getElementById('sliders');
for (const def of SLIDER_DEFS) {
  const lab = document.createElement('label');
  const span = document.createElement('span');
  const name = document.createElement('b');
  name.textContent = def.label;
  const val = document.createElement('span');
  val.textContent = String(T[def.key]);
  val.dataset.key = def.key;
  span.append(name, val);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = def.min;
  input.max = def.max;
  input.step = def.step;
  input.value = T[def.key];
  input.addEventListener('input', () => {
    T[def.key] = Number(input.value);
    val.textContent = String(T[def.key]);
  });
  lab.append(span, input);
  slidersEl.append(lab);
}

// ---------------------------------------------------------------------------
// Gameplay
// ---------------------------------------------------------------------------
function resetArena() {
  player.pos.set(0, 0, 14);
  player.vel.set(0, 0, 0);
  player.yaw = Math.PI;
  camYaw = Math.PI;
  player.stunT = 0;
  player.hitCd = 0;
  player.onGround = true;
  crownHolder = 'Holder';
  for (const d of dummies) {
    d.pos.copy(d.home);
    d.vel.set(0, 0, 0);
    d.stunT = 0;
    d.mesh.material.emissive?.setHex?.(0x000000);
  }
}

function clampToArena(pos, radius) {
  const lim = HALF - radius - 0.3;
  pos.x = Math.max(-lim, Math.min(lim, pos.x));
  pos.z = Math.max(-lim, Math.min(lim, pos.z));
}

function resolveObstacles(pos, radius) {
  for (const o of obstacles) {
    const ox = o.mesh.position.x;
    const oz = o.mesh.position.z;
    const hw = o.halfW + radius;
    const hd = o.halfD + radius;
    const dx = pos.x - ox;
    const dz = pos.z - oz;
    if (Math.abs(dx) < hw && Math.abs(dz) < hd) {
      const px = hw - Math.abs(dx);
      const pz = hd - Math.abs(dz);
      if (px < pz) pos.x = ox + Math.sign(dx || 1) * hw;
      else pos.z = oz + Math.sign(dz || 1) * hd;
    }
  }
}

function tryHit() {
  if (player.hitCd > 0 || player.stunT > 0) return;
  player.hitCd = T.hitCooldown;

  const facing = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  const origin = player.pos.clone();
  origin.y = 1;

  // Visual flash
  HIT_FLASH.position.copy(origin).addScaledVector(facing, T.hitRange * 0.55);
  HIT_FLASH.material.opacity = 0.85;

  const halfArc = (T.hitArcDeg * Math.PI) / 180 / 2;
  let best = null;
  let bestDist = Infinity;

  for (const d of dummies) {
    const to = new THREE.Vector3().subVectors(d.pos, player.pos);
    to.y = 0;
    const dist = to.length();
    if (dist > T.hitRange + T.dummyRadius) continue;
    if (dist < 0.001) {
      best = d;
      bestDist = 0;
      break;
    }
    to.normalize();
    const ang = Math.acos(THREE.MathUtils.clamp(facing.dot(to), -1, 1));
    if (ang <= halfArc && dist < bestDist) {
      best = d;
      bestDist = dist;
    }
  }

  if (!best) return;

  // Flash tint
  flashDummy(best);

  if (crownHolder === best.id) {
    // Steal crown
    crownHolder = 'player';
    spawnStealBurst(best.pos);
  } else {
    // Stun + knockback
    best.stunT = T.stunDuration;
    const away = new THREE.Vector3().subVectors(best.pos, player.pos);
    away.y = 0;
    if (away.lengthSq() < 1e-6) away.copy(facing);
    away.normalize();
    best.vel.addScaledVector(away, T.knockbackStrength);
  }
}

function flashDummy(d) {
  const mat = d.mesh.material;
  const prev = mat.color.getHex();
  mat.color.setHex(0xffffff);
  setTimeout(() => mat.color.setHex(prev), 80);
}

function spawnStealBurst(at) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.4, 0.9, 24),
    new THREE.MeshBasicMaterial({ color: 0xf5c542, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(at.x, 0.2, at.z);
  scene.add(ring);
  const start = performance.now();
  function anim() {
    const t = (performance.now() - start) / 450;
    if (t >= 1) {
      scene.remove(ring);
      ring.geometry.dispose();
      ring.material.dispose();
      return;
    }
    ring.scale.setScalar(1 + t * 2.5);
    ring.material.opacity = 1 - t;
    requestAnimationFrame(anim);
  }
  requestAnimationFrame(anim);
}

function holderEntity() {
  if (crownHolder === 'player') return player;
  return dummies.find((d) => d.id === crownHolder) ?? dummies[0];
}

// ---------------------------------------------------------------------------
// Update loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
const debugEl = document.getElementById('debug');
const camOffset = new THREE.Vector3(0, 4.5, 7.5);
const camLook = new THREE.Vector3();
const desiredCam = new THREE.Vector3();

function update(dt) {
  // Cooldowns
  player.hitCd = Math.max(0, player.hitCd - dt);
  player.stunT = Math.max(0, player.stunT - dt);
  HIT_FLASH.material.opacity = Math.max(0, HIT_FLASH.material.opacity - dt * 3);

  // Player movement — camera-relative free move (not world axes / not grid)
  const stunned = player.stunT > 0;
  let inputF = 0; // forward (+W)
  let inputR = 0; // strafe right (+D)
  if (!stunned) {
    if (keys.has('KeyW') || keys.has('ArrowUp')) inputF += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) inputF -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) inputR += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) inputR -= 1;
  }
  const sprinting = !stunned && (keys.has('ShiftLeft') || keys.has('ShiftRight'));
  const speed = T.moveSpeed * (sprinting ? T.sprintMult : 1);

  // Keep body aligned with look (hit cone = where you're looking)
  player.yaw = camYaw;

  if (inputF !== 0 || inputR !== 0) {
    const len = Math.hypot(inputF, inputR);
    inputF /= len;
    inputR /= len;
    // Camera forward / right on XZ (matches facingArrow + hit cone)
    const fx = -Math.sin(camYaw);
    const fz = -Math.cos(camYaw);
    const rx = Math.cos(camYaw);
    const rz = -Math.sin(camYaw);
    player.vel.x = (fx * inputF + rx * inputR) * speed;
    player.vel.z = (fz * inputF + rz * inputR) * speed;
  } else {
    // ground friction on horizontal
    if (player.onGround) {
      player.vel.x *= Math.pow(0.01, dt);
      player.vel.z *= Math.pow(0.01, dt);
      if (Math.abs(player.vel.x) < 0.05) player.vel.x = 0;
      if (Math.abs(player.vel.z) < 0.05) player.vel.z = 0;
    }
  }

  // Jump
  if (!stunned && player.onGround && keys.has('Space')) {
    player.vel.y = T.jumpImpulse;
    player.onGround = false;
  }

  // Gravity
  if (!player.onGround) {
    player.vel.y -= T.gravity * dt;
  }

  // Integrate
  player.pos.x += player.vel.x * dt;
  player.pos.y += player.vel.y * dt;
  player.pos.z += player.vel.z * dt;

  if (player.pos.y <= 0) {
    player.pos.y = 0;
    player.vel.y = 0;
    player.onGround = true;
  }

  clampToArena(player.pos, T.playerRadius);
  resolveObstacles(player.pos, T.playerRadius);

  // Dummies
  for (const d of dummies) {
    d.stunT = Math.max(0, d.stunT - dt);
    if (d.stunT > 0) {
      // knockback decay while stunned
      d.pos.x += d.vel.x * dt;
      d.pos.z += d.vel.z * dt;
      d.vel.x *= Math.pow(0.05, dt);
      d.vel.z *= Math.pow(0.05, dt);
      d.mesh.material.emissive.setHex(0x442200);
    } else {
      d.mesh.material.emissive?.setHex?.(0x000000);
      d.vel.x *= Math.pow(0.02, dt);
      d.vel.z *= Math.pow(0.02, dt);
      d.pos.x += d.vel.x * dt;
      d.pos.z += d.vel.z * dt;

      if (d.moving && crownHolder !== d.id) {
        d.phase += dt * 0.6;
        const tx = d.home.x + Math.cos(d.phase) * 3.5;
        const tz = d.home.z + Math.sin(d.phase * 0.85) * 3.5;
        d.pos.x += (tx - d.pos.x) * Math.min(1, dt * 1.2);
        d.pos.z += (tz - d.pos.z) * Math.min(1, dt * 1.2);
      } else if (d.moving && crownHolder === d.id) {
        // holder patrols slower
        d.phase += dt * 0.35;
        const tx = d.home.x + Math.cos(d.phase) * 2;
        const tz = d.home.z + Math.sin(d.phase) * 2;
        d.pos.x += (tx - d.pos.x) * Math.min(1, dt);
        d.pos.z += (tz - d.pos.z) * Math.min(1, dt);
      }
    }
    clampToArena(d.pos, T.dummyRadius);
    resolveObstacles(d.pos, T.dummyRadius);
    d.mesh.position.set(d.pos.x, 0.9, d.pos.z);
    d.label.position.set(d.pos.x, 2.05, d.pos.z);
  }

  // Meshes
  playerMesh.position.set(player.pos.x, 0.9 + player.pos.y, player.pos.z);
  playerMesh.rotation.y = player.yaw;
  const fx = -Math.sin(player.yaw);
  const fz = -Math.cos(player.yaw);
  facingArrow.position.set(
    player.pos.x + fx * 0.7,
    0.9 + player.pos.y,
    player.pos.z + fz * 0.7,
  );
  facingArrow.rotation.y = player.yaw;

  // Crown follows holder
  const holder = holderEntity();
  const hx = holder === player ? player.pos.x : holder.pos.x;
  const hz = holder === player ? player.pos.z : holder.pos.z;
  const hy = holder === player ? player.pos.y + 1.85 : 1.85;
  crown.position.set(hx, hy, hz);
  crown.rotation.y += dt * 2.5;

  // Tint player when holding
  playerMat.color.setHex(crownHolder === 'player' ? 0xf5c542 : 0x3d8bfd);

  // Third-person camera behind look direction (camYaw), not move snaps
  const back = new THREE.Vector3(Math.sin(camYaw), 0, Math.cos(camYaw));
  desiredCam.set(
    player.pos.x + back.x * camOffset.z,
    player.pos.y + camOffset.y,
    player.pos.z + back.z * camOffset.z,
  );
  // Snappy follow so look feels free, not latched to cardinals
  camera.position.lerp(desiredCam, 1 - Math.pow(0.0002, dt));
  camLook.set(player.pos.x, player.pos.y + 1.2, player.pos.z);
  camera.lookAt(camLook);

  // Debug HUD
  const spd = Math.hypot(player.vel.x, player.vel.z);
  debugEl.innerHTML = [
    `<span class="dim">pos</span>  ${player.pos.x.toFixed(2)}, ${player.pos.y.toFixed(2)}, ${player.pos.z.toFixed(2)}`,
    `<span class="dim">vel</span>  xz ${spd.toFixed(2)}  y ${player.vel.y.toFixed(2)}  ${sprinting ? '[SPRINT]' : ''} ${player.onGround ? '' : '[AIR]'}`,
    `<span class="dim">yaw</span>  ${((player.yaw * 180) / Math.PI).toFixed(0)}°`,
    `<span class="dim">hitCd</span> ${player.hitCd.toFixed(2)}s`,
    `<span class="dim">stun</span>  player ${player.stunT.toFixed(2)}s`,
    ...dummies.map((d) => `<span class="dim">${d.id}</span> stun ${d.stunT.toFixed(2)}s`),
    `<span class="dim">crown</span> <b>${crownHolder}</b>`,
    `<span class="dim">range</span> ${T.hitRange.toFixed(2)}m  arc ${T.hitArcDeg}°`,
  ].join('<br/>');
}

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
