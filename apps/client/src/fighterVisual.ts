import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { MOVEMENT } from '@crowntag/content';
import type { FighterSnapshot } from '@crowntag/protocol';
import bunnyGlbUrl from './assets/models/characters/Mesh_BunnyChar_00.glb';

/** Target character height in world units (roughly capsule-tall). */
const TARGET_HEIGHT = 1.8;

const WALK_SPEED = 0.3;
const RUN_SPEED = MOVEMENT.moveSpeed * 1.15;

const LOCO_FADE = 0.12;
const ONESHOT_FADE = 0.07;
const ANIM_TIME_SCALE = 1.2;

const CLIP_IDLE = 'idle_bounce';
const CLIP_WALK = 'walk';
const CLIP_RUN = 'run';
const CLIP_JUMP_START = 'jump_start';
const CLIP_JUMP_LAND = 'jump_land';
const CLIP_ATTACK = 'attack';
const CLIP_DAMAGE = 'damage';

/** Set once during prefetch from the template Box3. */
export let FIGHTER_MODEL_SCALE = 1;
/** Child Y offset so feet sit at root y=0 after scale. */
export let FIGHTER_MODEL_Y_OFFSET = 0;

export type FighterVisual = {
  root: THREE.Group;
  isPlaceholder?: boolean;
  update(
    f: FighterSnapshot,
    opts: { holding: boolean; tintColor: number },
    dt: number,
  ): void;
  dispose(): void;
};

type TintableMat = {
  mat: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;
  baseColor: THREE.Color;
};

type BunnyMaterials = {
  tintables: TintableMat[];
  clonedMaterials: THREE.Material[];
};

let templateReady = false;
let templateRoot: THREE.Group | null = null;
let clipByName = new Map<string, THREE.AnimationClip>();
let prefetchPromise: Promise<void> | null = null;

export function isFighterModelReady(): boolean {
  return templateReady;
}

export function prefetchFighterModel(): Promise<void> {
  if (prefetchPromise) return prefetchPromise;
  prefetchPromise = loadFighterModel().catch((err) => {
    console.error('Fighter GLB load failed; keeping capsule placeholders.', err);
    prefetchPromise = null;
  });
  return prefetchPromise;
}

async function loadFighterModel(): Promise<void> {
  const gltf = await new GLTFLoader().loadAsync(bunnyGlbUrl);
  const scene = gltf.scene;

  const box = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  box.getSize(size);
  const scale = size.y > 1e-6 ? TARGET_HEIGHT / size.y : 1;
  const yOffset = -box.min.y * scale;

  FIGHTER_MODEL_SCALE = scale;
  FIGHTER_MODEL_Y_OFFSET = yOffset;

  const prepared = new THREE.Group();
  prepared.name = 'fighterTemplate';
  scene.scale.setScalar(scale);
  scene.position.y = yOffset;
  scene.rotation.y = Math.PI;
  prepared.add(scene);

  const clips = new Map<string, THREE.AnimationClip>();
  for (const clip of gltf.animations) {
    clips.set(clip.name, clip);
  }

  templateRoot = prepared;
  clipByName = clips;
  templateReady = true;
}

export function createFighterVisual(): FighterVisual {
  if (!templateReady || !templateRoot) return createCapsulePlaceholder();
  return createBunnyVisual();
}

function createCapsulePlaceholder(): FighterVisual {
  const root = new THREE.Group();
  root.name = 'fighterPlaceholder';
  const mat = new THREE.MeshStandardMaterial({ color: 0x888888 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.9, 4, 8), mat);
  body.position.y = 0.9;
  body.castShadow = true;
  root.add(body);

  return {
    root,
    isPlaceholder: true,
    update(f, opts) {
      mat.color.setHex(opts.tintColor);
      if (f.stunRemaining > 0) mat.emissive.setHex(0x442200);
      else mat.emissive.setHex(0x000000);
    },
    dispose() {
      body.geometry.dispose();
      mat.dispose();
    },
  };
}

function createBunnyVisual(): FighterVisual {
  const root = new THREE.Group();
  root.name = 'fighterBunny';

  const cloned = SkeletonUtils.clone(templateRoot!) as THREE.Group;
  root.add(cloned);

  const { tintables, clonedMaterials } = collectTintables(cloned);
  const tintTmpColor = new THREE.Color();
  const mixer = new THREE.AnimationMixer(cloned);
  mixer.timeScale = ANIM_TIME_SCALE;
  const actions = new Map<string, THREE.AnimationAction>();

  function getAction(name: string): THREE.AnimationAction | null {
    let action = actions.get(name);
    if (action) return action;
    const clip = clipByName.get(name);
    if (!clip) return null;
    action = mixer.clipAction(clip);
    actions.set(name, action);
    return action;
  }

  let currentAction: THREE.AnimationAction | null = null;
  let currentActionName: string | null = null;
  let prevOnGround = true;
  let prevHitCooldown = 0;
  let attackPlaying = false;
  let jumpLandPlaying = false;

  const LEAVING_JUMP_CLIPS = new Set([
    CLIP_DAMAGE,
    CLIP_ATTACK,
    CLIP_JUMP_LAND,
    CLIP_IDLE,
    CLIP_WALK,
    CLIP_RUN,
  ]);

  function crossfadeTo(
    name: string,
    opts: { loop: THREE.AnimationActionLoopStyles; fade: number; clamp?: boolean },
  ) {
    const next = getAction(name);
    if (!next) return;
    if (currentActionName === name && currentAction?.isRunning()) return;

    if (LEAVING_JUMP_CLIPS.has(name)) {
      const jump = actions.get(CLIP_JUMP_START);
      if (jump?.paused) jump.paused = false;
    }

    next.reset();
    next.setLoop(opts.loop, Infinity);
    next.clampWhenFinished = opts.clamp ?? false;
    next.enabled = true;
    next.setEffectiveWeight(1);

    if (currentAction && currentAction !== next) {
      currentAction.crossFadeTo(next, opts.fade, false);
    } else {
      next.fadeIn(opts.fade);
    }
    next.play();
    currentAction = next;
    currentActionName = name;
  }

  function playOneShot(name: string): boolean {
    const next = getAction(name);
    if (!next) return false;
    crossfadeTo(name, {
      loop: THREE.LoopOnce,
      fade: ONESHOT_FADE,
      clamp: true,
    });
    return true;
  }

  function isActionFinished(name: string): boolean {
    const action = actions.get(name);
    if (!action) return true;
    const clip = action.getClip();
    return action.time >= clip.duration - 1e-3 || !action.isRunning();
  }

  // Start in idle so the first frame isn't T-pose.
  crossfadeTo(CLIP_IDLE, { loop: THREE.LoopRepeat, fade: 0 });

  return {
    root,
    isPlaceholder: false,
    update(f, opts, dt) {
      const tintStrength = opts.holding ? 0.85 : 0.55;
      for (const { mat, baseColor } of tintables) {
        mat.color.copy(baseColor).lerp(tintTmpColor.setHex(opts.tintColor), tintStrength);
        if (f.stunRemaining > 0) mat.emissive.setHex(0x442200);
        else mat.emissive.setHex(0x000000);
      }

      if (f.stunRemaining > 0) {
        attackPlaying = false;
        jumpLandPlaying = false;
        crossfadeTo(CLIP_DAMAGE, { loop: THREE.LoopRepeat, fade: ONESHOT_FADE });
      } else if (attackPlaying) {
        if (isActionFinished(CLIP_ATTACK)) {
          attackPlaying = false;
        }
      } else if (f.hitCooldownRemaining > prevHitCooldown + 1e-4) {
        attackPlaying = playOneShot(CLIP_ATTACK);
        jumpLandPlaying = false;
      } else if (!f.onGround) {
        jumpLandPlaying = false;
        if (prevOnGround) {
          playOneShot(CLIP_JUMP_START);
        } else if (currentActionName !== CLIP_JUMP_START) {
          crossfadeTo(CLIP_JUMP_START, {
            loop: THREE.LoopOnce,
            fade: ONESHOT_FADE,
            clamp: true,
          });
        } else {
          // Hold last frame of jump_start while airborne.
          const jump = actions.get(CLIP_JUMP_START);
          if (jump && isActionFinished(CLIP_JUMP_START)) {
            jump.paused = true;
          }
        }
      } else if (!prevOnGround || jumpLandPlaying) {
        if (!prevOnGround) {
          jumpLandPlaying = playOneShot(CLIP_JUMP_LAND);
        }
        if (jumpLandPlaying && isActionFinished(CLIP_JUMP_LAND)) {
          jumpLandPlaying = false;
          playLocomotion(f);
        }
      } else {
        playLocomotion(f);
      }

      prevOnGround = f.onGround;
      prevHitCooldown = f.hitCooldownRemaining;
      mixer.update(dt);
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(cloned);
      for (const mat of clonedMaterials) mat.dispose();
    },
  };

  function playLocomotion(f: FighterSnapshot) {
    const speed = Math.hypot(f.vx, f.vz);
    let name = CLIP_IDLE;
    if (speed > RUN_SPEED) name = CLIP_RUN;
    else if (speed > WALK_SPEED) name = CLIP_WALK;
    crossfadeTo(name, { loop: THREE.LoopRepeat, fade: LOCO_FADE });
  }
}

function collectTintables(root: THREE.Object3D): BunnyMaterials {
  const tintables: TintableMat[] = [];
  const clonedMaterials: THREE.Material[] = [];
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) && !(obj instanceof THREE.SkinnedMesh)) return;
    obj.castShadow = true;

    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const clonedMats: THREE.Material[] = [];
    for (const m of mats) {
      const cloned = m.clone();
      clonedMats.push(cloned);
      clonedMaterials.push(cloned);
      if (
        cloned instanceof THREE.MeshStandardMaterial ||
        cloned instanceof THREE.MeshPhysicalMaterial
      ) {
        const sum = cloned.color.r + cloned.color.g + cloned.color.b;
        if (sum > 0.08) {
          tintables.push({ mat: cloned, baseColor: cloned.color.clone() });
        }
      }
    }
    obj.material = Array.isArray(obj.material) ? clonedMats : clonedMats[0]!;
  });
  return { tintables, clonedMaterials };
}
