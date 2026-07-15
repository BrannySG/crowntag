import * as THREE from 'three';
import {
  ARENA_SIZE,
  OBSTACLES,
  PEDESTAL,
  WALL_HEIGHT,
} from '@crowntag/content';
import type { ArenaSnapshot, FighterSnapshot } from '@crowntag/protocol';

const HALF = ARENA_SIZE / 2;

const PLAYER_COLORS = [0x3d8bfd, 0x5ecf8a, 0xe07a5f, 0xc77dff, 0xf4a261, 0x2a9d8f];

export type ArenaScene = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  updateFromSnapshot: (
    snap: ArenaSnapshot,
    localFighterId: string,
    camYaw: number,
    dt: number,
  ) => void;
  resize: () => void;
  dispose: () => void;
};

export function createArenaScene(container: HTMLElement): ArenaScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2a2a32);
  scene.fog = new THREE.Fog(0x2a2a32, 40, 90);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

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

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ARENA_SIZE, ARENA_SIZE),
    new THREE.MeshStandardMaterial({ color: 0x4a4a52, roughness: 0.85, metalness: 0.05 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x5a5a64, roughness: 0.9 });
  function addWall(w: number, h: number, d: number, x: number, y: number, z: number) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  }
  addWall(ARENA_SIZE + 0.6, WALL_HEIGHT, 0.6, 0, WALL_HEIGHT / 2, -HALF);
  addWall(ARENA_SIZE + 0.6, WALL_HEIGHT, 0.6, 0, WALL_HEIGHT / 2, HALF);
  addWall(0.6, WALL_HEIGHT, ARENA_SIZE, -HALF, WALL_HEIGHT / 2, 0);
  addWall(0.6, WALL_HEIGHT, ARENA_SIZE, HALF, WALL_HEIGHT / 2, 0);

  const boxMat = new THREE.MeshStandardMaterial({ color: 0x6e6e78, roughness: 0.8 });
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x707078 });
  for (const o of OBSTACLES) {
    if (o.kind === 'box') {
      const m = new THREE.Mesh(new THREE.BoxGeometry(o.w, o.h, o.d), boxMat);
      m.position.set(o.x, o.y, o.z);
      m.castShadow = true;
      m.receiveShadow = true;
      scene.add(m);
    } else {
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(o.w / 2, o.w / 2 + 0.05, o.h, 8),
        pillarMat,
      );
      m.position.set(o.x, o.y, o.z);
      m.castShadow = true;
      scene.add(m);
    }
  }

  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(PEDESTAL.topRadius, PEDESTAL.bottomRadius, PEDESTAL.height, 16),
    new THREE.MeshStandardMaterial({ color: 0x8a7a4a, roughness: 0.6 }),
  );
  pedestal.position.set(0, PEDESTAL.height / 2, 0);
  pedestal.receiveShadow = true;
  scene.add(pedestal);

  const crown = new THREE.Mesh(
    new THREE.ConeGeometry(0.35, 0.45, 5),
    new THREE.MeshStandardMaterial({
      color: 0xf5c542,
      emissive: 0x664400,
      emissiveIntensity: 0.35,
    }),
  );
  crown.castShadow = true;
  scene.add(crown);

  const fighterMeshes = new Map<
    string,
    { body: THREE.Mesh; mat: THREE.MeshStandardMaterial; label: THREE.Sprite }
  >();

  const dummyMats: Record<string, number> = {
    'dummy-1': 0xc44,
    'dummy-2': 0x6a8a6a,
    'dummy-3': 0x6a7a9a,
    'dummy-4': 0x8a6a8a,
  };

  let colorIdx = 0;
  const assignedColors = new Map<string, number>();

  function colorFor(f: FighterSnapshot, localId: string): number {
    if (f.kind === 'dummy') return dummyMats[f.id] ?? 0x888888;
    if (f.id === localId) return 0x3d8bfd;
    if (!assignedColors.has(f.id)) {
      assignedColors.set(f.id, PLAYER_COLORS[colorIdx++ % PLAYER_COLORS.length]!);
    }
    return assignedColors.get(f.id)!;
  }

  function ensureFighter(f: FighterSnapshot, localId: string) {
    let entry = fighterMeshes.get(f.id);
    if (entry) return entry;
    const mat = new THREE.MeshStandardMaterial({ color: colorFor(f, localId) });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.9, 4, 8), mat);
    body.castShadow = true;
    scene.add(body);
    const label = makeLabel(f.displayName);
    scene.add(label);
    entry = { body, mat, label };
    fighterMeshes.set(f.id, entry);
    return entry;
  }

  function pruneFighters(snap: ArenaSnapshot) {
    const alive = new Set(snap.fighters.map((f) => f.id));
    for (const [id, entry] of fighterMeshes) {
      if (alive.has(id)) continue;
      scene.remove(entry.body);
      scene.remove(entry.label);
      entry.body.geometry.dispose();
      entry.mat.dispose();
      fighterMeshes.delete(id);
      assignedColors.delete(id);
    }
  }

  const camOffset = new THREE.Vector3(0, 4.5, 7.5);
  const camLook = new THREE.Vector3();

  /** Client-only render pose — smooths 20 Hz sim snaps without touching authority. */
  type DisplayPose = { x: number; y: number; z: number; yaw: number };
  const displayPoses = new Map<string, DisplayPose>();
  const SMOOTH_RATE = 15;
  const SNAP_DIST = 2.5;

  function shortestAngleDelta(from: number, to: number): number {
    let d = to - from;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  function smoothToward(
    pose: DisplayPose,
    target: { x: number; y: number; z: number; yaw: number },
    dt: number,
  ) {
    const dx = target.x - pose.x;
    const dz = target.z - pose.z;
    if (dx * dx + dz * dz > SNAP_DIST * SNAP_DIST) {
      pose.x = target.x;
      pose.y = target.y;
      pose.z = target.z;
      pose.yaw = target.yaw;
      return;
    }
    const a = 1 - Math.exp(-SMOOTH_RATE * Math.max(dt, 0));
    pose.x += (target.x - pose.x) * a;
    pose.y += (target.y - pose.y) * a;
    pose.z += (target.z - pose.z) * a;
    pose.yaw += shortestAngleDelta(pose.yaw, target.yaw) * a;
  }

  function updateFromSnapshot(
    snap: ArenaSnapshot,
    localFighterId: string,
    camYaw: number,
    dt: number,
  ) {
    pruneFighters(snap);
    const alive = new Set(snap.fighters.map((f) => f.id));
    for (const id of displayPoses.keys()) {
      if (!alive.has(id)) displayPoses.delete(id);
    }

    let localDisplay: DisplayPose | undefined;

    for (const f of snap.fighters) {
      const entry = ensureFighter(f, localFighterId);
      const isLocal = f.id === localFighterId;
      const extrap = isLocal ? Math.min(Math.max(dt, 0), 0.05) : 0;
      const target = {
        x: f.x + f.vx * extrap,
        y: f.y,
        z: f.z + f.vz * extrap,
        yaw: f.yaw,
      };

      let pose = displayPoses.get(f.id);
      if (!pose) {
        pose = { x: target.x, y: target.y, z: target.z, yaw: target.yaw };
        displayPoses.set(f.id, pose);
      } else {
        smoothToward(pose, target, dt);
      }

      entry.body.position.set(pose.x, 0.9 + pose.y, pose.z);
      entry.body.rotation.y = pose.yaw;
      entry.label.position.set(pose.x, 2.05 + pose.y, pose.z);
      const holding = snap.crown.holderId === f.id;
      if (holding) entry.mat.color.setHex(0xf5c542);
      else entry.mat.color.setHex(colorFor(f, localFighterId));
      if (f.stunRemaining > 0) entry.mat.emissive.setHex(0x442200);
      else entry.mat.emissive.setHex(0x000000);

      if (isLocal) localDisplay = pose;
    }

    const holderId = snap.crown.holderId;
    const holderPose = holderId ? displayPoses.get(holderId) : undefined;
    if (holderPose) {
      // Match World.getSnapshot crown Y offset (holder.y + 1.85).
      crown.position.set(holderPose.x, holderPose.y + 1.85, holderPose.z);
    } else {
      crown.position.set(snap.crown.x, snap.crown.y, snap.crown.z);
    }
    crown.rotation.y += dt * 2.5;

    if (localDisplay) {
      // Follow smoothed display pose — hard 20 Hz snaps read as camera vibration.
      const backX = Math.sin(camYaw);
      const backZ = Math.cos(camYaw);
      camera.position.set(
        localDisplay.x + backX * camOffset.z,
        localDisplay.y + camOffset.y,
        localDisplay.z + backZ * camOffset.z,
      );
      camLook.set(localDisplay.x, localDisplay.y + 1.2, localDisplay.z);
      camera.lookAt(camLook);
    }
  }

  function resize() {
    const w = container.clientWidth || innerWidth;
    const h = container.clientHeight || innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  resize();
  addEventListener('resize', resize);

  return {
    scene,
    camera,
    renderer,
    updateFromSnapshot,
    resize,
    dispose: () => {
      removeEventListener('resize', resize);
      renderer.dispose();
      container.removeChild(renderer.domElement);
    },
  };
}

function makeLabel(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, 128, 32);
  ctx.fillStyle = '#eee';
  ctx.font = '16px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(text.slice(0, 16), 64, 22);
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  sprite.scale.set(1.6, 0.4, 1);
  return sprite;
}
