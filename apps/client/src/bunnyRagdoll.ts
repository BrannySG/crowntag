import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  approxCapsuleInertia,
  createBunnyPoseController,
  type PoseController,
  type PoseHandle,
} from './bunnyPoseController';
import { ragdollTuning } from './ragdollTuning';

/** Collision group membership bits (upper 16 of InteractionGroups). */
const GROUP_PART = 0x0001;
const GROUP_FLOOR = 0x0002;

/**
 * Rapier InteractionGroups: (membership << 16) | filterMask
 * Parts collide only with floor; floor only with parts — not part↔part.
 */
const COLLISION_PART = (GROUP_PART << 16) | GROUP_FLOOR; // 0x00010002
const COLLISION_FLOOR = (GROUP_FLOOR << 16) | GROUP_PART; // 0x00020001

/** Canonical part ids. GLB may author joints as armL or arm.L. */
type BoneName =
  | 'hips'
  | 'torso'
  | 'head'
  | 'armL'
  | 'armR'
  | 'legL'
  | 'legR'
  | 'earL'
  | 'earR'
  | 'muzzle'
  | 'tail';

const NAME_ALIASES: Record<BoneName, string[]> = {
  hips: ['hips'],
  torso: ['torso'],
  head: ['head'],
  armL: ['armL', 'arm.L'],
  armR: ['armR', 'arm.R'],
  legL: ['legL', 'leg.L'],
  legR: ['legR', 'leg.R'],
  earL: ['earL', 'ear.L'],
  earR: ['earR', 'ear.R'],
  muzzle: ['muzzle'],
  tail: ['tail'],
};

/** Normalize bone name for cross-skeleton matching (arm.L ↔ armL). */
function normalizeBoneName(name: string): string {
  return name.replace(/\./g, '');
}

type JointKind = 'spherical' | 'revolute';

/** Topology only — sizes/masses measured at create from bind pose. */
type PartTopo = {
  name: BoneName;
  parent: BoneName | null;
  joint: JointKind;
  /** Local axis for revolute joints (parent/child body space). */
  hingeAxis?: { x: number; y: number; z: number };
  massScale: number;
  angularDamping: number;
  /** Radius multiplier vs length (hips/torso fatter). */
  radiusMul: number;
  halfHeightMul: number;
};

type SecondaryTopo = {
  name: BoneName;
  parent: BoneName;
};

/** Physics bodies only — write order: parents before children. */
const PHYSICS_PARTS: PartTopo[] = [
  {
    name: 'hips',
    parent: null,
    joint: 'spherical',
    massScale: 1.2,
    angularDamping: 1.8,
    radiusMul: 0.28,
    halfHeightMul: 0.32,
  },
  {
    name: 'torso',
    parent: 'hips',
    joint: 'spherical',
    massScale: 1.0,
    angularDamping: 1.6,
    radiusMul: 0.24,
    halfHeightMul: 0.35,
  },
  {
    name: 'head',
    parent: 'torso',
    joint: 'spherical',
    massScale: 0.7,
    angularDamping: 2.0,
    radiusMul: 0.22,
    halfHeightMul: 0.32,
  },
  {
    name: 'armL',
    parent: 'torso',
    joint: 'spherical',
    massScale: 0.5,
    angularDamping: 3.2,
    radiusMul: 0.16,
    halfHeightMul: 0.36,
  },
  {
    name: 'armR',
    parent: 'torso',
    joint: 'spherical',
    massScale: 0.5,
    angularDamping: 3.2,
    radiusMul: 0.16,
    halfHeightMul: 0.36,
  },
  {
    name: 'legL',
    parent: 'hips',
    joint: 'revolute',
    hingeAxis: { x: 1, y: 0, z: 0 },
    massScale: 0.6,
    angularDamping: 3.0,
    radiusMul: 0.17,
    halfHeightMul: 0.36,
  },
  {
    name: 'legR',
    parent: 'hips',
    joint: 'revolute',
    hingeAxis: { x: 1, y: 0, z: 0 },
    massScale: 0.6,
    angularDamping: 3.0,
    radiusMul: 0.17,
    halfHeightMul: 0.36,
  },
];

/** Kinematic spring-follow bones (no Rapier bodies). */
const SECONDARY_PARTS: SecondaryTopo[] = [
  { name: 'earL', parent: 'head' },
  { name: 'earR', parent: 'head' },
  { name: 'muzzle', parent: 'head' },
  { name: 'tail', parent: 'hips' },
];

const REQUIRED: BoneName[] = ['hips', 'torso', 'head', 'armL', 'armR', 'legL', 'legR'];

/** Fallback length when a root part has no parent distance. */
const ROOT_FALLBACK_LENGTH = 0.28;

export type BunnyRagdollEnableOpts = {
  vx: number;
  vz: number;
  /** World Y of the floor surface; collider center sits slightly below. Default 0. */
  floorY?: number;
};

export type RagdollDebugBody = {
  name: string;
  translation: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  halfHeight: number;
  radius: number;
};

export type RagdollMetrics = {
  totalLinvel: number;
  totalAngvel: number;
  maxJointSeparation: number;
};

export type BunnyRagdoll = {
  enable(opts: BunnyRagdollEnableOpts): void;
  step(dt: number): void;
  disable(): void;
  dispose(): void;
  readonly active: boolean;
  /** True while ragdoll owns bone/root world pose (scene should freeze root). */
  readonly ownsRootTransform: boolean;
  /** False when required bones were missing and this is a noop stub. */
  readonly ok: boolean;
  /** Active rigid bodies + bones for PD / debug. Null when inactive. */
  getActiveParts(): PoseHandle[] | null;
  /** Capsule pose/size snapshot for lab debug draw. Empty when inactive. */
  getDebugBodies(): RagdollDebugBody[];
  /** Capture current bone world rotations as stand targets. */
  captureStandPose(): void;
  /** 0 = limp, 1 = full PD stand. Applied inside step() before world.step. */
  setPoseStrength(s: number): void;
  getPoseStrength(): number;
  /** Aggregate motion / joint stretch for settle detection. */
  getMetrics(): RagdollMetrics;
  /** True when total linvel/angvel are below thresholds. */
  isSettled(linvelThresh?: number, angvelThresh?: number): boolean;
};

let initPromise: Promise<void> | null = null;
let rapierReady = false;

export async function initRagdollPhysics(): Promise<void> {
  if (rapierReady) return;
  if (!initPromise) {
    initPromise = RAPIER.init().then(() => {
      rapierReady = true;
    });
  }
  await initPromise;
}

/** All unique skeleton bone names under root (for diagnostics). */
export function listSkeletonBoneNames(root: THREE.Object3D): string[] {
  const names = new Set<string>();
  root.traverse((obj) => {
    if (!(obj instanceof THREE.SkinnedMesh) || !obj.skeleton) return;
    for (const bone of obj.skeleton.bones) {
      if (bone.name) names.add(bone.name);
    }
  });
  return [...names].sort();
}

function countSkinnedMeshes(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((obj) => {
    if (obj instanceof THREE.SkinnedMesh && obj.skeleton) n++;
  });
  return n;
}

/**
 * Collect skeleton bones keyed by every alias / normalized form.
 * Only THREE.Bone instances from SkinnedMesh.skeleton.bones.
 */
function collectSkeletonBones(root: THREE.Object3D): Map<string, THREE.Bone> {
  const bones = new Map<string, THREE.Bone>();
  root.traverse((obj) => {
    if (!(obj instanceof THREE.SkinnedMesh) || !obj.skeleton) return;
    for (const bone of obj.skeleton.bones) {
      if (!bone.name) continue;
      if (!bones.has(bone.name)) bones.set(bone.name, bone);
      const norm = normalizeBoneName(bone.name);
      if (!bones.has(norm)) bones.set(norm, bone);
    }
  });
  return bones;
}

/** Resolve a part to a real skeleton Bone via aliases. Never returns non-Bone Object3D. */
function resolveSkeletonBone(
  name: BoneName,
  skeletonBones: Map<string, THREE.Bone>,
): THREE.Bone | null {
  for (const alias of NAME_ALIASES[name]) {
    const bone = skeletonBones.get(alias) ?? skeletonBones.get(normalizeBoneName(alias));
    if (bone) return bone;
  }
  return null;
}

function capsuleVolume(halfHeight: number, radius: number): number {
  // π r² (2h) + (4/3) π r³
  return Math.PI * radius * radius * (2 * halfHeight) + (4 / 3) * Math.PI * radius * radius * radius;
}

function createNoopRagdoll(): BunnyRagdoll {
  return {
    get active() {
      return false;
    },
    get ownsRootTransform() {
      return false;
    },
    get ok() {
      return false;
    },
    enable() {},
    step() {},
    disable() {},
    dispose() {},
    getActiveParts() {
      return null;
    },
    getDebugBodies() {
      return [];
    },
    captureStandPose() {},
    setPoseStrength() {},
    getPoseStrength() {
      return 0;
    },
    getMetrics() {
      return { totalLinvel: 0, totalAngvel: 0, maxJointSeparation: 0 };
    },
    isSettled() {
      return true;
    },
  };
}

type BonePart = {
  topo: PartTopo;
  bone: THREE.Bone;
  body: RAPIER.RigidBody | null;
  /**
   * Joint anchor in parent body space (child bone local position).
   * Refreshed at enable() from current bone.position so anchors match spawn pose.
   */
  jointAnchorLocal: THREE.Vector3;
  /** Measured capsule half-height (cylinder section). */
  halfHeight: number;
  /** Measured capsule radius. */
  radius: number;
  /** Mass from density × volume × massScale. */
  mass: number;
  inertia: number;
  /** Longest joint lever arm from body center (for angular inertia sizing). */
  leverHalf: number;
};

type SecondaryPart = {
  topo: SecondaryTopo;
  bone: THREE.Bone;
  bindLocalQuat: THREE.Quaternion;
  bindLocalPos: THREE.Vector3;
  /** Local angular velocity state for spring damping (axis-angle /s). */
  angVel: THREE.Vector3;
};

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _bodyMat = new THREE.Matrix4();
const _localMat = new THREE.Matrix4();
const _one = new THREE.Vector3(1, 1, 1);
const _impulseDir = new THREE.Vector3();
const _omega = new THREE.Vector3();
const _bindWorld = new THREE.Vector3();
const _parentPos = new THREE.Vector3();
const _childUp = new THREE.Vector3();
const _parentUp = new THREE.Vector3();
const _coneAxis = new THREE.Vector3();
const _qChild = new THREE.Quaternion();
const _qParent = new THREE.Quaternion();
const _qErr = new THREE.Quaternion();
const _secAxis = new THREE.Vector3();

function mirrorBonesToAllSkeletons(
  root: THREE.Object3D,
  primaryByNorm: Map<string, THREE.Bone>,
) {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.SkinnedMesh) || !obj.skeleton) return;
    for (const bone of obj.skeleton.bones) {
      const primary = primaryByNorm.get(normalizeBoneName(bone.name));
      if (primary && bone !== primary) {
        bone.position.copy(primary.position);
        bone.quaternion.copy(primary.quaternion);
        // leave bone.scale alone (bind)
      }
    }
    obj.skeleton.update();
  });
}

function buildPoseHandles(parts: BonePart[], partByName: Map<BoneName, BonePart>): PoseHandle[] {
  const handles: PoseHandle[] = [];
  for (const p of parts) {
    if (!p.body) continue;
    const parentBody = p.topo.parent ? (partByName.get(p.topo.parent)?.body ?? null) : null;
    handles.push({
      name: p.topo.name,
      bone: p.bone,
      body: p.body,
      parentBody,
      inertia: p.inertia,
      halfHeight: p.halfHeight,
      radius: p.radius,
      mass: p.mass,
    });
  }
  return handles;
}

export function createBunnyRagdoll(root: THREE.Object3D): BunnyRagdoll {
  const skeletonBones = collectSkeletonBones(root);
  const availableNames = listSkeletonBoneNames(root);
  const skinnedCount = countSkinnedMeshes(root);
  console.info('[bunnyRagdoll] bones:', availableNames, 'skinnedMeshes:', skinnedCount);

  const bones = new Map<BoneName, THREE.Bone>();
  for (const part of PHYSICS_PARTS) {
    const bone = resolveSkeletonBone(part.name, skeletonBones);
    if (bone) bones.set(part.name, bone);
  }
  for (const part of SECONDARY_PARTS) {
    const bone = resolveSkeletonBone(part.name, skeletonBones);
    if (bone) bones.set(part.name, bone);
  }

  const missing = REQUIRED.filter((name) => !bones.has(name));
  if (missing.length > 0) {
    console.error(
      `[bunnyRagdoll] missing required bones: ${missing.join(', ')}; available: ${availableNames.join(', ')}; ragdoll disabled`,
    );
    return createNoopRagdoll();
  }

  // Bind-pose world positions before any animation mutates bones.
  root.updateWorldMatrix(true, true);
  const bindWorldPos = new Map<BoneName, THREE.Vector3>();
  for (const [name, bone] of bones) {
    bone.getWorldPosition(_bindWorld);
    bindWorldPos.set(name, _bindWorld.clone());
  }

  const density = ragdollTuning.massDensity;
  const parts: BonePart[] = [];
  for (const topo of PHYSICS_PARTS) {
    const bone = bones.get(topo.name);
    if (!bone) continue;

    let length = ROOT_FALLBACK_LENGTH;
    if (topo.parent) {
      const childPos = bindWorldPos.get(topo.name);
      const parentPos = bindWorldPos.get(topo.parent);
      if (childPos && parentPos) {
        length = Math.max(0.06, childPos.distanceTo(parentPos));
      } else {
        length = Math.max(0.06, bone.position.length());
      }
    } else {
      const torsoPos = bindWorldPos.get('torso');
      const hipsPos = bindWorldPos.get('hips');
      if (torsoPos && hipsPos) {
        length = Math.max(0.08, hipsPos.distanceTo(torsoPos));
      }
    }

    const halfHeight = Math.max(0.04, length * topo.halfHeightMul);
    const radius = Math.max(0.03, length * topo.radiusMul);
    const volume = capsuleVolume(halfHeight, radius);
    const mass = Math.max(0.05, density * volume * topo.massScale);
    const inertia = approxCapsuleInertia(mass, halfHeight, radius);

    // Longest lever: this body's own extent or the farthest child joint anchor.
    let leverHalf = halfHeight + radius;
    const myBind = bindWorldPos.get(topo.name);
    if (myBind) {
      for (const other of PHYSICS_PARTS) {
        if (other.parent !== topo.name) continue;
        const childBind = bindWorldPos.get(other.name);
        if (!childBind) continue;
        const d = myBind.distanceTo(childBind);
        if (d > leverHalf) leverHalf = d;
      }
    }

    parts.push({
      topo,
      bone,
      body: null,
      jointAnchorLocal: bone.position.clone(),
      halfHeight,
      radius,
      mass,
      inertia,
      leverHalf,
    });
  }

  const secondaryParts: SecondaryPart[] = [];
  for (const topo of SECONDARY_PARTS) {
    const bone = bones.get(topo.name);
    if (!bone) continue;
    secondaryParts.push({
      topo,
      bone,
      bindLocalQuat: bone.quaternion.clone(),
      bindLocalPos: bone.position.clone(),
      angVel: new THREE.Vector3(),
    });
  }

  console.info(
    '[bunnyRagdoll] measured parts:',
    parts.map((p) => ({
      name: p.topo.name,
      halfHeight: +p.halfHeight.toFixed(3),
      radius: +p.radius.toFixed(3),
      mass: +p.mass.toFixed(3),
    })),
    'secondary:',
    secondaryParts.map((s) => s.topo.name),
  );

  const partByName = new Map<BoneName, BonePart>();
  for (const p of parts) partByName.set(p.topo.name, p);

  /** Primary bones keyed by normalized name for cross-skeleton mirroring. */
  const primaryByNorm = new Map<string, THREE.Bone>();
  for (const p of parts) {
    primaryByNorm.set(normalizeBoneName(p.bone.name), p.bone);
    primaryByNorm.set(normalizeBoneName(p.topo.name), p.bone);
  }
  for (const s of secondaryParts) {
    primaryByNorm.set(normalizeBoneName(s.bone.name), s.bone);
    primaryByNorm.set(normalizeBoneName(s.topo.name), s.bone);
  }

  let world: RAPIER.World | null = null;
  let active = false;
  let poseStrength = 0;
  let accum = 0;

  const poseController: PoseController = createBunnyPoseController(() => {
    if (!active) return null;
    const handles = buildPoseHandles(parts, partByName);
    return handles.length > 0 ? handles : null;
  });

  function freeWorld() {
    if (world) {
      world.free();
      world = null;
    }
    for (const p of parts) p.body = null;
    active = false;
    poseStrength = 0;
    accum = 0;
    poseController.setStrength(0);
    for (const s of secondaryParts) s.angVel.set(0, 0, 0);
  }

  function writeBonesFromBodies() {
    // Parents before children so parent.matrixWorld is current.
    for (const p of parts) {
      if (!p.body) continue;
      const t = p.body.translation();
      const r = p.body.rotation();
      _pos.set(t.x, t.y, t.z);
      _quat.set(r.x, r.y, r.z, r.w);
      _bodyMat.compose(_pos, _quat, _one);

      const parent = p.bone.parent;
      if (parent) {
        parent.updateWorldMatrix(true, false);
        _localMat.copy(parent.matrixWorld).invert().multiply(_bodyMat);
        // Decompose into temps — never overwrite bone.scale (keep bind scale).
        _localMat.decompose(_pos, _quat, _scale);
        p.bone.position.copy(_pos);
        p.bone.quaternion.copy(_quat);
      } else {
        p.bone.position.copy(_pos);
        p.bone.quaternion.copy(_quat);
      }
      p.bone.updateMatrix();
      p.bone.matrixWorldNeedsUpdate = true;
    }
    root.updateMatrixWorld(true);
    mirrorBonesToAllSkeletons(root, primaryByNorm);
  }

  function clampVelocities() {
    const { maxLinvel, maxAngvel } = ragdollTuning;
    for (const p of parts) {
      if (!p.body) continue;
      const lv = p.body.linvel();
      const linSpeed = Math.hypot(lv.x, lv.y, lv.z);
      if (linSpeed > maxLinvel) {
        const s = maxLinvel / linSpeed;
        p.body.setLinvel({ x: lv.x * s, y: lv.y * s, z: lv.z * s }, true);
      }
      const av = p.body.angvel();
      const angSpeed = Math.hypot(av.x, av.y, av.z);
      if (angSpeed > maxAngvel) {
        const s = maxAngvel / angSpeed;
        p.body.setAngvel({ x: av.x * s, y: av.y * s, z: av.z * s }, true);
      }
    }
  }

  /**
   * Soft cone clamp for torso/head spherical joints.
   * If child's +Y drifts beyond the cone vs parent's +Y, apply corrective torque pair.
   */
  function applySwingClamps() {
    const pairs: { child: BoneName; parent: BoneName; limit: number }[] = [
      { child: 'torso', parent: 'hips', limit: ragdollTuning.torsoConeLimit },
      { child: 'head', parent: 'torso', limit: ragdollTuning.headConeLimit },
    ];
    const kp = ragdollTuning.coneClampKp;
    const maxT = ragdollTuning.maxTorque;

    for (const { child, parent, limit } of pairs) {
      const childPart = partByName.get(child);
      const parentPart = partByName.get(parent);
      if (!childPart?.body || !parentPart?.body) continue;

      const cr = childPart.body.rotation();
      const pr = parentPart.body.rotation();
      _qChild.set(cr.x, cr.y, cr.z, cr.w);
      _qParent.set(pr.x, pr.y, pr.z, pr.w);

      _childUp.set(0, 1, 0).applyQuaternion(_qChild);
      _parentUp.set(0, 1, 0).applyQuaternion(_qParent);

      const dot = Math.min(1, Math.max(-1, _childUp.dot(_parentUp)));
      const angle = Math.acos(dot);
      if (angle <= limit) continue;

      const overage = angle - limit;
      _coneAxis.crossVectors(_childUp, _parentUp);
      if (_coneAxis.lengthSq() < 1e-10) continue;
      _coneAxis.normalize();

      // Torque that rotates child toward parent up (and opposite on parent).
      let tx = kp * overage * _coneAxis.x;
      let ty = kp * overage * _coneAxis.y;
      let tz = kp * overage * _coneAxis.z;
      const mag = Math.hypot(tx, ty, tz);
      if (mag > maxT) {
        const scale = maxT / mag;
        tx *= scale;
        ty *= scale;
        tz *= scale;
      }
      childPart.body.addTorque({ x: tx, y: ty, z: tz }, true);
      parentPart.body.addTorque({ x: -tx, y: -ty, z: -tz }, true);
    }
  }

  /**
   * Kinematic PD spring on secondary bone local quaternions toward bind.
   * Runs after physics write so ears/muzzle/tail flop relative to head/hips.
   */
  function applySecondarySprings(dt: number) {
    if (dt <= 0 || secondaryParts.length === 0) return;
    const kp = ragdollTuning.secondarySpringKp;
    const kd = ragdollTuning.secondarySpringKd;

    for (const s of secondaryParts) {
      // Keep bind local position (physics parents move; secondary stays attached).
      s.bone.position.copy(s.bindLocalPos);

      _qErr.copy(s.bindLocalQuat).multiply(s.bone.quaternion.clone().invert());
      if (_qErr.w < 0) {
        _qErr.x = -_qErr.x;
        _qErr.y = -_qErr.y;
        _qErr.z = -_qErr.z;
        _qErr.w = -_qErr.w;
      }

      const angle = 2 * Math.acos(Math.min(1, Math.max(-1, _qErr.w)));
      if (angle > 1e-5) {
        const sinHalf = Math.sin(angle / 2);
        _secAxis.set(_qErr.x / sinHalf, _qErr.y / sinHalf, _qErr.z / sinHalf).normalize();
        // τ-like accel in local space → integrate angVel
        s.angVel.x += (kp * angle * _secAxis.x - kd * s.angVel.x) * dt;
        s.angVel.y += (kp * angle * _secAxis.y - kd * s.angVel.y) * dt;
        s.angVel.z += (kp * angle * _secAxis.z - kd * s.angVel.z) * dt;
      } else {
        s.angVel.x += -kd * s.angVel.x * dt;
        s.angVel.y += -kd * s.angVel.y * dt;
        s.angVel.z += -kd * s.angVel.z * dt;
      }

      const speed = s.angVel.length();
      if (speed > 1e-6) {
        const stepAngle = speed * dt;
        _secAxis.copy(s.angVel).multiplyScalar(1 / speed);
        _quat.setFromAxisAngle(_secAxis, stepAngle);
        s.bone.quaternion.premultiply(_quat).normalize();
      }

      s.bone.updateMatrix();
      s.bone.matrixWorldNeedsUpdate = true;
    }

    root.updateMatrixWorld(true);
    mirrorBonesToAllSkeletons(root, primaryByNorm);
  }

  function computeMetrics(): RagdollMetrics {
    let totalLinvel = 0;
    let totalAngvel = 0;
    let maxJointSeparation = 0;

    for (const p of parts) {
      if (!p.body) continue;
      const lv = p.body.linvel();
      const av = p.body.angvel();
      totalLinvel += Math.hypot(lv.x, lv.y, lv.z);
      totalAngvel += Math.hypot(av.x, av.y, av.z);

      if (!p.topo.parent) continue;
      const parentPart = partByName.get(p.topo.parent);
      if (!parentPart?.body) continue;

      // Child body origin should sit at parent * jointAnchorLocal.
      const ct = p.body.translation();
      const pt = parentPart.body.translation();
      const pr = parentPart.body.rotation();
      _qParent.set(pr.x, pr.y, pr.z, pr.w);
      _pos.copy(p.jointAnchorLocal).applyQuaternion(_qParent);
      _pos.x += pt.x;
      _pos.y += pt.y;
      _pos.z += pt.z;
      const sep = Math.hypot(ct.x - _pos.x, ct.y - _pos.y, ct.z - _pos.z);
      if (sep > maxJointSeparation) maxJointSeparation = sep;
    }

    return { totalLinvel, totalAngvel, maxJointSeparation };
  }

  return {
    get active() {
      return active;
    },

    get ownsRootTransform() {
      return active;
    },

    get ok() {
      return true;
    },

    getActiveParts() {
      if (!active) return null;
      const handles = buildPoseHandles(parts, partByName);
      return handles.length > 0 ? handles : null;
    },

    getDebugBodies() {
      if (!active) return [];
      const out: RagdollDebugBody[] = [];
      for (const p of parts) {
        if (!p.body) continue;
        const t = p.body.translation();
        const r = p.body.rotation();
        out.push({
          name: p.topo.name,
          translation: { x: t.x, y: t.y, z: t.z },
          rotation: { x: r.x, y: r.y, z: r.z, w: r.w },
          halfHeight: p.halfHeight,
          radius: p.radius,
        });
      }
      return out;
    },

    captureStandPose() {
      poseController.captureTargetsFromBones();
      // Refresh secondary bind from current local pose (idle/stand).
      for (const s of secondaryParts) {
        s.bindLocalQuat.copy(s.bone.quaternion);
        s.bindLocalPos.copy(s.bone.position);
        s.angVel.set(0, 0, 0);
      }
    },

    setPoseStrength(s: number) {
      poseStrength = Math.min(1, Math.max(0, s));
      poseController.setStrength(poseStrength);
    },

    getPoseStrength() {
      return poseStrength;
    },

    getMetrics() {
      if (!active) return { totalLinvel: 0, totalAngvel: 0, maxJointSeparation: 0 };
      return computeMetrics();
    },

    isSettled(linvelThresh = 0.35, angvelThresh = 0.8) {
      if (!active) return true;
      const m = computeMetrics();
      return m.totalLinvel < linvelThresh && m.totalAngvel < angvelThresh;
    },

    enable(hit: BunnyRagdollEnableOpts) {
      if (!rapierReady) {
        console.warn('[bunnyRagdoll] Rapier not initialized; call initRagdollPhysics() first');
        return;
      }
      freeWorld();

      root.updateWorldMatrix(true, true);

      // Joint anchors in parent BODY space (world rotation/scale applied) so they
      // match the world-space rigid bodies exactly — skeleton-local bone.position
      // ignores model scale + root yaw and would spawn joints pre-violated.
      for (const p of parts) {
        if (!p.topo.parent) {
          p.jointAnchorLocal.set(0, 0, 0);
          continue;
        }
        const parentPart = partByName.get(p.topo.parent);
        if (!parentPart) continue;
        parentPart.bone.getWorldPosition(_parentPos);
        parentPart.bone.getWorldQuaternion(_qParent);
        p.bone.getWorldPosition(_pos);
        p.jointAnchorLocal
          .copy(_pos)
          .sub(_parentPos)
          .applyQuaternion(_qParent.invert());
      }
      for (const s of secondaryParts) {
        s.bindLocalQuat.copy(s.bone.quaternion);
        s.bindLocalPos.copy(s.bone.position);
        s.angVel.set(0, 0, 0);
      }

      const floorY = hit.floorY ?? 0;
      const { gravityY, linearDamping, solverIterations, fixedDt } = ragdollTuning;
      world = new RAPIER.World({ x: 0, y: gravityY, z: 0 });
      world.timestep = fixedDt;
      // Spherical joints have no cone limits in Rapier 0.19 — bump solver iters to reduce stretch.
      world.numSolverIterations = solverIterations;

      const floorBody = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(0, floorY - 0.05, 0),
      );
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(50, 0.05, 50)
          .setCollisionGroups(COLLISION_FLOOR)
          .setSolverGroups(COLLISION_FLOOR),
        floorBody,
      );

      for (const p of parts) {
        p.bone.getWorldPosition(_pos);
        p.bone.getWorldQuaternion(_quat);

        // Mass only on collider — do not also setAdditionalMass (double mass / bad inertia).
        const desc = RAPIER.RigidBodyDesc.dynamic()
          .setLinearDamping(linearDamping)
          .setAngularDamping(p.topo.angularDamping)
          .setCanSleep(false)
          .setCcdEnabled(true)
          .setTranslation(_pos.x, _pos.y, _pos.z)
          .setRotation({ x: _quat.x, y: _quat.y, z: _quat.z, w: _quat.w });

        const body = world.createRigidBody(desc);
        // Angular inertia sized to the longest joint lever (not the small capsule) —
        // default shape inertia is so tiny the joint solver overshoots and pumps energy.
        const inertia =
          approxCapsuleInertia(p.mass, p.leverHalf, p.radius) * ragdollTuning.inertiaScale;
        p.inertia = inertia;
        const collider = RAPIER.ColliderDesc.capsule(p.halfHeight, p.radius)
          .setMassProperties(
            p.mass,
            { x: 0, y: 0, z: 0 },
            { x: inertia, y: inertia, z: inertia },
            { x: 0, y: 0, z: 0, w: 1 },
          )
          .setCollisionGroups(COLLISION_PART)
          .setSolverGroups(COLLISION_PART);
        world.createCollider(collider, body);
        p.body = body;
      }

      // Joints: child origin ↔ parent at child's current local offset (refreshed above).
      const { revoluteLimitMin, revoluteLimitMax } = ragdollTuning;
      for (const p of parts) {
        if (!p.topo.parent || !p.body) continue;
        const parentPart = partByName.get(p.topo.parent);
        if (!parentPart?.body) continue;

        const anchor1 = {
          x: p.jointAnchorLocal.x,
          y: p.jointAnchorLocal.y,
          z: p.jointAnchorLocal.z,
        };
        const anchor2 = { x: 0, y: 0, z: 0 };

        let jointParams: RAPIER.JointData;
        if (p.topo.joint === 'revolute' && p.topo.hingeAxis) {
          jointParams = RAPIER.JointData.revolute(anchor1, anchor2, p.topo.hingeAxis);
        } else {
          jointParams = RAPIER.JointData.spherical(anchor1, anchor2);
        }
        const joint = world.createImpulseJoint(jointParams, parentPart.body, p.body, true);
        // RevoluteImpulseJoint extends UnitImpulseJoint — setLimits exists only on unit joints.
        // SphericalImpulseJoint has no cone-limit API in Rapier 0.19.
        if (joint.type() === RAPIER.JointType.Revolute) {
          (joint as RAPIER.RevoluteImpulseJoint).setLimits(revoluteLimitMin, revoluteLimitMax);
        }
      }

      // Tumble: limp by default (pose strength 0). Lab Stand/Get-up ramps PD separately.
      poseStrength = 0;
      poseController.setStrength(0);
      accum = 0;

      // Skip impulse entirely for stand (vx===0 && vz===0).
      const hasImpulse = Math.abs(hit.vx) + Math.abs(hit.vz) > 1e-4;
      if (hasImpulse) {
        const { impulseScale, impulseUp, angularKick } = ragdollTuning;
        const impulseVec = {
          x: hit.vx * impulseScale,
          y: impulseUp,
          z: hit.vz * impulseScale,
        };

        _impulseDir.set(hit.vx, 0, hit.vz);
        if (_impulseDir.lengthSq() < 1e-6) _impulseDir.set(1, 0, 0);
        else _impulseDir.normalize();
        // ω from up × impulse direction → tumble/roll away from hit.
        _omega.set(0, 1, 0).cross(_impulseDir).multiplyScalar(angularKick);

        for (const name of ['torso', 'hips'] as BoneName[]) {
          const part = partByName.get(name);
          if (!part?.body) continue;
          part.body.applyImpulse(impulseVec, true);
          part.body.setAngvel({ x: _omega.x, y: _omega.y, z: _omega.z }, true);
        }
        for (const name of ['legL', 'legR'] as BoneName[]) {
          const part = partByName.get(name);
          if (!part?.body) continue;
          part.body.applyImpulse(
            { x: impulseVec.x * 0.5, y: impulseVec.y * 0.35, z: impulseVec.z * 0.5 },
            true,
          );
          part.body.setAngvel(
            { x: _omega.x * 0.7, y: _omega.y * 0.7, z: _omega.z * 0.7 },
            true,
          );
        }
      }

      active = true;
    },

    step(dt: number) {
      if (!active || !world) return;

      accum += dt;
      const fixedDt = ragdollTuning.fixedDt;
      const maxSubsteps = ragdollTuning.maxSubsteps;
      let steps = 0;

      while (accum >= fixedDt && steps < maxSubsteps) {
        // addTorque is persistent in Rapier — clear last substep's torques or they accumulate.
        for (const p of parts) {
          if (!p.body) continue;
          p.body.resetForces(true);
          p.body.resetTorques(true);
        }
        if (poseStrength > 0) poseController.apply(fixedDt);
        applySwingClamps();
        world.timestep = fixedDt;
        world.step();
        clampVelocities();
        accum -= fixedDt;
        steps++;
      }
      // Drop excess if we hit maxSubsteps (avoid spiral of death).
      if (steps >= maxSubsteps && accum >= fixedDt) {
        accum = 0;
      }

      if (steps > 0) writeBonesFromBodies();
      applySecondarySprings(dt);
    },

    disable() {
      freeWorld();
    },

    dispose() {
      poseController.dispose();
      freeWorld();
    },
  };
}
