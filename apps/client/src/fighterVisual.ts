import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { MOVEMENT } from '@crowntag/content';
import type { FighterSnapshot } from '@crowntag/protocol';
import bunnyGlbUrl from './assets/models/characters/Mesh_BunnyChar_00.glb';
import { createBunnyRagdoll, initRagdollPhysics } from './bunnyRagdoll';
import { captureBonePose, createPoseBlend } from './ragdollBlend';

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

const RAGDOLL_MAX_SEC = 2.0;
const SETTLE_HOLD_SEC = 0.25;
const RECOVER_BLEND_SEC = 0.35;

export type FighterVisual = {
  root: THREE.Group;
  isPlaceholder?: boolean;
  /** True while ragdoll is active or kinematic recover blend owns the pose. */
  ownsRootTransform?: () => boolean;
  /** Soft-network / event path: start knockdown with hit impulse. */
  triggerStunRagdoll?: (impulse: { vx: number; vz: number }) => void;
  /**
   * True once when knockdown → recover; scene snaps display pose to authority.
   * Cleared when read.
   */
  consumePoseSnapRequest?: () => boolean;
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
  const [, gltf] = await Promise.all([
    initRagdollPhysics(),
    new GLTFLoader().loadAsync(bunnyGlbUrl),
  ]);
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

  // Capture bind pose before idle plays — bone locals are still bind.
  const bindPoseSamples = captureBonePose(root);

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

  type RagdollPhase = 'none' | 'knockdown' | 'recover';
  const ragdoll = createBunnyRagdoll(root);
  let ragdollPhase: RagdollPhase = 'none';
  let ragdollElapsed = 0;
  let settleHold = 0;
  let poseBlend: ReturnType<typeof createPoseBlend> | null = null;
  let blending = false;
  let poseSnapRequest = false;
  let currentAction: THREE.AnimationAction | null = null;
  let currentActionName: string | null = null;
  let prevOnGround = true;
  let prevHitCooldown = 0;
  let prevStun = 0;
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

  function beginKnockdown(vx: number, vz: number) {
    if (ragdollPhase === 'knockdown' || ragdollPhase === 'recover') return;
    mixer.stopAllAction();
    currentAction = null;
    currentActionName = null;
    attackPlaying = false;
    jumpLandPlaying = false;
    ragdoll.enable({ vx, vz });
    ragdoll.setPoseStrength(0);
    ragdollPhase = 'knockdown';
    ragdollElapsed = 0;
    settleHold = 0;
    poseBlend = null;
    blending = false;
  }

  function beginRecover() {
    if (ragdollPhase !== 'knockdown') return;
    const from = captureBonePose(root);
    if (ragdoll.active) ragdoll.disable();
    blending = true;
    poseBlend = createPoseBlend({
      root,
      from,
      to: bindPoseSamples,
      durationSec: RECOVER_BLEND_SEC,
    });
    ragdollPhase = 'recover';
    poseSnapRequest = true;
  }

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
    ownsRootTransform: () => ragdoll.active || blending,
    triggerStunRagdoll(impulse) {
      beginKnockdown(impulse.vx, impulse.vz);
    },
    consumePoseSnapRequest() {
      if (!poseSnapRequest) return false;
      poseSnapRequest = false;
      return true;
    },
    update(f, opts, dt) {
      const tintStrength = opts.holding ? 0.85 : 0.55;
      for (const { mat, baseColor } of tintables) {
        mat.color.copy(baseColor).lerp(tintTmpColor.setHex(opts.tintColor), tintStrength);
        if (f.stunRemaining > 0) mat.emissive.setHex(0x442200);
        else mat.emissive.setHex(0x000000);
      }

      const stunEnter = f.stunRemaining > 0 && prevStun <= 0;
      const stunExit = prevStun > 0 && f.stunRemaining <= 0;

      // Snapshot fallback (offline / missed event). Event path already sets knockdown.
      if (stunEnter && ragdollPhase === 'none') {
        beginKnockdown(f.vx, f.vz);
      }

      if (ragdollPhase === 'knockdown' && ragdoll.active) {
        ragdoll.step(dt);
        ragdollElapsed += dt;
        if (ragdoll.isSettled(0.8, 2.0)) settleHold += dt;
        else settleHold = 0;
        if (
          settleHold >= SETTLE_HOLD_SEC ||
          ragdollElapsed >= RAGDOLL_MAX_SEC ||
          stunExit
        ) {
          beginRecover();
        }
      } else if (ragdollPhase === 'knockdown' && stunExit) {
        // Ragdoll already disabled somehow — still reconverge.
        beginRecover();
      } else if (ragdollPhase === 'recover' && poseBlend) {
        const done = poseBlend.update(dt);
        if (done) {
          blending = false;
          poseBlend = null;
          ragdollPhase = 'none';
          crossfadeTo(CLIP_IDLE, { loop: THREE.LoopRepeat, fade: LOCO_FADE });
        }
      } else if (ragdollPhase === 'none' && !ragdoll.active) {
        if (attackPlaying) {
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
      }

      prevOnGround = f.onGround;
      prevHitCooldown = f.hitCooldownRemaining;
      prevStun = f.stunRemaining;
      if (!ragdoll.active && !blending) mixer.update(dt);
    },
    dispose() {
      ragdoll.dispose();
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
