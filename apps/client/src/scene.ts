import * as THREE from 'three';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import {
  ARENA_SIZE,
  OBSTACLES,
  PEDESTAL,
  WALL_HEIGHT,
} from '@crowntag/content';
import type { ArenaSnapshot, FighterSnapshot } from '@crowntag/protocol';
import {
  createFighterVisual,
  isFighterModelReady,
  prefetchFighterModel,
  type FighterVisual,
} from './fighterVisual';
import groundGrassObjUrl from './assets/models/nature-kit/ground_grass.obj';
import groundGrassMtlUrl from './assets/models/nature-kit/ground_grass.mtl';
import cliffBlockStoneObjUrl from './assets/models/nature-kit/cliff_block_stone.obj';
import cliffBlockStoneMtlUrl from './assets/models/nature-kit/cliff_block_stone.mtl';

const HALF = ARENA_SIZE / 2;

/** Kenney Nature Kit `ground_grass` is authored as a flat 1×1 unit tile. */
const GROUND_TILE_SIZE = 4;
/** Kenney Nature Kit `cliff_block_stone` is authored as a 1×1×1 unit cube (grass cap + stone sides). */
const WALL_BLOCK_SIZE = 1;

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
  scene.background = new THREE.Color(0x9fd3e8);
  scene.fog = new THREE.Fog(0x9fd3e8, 46, 100);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  const hemi = new THREE.HemisphereLight(0xd8ecff, 0x4a6b3a, 0.95);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff4d6, 1.05);
  sun.position.set(20, 40, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  scene.add(sun);

  // Nature Kit ground + perimeter walls load asynchronously; `disposed` guards against
  // adding instanced meshes to the scene after teardown (see `dispose()` below).
  let disposed = false;
  const natureDisposables: Array<{ dispose(): void }> = [];
  void loadNatureFoundation();
  void prefetchFighterModel();

  async function loadNatureFoundation() {
    let groundModel: THREE.Group;
    let wallModel: THREE.Group;
    try {
      [groundModel, wallModel] = await Promise.all([
        loadObjModel(groundGrassObjUrl, groundGrassMtlUrl),
        loadObjModel(cliffBlockStoneObjUrl, cliffBlockStoneMtlUrl),
      ]);
    } catch (err) {
      // Nature Kit models failed to load (e.g. bad/missing asset) — keep the arena
      // playable with a plain procedural ground/walls fallback instead of crashing.
      console.error('Nature Kit model load failed; using procedural fallback ground/walls.', err);
      if (!disposed) buildProceduralFallback(scene, natureDisposables);
      return;
    }

    if (disposed) {
      disposeModelSource(groundModel);
      disposeModelSource(wallModel);
      return;
    }

    const groundMatrices: THREE.Matrix4[] = [];
    const groundTiles = ARENA_SIZE / GROUND_TILE_SIZE;
    for (let i = 0; i < groundTiles; i++) {
      const x = -HALF + GROUND_TILE_SIZE / 2 + i * GROUND_TILE_SIZE;
      for (let j = 0; j < groundTiles; j++) {
        const z = -HALF + GROUND_TILE_SIZE / 2 + j * GROUND_TILE_SIZE;
        groundMatrices.push(
          new THREE.Matrix4().compose(
            new THREE.Vector3(x, 0, z),
            new THREE.Quaternion(),
            new THREE.Vector3(GROUND_TILE_SIZE, 1, GROUND_TILE_SIZE),
          ),
        );
      }
    }
    const groundGroup = buildInstancedGroup(groundModel, groundMatrices, {
      castShadow: false,
      receiveShadow: true,
    });
    scene.add(groundGroup);
    natureDisposables.push({
      dispose: () => disposeInstancedGroup(scene, groundGroup),
    });

    const wallScale = new THREE.Vector3(WALL_BLOCK_SIZE, WALL_HEIGHT, WALL_BLOCK_SIZE);
    // `cliff_block_stone`'s pivot sits at its base (y: 0→1), not its center, so a
    // y-scaled instance's foot stays planted at ground level when position.y = 0.
    const wallY = 0;
    const wallMatrices: THREE.Matrix4[] = [];
    const addWallBlock = (x: number, z: number) =>
      wallMatrices.push(
        new THREE.Matrix4().compose(new THREE.Vector3(x, wallY, z), new THREE.Quaternion(), wallScale),
      );
    for (let x = -HALF; x <= HALF; x += WALL_BLOCK_SIZE) {
      addWallBlock(x, -HALF);
      addWallBlock(x, HALF);
    }
    for (let z = -HALF + WALL_BLOCK_SIZE; z <= HALF - WALL_BLOCK_SIZE; z += WALL_BLOCK_SIZE) {
      addWallBlock(-HALF, z);
      addWallBlock(HALF, z);
    }
    const wallGroup = buildInstancedGroup(wallModel, wallMatrices, {
      castShadow: true,
      receiveShadow: true,
    });
    scene.add(wallGroup);
    natureDisposables.push({
      dispose: () => disposeInstancedGroup(scene, wallGroup),
    });
  }

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

  type FighterEntry = {
    root: THREE.Group;
    visual: FighterVisual;
    label: THREE.Sprite;
    placeholder: boolean;
  };

  const fighterMeshes = new Map<string, FighterEntry>();

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
    const visual = createFighterVisual();
    scene.add(visual.root);
    const label = makeLabel(f.displayName);
    scene.add(label);
    entry = {
      root: visual.root,
      visual,
      label,
      placeholder: Boolean(visual.isPlaceholder) || !isFighterModelReady(),
    };
    fighterMeshes.set(f.id, entry);
    return entry;
  }

  function upgradeFighterVisual(entry: FighterEntry) {
    scene.remove(entry.root);
    entry.visual.dispose();
    const visual = createFighterVisual();
    scene.add(visual.root);
    entry.root = visual.root;
    entry.visual = visual;
    entry.placeholder = Boolean(visual.isPlaceholder);
  }

  function pruneFighters(snap: ArenaSnapshot) {
    const alive = new Set(snap.fighters.map((f) => f.id));
    for (const [id, entry] of fighterMeshes) {
      if (alive.has(id)) continue;
      scene.remove(entry.root);
      scene.remove(entry.label);
      entry.visual.dispose();
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
      if (entry.placeholder && isFighterModelReady()) {
        upgradeFighterVisual(entry);
      }

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

      entry.root.position.set(pose.x, pose.y, pose.z);
      entry.root.rotation.y = pose.yaw;
      entry.label.position.set(pose.x, 2.05 + pose.y, pose.z);
      const holding = snap.crown.holderId === f.id;
      const tintColor = holding ? 0xf5c542 : colorFor(f, localFighterId);
      entry.visual.update(f, { holding, tintColor }, dt);

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
      disposed = true;
      for (const d of natureDisposables) d.dispose();
      natureDisposables.length = 0;
      for (const entry of fighterMeshes.values()) {
        scene.remove(entry.root);
        scene.remove(entry.label);
        entry.visual.dispose();
      }
      fighterMeshes.clear();
      removeEventListener('resize', resize);
      renderer.dispose();
      container.removeChild(renderer.domElement);
    },
  };
}

/** Loads a Nature Kit OBJ model together with its MTL materials. */
async function loadObjModel(objUrl: string, mtlUrl: string): Promise<THREE.Group> {
  const materials = await new MTLLoader().loadAsync(mtlUrl);
  materials.preload();
  const objLoader = new OBJLoader();
  objLoader.setMaterials(materials);
  return objLoader.loadAsync(objUrl);
}

/**
 * Turns every Mesh found in a loaded OBJ model (e.g. one mesh with a multi-material
 * grass/stone group, or several sibling meshes) into an InstancedMesh repeated
 * at each given transform, so a single small model tiles across the arena in
 * one draw call per source mesh.
 */
function buildInstancedGroup(
  model: THREE.Object3D,
  matrices: THREE.Matrix4[],
  flags: { castShadow: boolean; receiveShadow: boolean },
): THREE.Group {
  const group = new THREE.Group();
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const inst = new THREE.InstancedMesh(child.geometry, child.material, matrices.length);
    inst.castShadow = flags.castShadow;
    inst.receiveShadow = flags.receiveShadow;
    matrices.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
  });
  return group;
}

function disposeInstancedGroup(scene: THREE.Scene, group: THREE.Group) {
  scene.remove(group);
  for (const child of group.children) {
    if (!(child instanceof THREE.InstancedMesh)) continue;
    child.geometry.dispose();
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const m of mats) m.dispose();
  }
}

/** Frees a loaded-but-never-instanced OBJ model (scene disposed mid-load). */
function disposeModelSource(model: THREE.Object3D) {
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const m of mats) m.dispose();
  });
}

/**
 * Plain-geometry ground plane + wall blocks used only when the Nature Kit OBJ
 * models fail to load, so the arena stays visible and playable.
 */
function buildProceduralFallback(
  scene: THREE.Scene,
  natureDisposables: Array<{ dispose(): void }>,
) {
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x4a8f4a, roughness: 0.95 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_SIZE, ARENA_SIZE), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  natureDisposables.push({
    dispose: () => {
      scene.remove(ground);
      ground.geometry.dispose();
      groundMat.dispose();
    },
  });

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x8a8a86, roughness: 0.9 });
  const wallGroup = new THREE.Group();
  const addWallBlock = (x: number, z: number) => {
    const block = new THREE.Mesh(
      new THREE.BoxGeometry(WALL_BLOCK_SIZE, WALL_HEIGHT, WALL_BLOCK_SIZE),
      wallMat,
    );
    block.position.set(x, WALL_HEIGHT / 2, z);
    block.castShadow = true;
    block.receiveShadow = true;
    wallGroup.add(block);
  };
  for (let x = -HALF; x <= HALF; x += WALL_BLOCK_SIZE) {
    addWallBlock(x, -HALF);
    addWallBlock(x, HALF);
  }
  for (let z = -HALF + WALL_BLOCK_SIZE; z <= HALF - WALL_BLOCK_SIZE; z += WALL_BLOCK_SIZE) {
    addWallBlock(-HALF, z);
    addWallBlock(HALF, z);
  }
  scene.add(wallGroup);
  natureDisposables.push({
    dispose: () => {
      scene.remove(wallGroup);
      for (const child of wallGroup.children) {
        if (child instanceof THREE.Mesh) child.geometry.dispose();
      }
      wallMat.dispose();
    },
  });
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
