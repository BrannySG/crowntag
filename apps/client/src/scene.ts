import * as THREE from 'three';
import {
  ARENA_SIZE,
  OBSTACLES,
  PEDESTAL,
  WALL_HEIGHT,
} from '@crowntag/content';
import type { ArenaSnapshot, FighterSnapshot } from '@crowntag/protocol';

const HALF = ARENA_SIZE / 2;

export type ArenaScene = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  updateFromSnapshot: (snap: ArenaSnapshot, camYaw: number, dt: number) => void;
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

  const playerMat = new THREE.MeshStandardMaterial({ color: 0x3d8bfd });
  const dummyMats: Record<string, number> = {
    'dummy-1': 0xc44,
    'dummy-2': 0x6a8a6a,
    'dummy-3': 0x6a7a9a,
    'dummy-4': 0x8a6a8a,
  };

  function ensureFighter(f: FighterSnapshot) {
    let entry = fighterMeshes.get(f.id);
    if (entry) return entry;
    const color =
      f.kind === 'player' ? 0x3d8bfd : (dummyMats[f.id] ?? 0x888888);
    const mat =
      f.kind === 'player'
        ? playerMat
        : new THREE.MeshStandardMaterial({ color });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.9, 4, 8), mat);
    body.castShadow = true;
    scene.add(body);
    const label = makeLabel(f.displayName);
    scene.add(label);
    entry = { body, mat, label };
    fighterMeshes.set(f.id, entry);
    return entry;
  }

  const camOffset = new THREE.Vector3(0, 4.5, 7.5);
  const camLook = new THREE.Vector3();
  const desiredCam = new THREE.Vector3();

  function updateFromSnapshot(snap: ArenaSnapshot, camYaw: number, dt: number) {
    const player = snap.fighters.find((f) => f.id === 'player');

    for (const f of snap.fighters) {
      const entry = ensureFighter(f);
      entry.body.position.set(f.x, 0.9 + f.y, f.z);
      entry.body.rotation.y = f.yaw;
      entry.label.position.set(f.x, 2.05 + f.y, f.z);
      if (f.kind === 'player') {
        entry.mat.color.setHex(snap.crown.holderId === 'player' ? 0xf5c542 : 0x3d8bfd);
      } else {
        const mat = entry.mat;
        if (f.stunRemaining > 0) mat.emissive?.setHex(0x442200);
        else mat.emissive?.setHex(0x000000);
      }
    }

    crown.position.set(snap.crown.x, snap.crown.y, snap.crown.z);
    crown.rotation.y += dt * 2.5;

    if (player) {
      const backX = Math.sin(camYaw);
      const backZ = Math.cos(camYaw);
      desiredCam.set(
        player.x + backX * camOffset.z,
        player.y + camOffset.y,
        player.z + backZ * camOffset.z,
      );
      camera.position.lerp(desiredCam, 1 - Math.pow(0.0002, dt));
      camLook.set(player.x, player.y + 1.2, player.z);
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
  ctx.fillText(text, 64, 22);
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  sprite.scale.set(1.6, 0.4, 1);
  return sprite;
}
