import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { ragdollTuning } from './ragdollTuning';

export type PoseHandle = {
  name: string;
  bone: THREE.Bone;
  body: RAPIER.RigidBody;
  /** Parent rigid body for equal-and-opposite joint torque pairs. */
  parentBody?: RAPIER.RigidBody | null;
  /** Approximate angular inertia for gain scaling. */
  inertia?: number;
  halfHeight?: number;
  radius?: number;
  mass?: number;
};

export type PoseController = {
  /** 0 = limp, 1 = full stand springs */
  setStrength(s: number): void;
  /** Capture local (parent-relative) bone rotations as targets; hips stores upright world quat */
  captureTargetsFromBones(): void;
  /** Apply joint-space PD torques toward captured targets; call before world.step */
  apply(dt: number): void;
  dispose(): void;
};

/** Rough average capsule inertia about center (cylinder section). */
export function approxCapsuleInertia(
  mass: number,
  halfHeight: number,
  radius: number,
): number {
  const h = 2 * halfHeight;
  const iCylinder = (1 / 12) * mass * (3 * radius * radius + h * h);
  return Math.max(0.001, iCylinder);
}

const _qBody = new THREE.Quaternion();
const _qParent = new THREE.Quaternion();
const _qLocal = new THREE.Quaternion();
const _qTarget = new THREE.Quaternion();
const _qErr = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const _up = new THREE.Vector3();
const _targetUp = new THREE.Vector3();

function clampTorque(tx: number, ty: number, tz: number, maxTorque: number): {
  x: number;
  y: number;
  z: number;
} {
  const mag = Math.hypot(tx, ty, tz);
  if (mag <= maxTorque || mag < 1e-12) return { x: tx, y: ty, z: tz };
  const s = maxTorque / mag;
  return { x: tx * s, y: ty * s, z: tz * s };
}

/**
 * Joint-space PD orientation drive for bunny ragdoll parts.
 * Child gets +τ, parent gets −τ (no net angular momentum).
 * Hips get a modest world-space upright torque only (no Y levitation).
 */
export function createBunnyPoseController(getHandles: () => PoseHandle[] | null): PoseController {
  let strength = 0;
  /** Local (parent-relative) target rotations keyed by part name. */
  const localTargets = new Map<string, THREE.Quaternion>();
  /** World upright reference for hips (captured at stand pose). */
  let hipsUpright: THREE.Quaternion | null = null;

  return {
    setStrength(s: number) {
      strength = Math.min(1, Math.max(0, s));
    },

    captureTargetsFromBones() {
      localTargets.clear();
      hipsUpright = null;
      const handles = getHandles();
      if (!handles) return;

      for (const h of handles) {
        if (h.name === 'hips') {
          h.bone.getWorldQuaternion(_qTarget);
          hipsUpright = _qTarget.clone();
          localTargets.set(h.name, _qTarget.clone());
          continue;
        }
        // Parent-relative local quaternion from the skeleton bone.
        localTargets.set(h.name, h.bone.quaternion.clone());
      }
    },

    apply(_dt: number) {
      if (strength <= 1e-4) return;
      const handles = getHandles();
      if (!handles) return;

      const s = strength;
      const { kpOrient, kdOrient, maxTorque, kpHipsUpright, kdHipsUpright } = ragdollTuning;

      // Reset user forces/torques before applying this frame's PD.
      for (const h of handles) {
        const body = h.body as RAPIER.RigidBody & {
          resetForces?: (wake: boolean) => void;
          resetTorques?: (wake: boolean) => void;
        };
        body.resetForces?.(true);
        body.resetTorques?.(true);
      }

      for (const h of handles) {
        const inertia = h.inertia ?? 0.01;
        const w = h.body.angvel();

        if (h.name === 'hips') {
          // Modest world-space upright torque only — no floating Y force.
          if (!hipsUpright || s < 0.2) continue;

          const r = h.body.rotation();
          _qBody.set(r.x, r.y, r.z, r.w);
          // Drive body's +Y toward captured upright's +Y (partial: upright only).
          _up.set(0, 1, 0).applyQuaternion(_qBody);
          _targetUp.set(0, 1, 0).applyQuaternion(hipsUpright);

          _axis.crossVectors(_up, _targetUp);
          const crossLen = _axis.length();
          const dot = Math.min(1, Math.max(-1, _up.dot(_targetUp)));
          const angle = Math.acos(dot);

          const kp = kpHipsUpright * s;
          const kd = kdHipsUpright * s;
          let tx: number;
          let ty: number;
          let tz: number;
          if (angle > 1e-5 && crossLen > 1e-8) {
            _axis.multiplyScalar(1 / crossLen);
            tx = kp * angle * _axis.x - kd * w.x;
            ty = kp * angle * _axis.y - kd * w.y;
            tz = kp * angle * _axis.z - kd * w.z;
          } else {
            tx = -kd * w.x;
            ty = -kd * w.y;
            tz = -kd * w.z;
          }
          const clamped = clampTorque(tx, ty, tz, maxTorque);
          h.body.addTorque(clamped, true);
          continue;
        }

        const target = localTargets.get(h.name);
        if (!target || !h.parentBody) continue;

        // Current local rotation: parent⁻¹ * child (world).
        const r = h.body.rotation();
        const pr = h.parentBody.rotation();
        _qBody.set(r.x, r.y, r.z, r.w);
        _qParent.set(pr.x, pr.y, pr.z, pr.w);
        _qLocal.copy(_qParent).invert().multiply(_qBody);

        // error = target * current⁻¹ in local/parent space, then express torque in world.
        _qErr.copy(target).multiply(_qLocal.clone().invert());
        if (_qErr.w < 0) {
          _qErr.x = -_qErr.x;
          _qErr.y = -_qErr.y;
          _qErr.z = -_qErr.z;
          _qErr.w = -_qErr.w;
        }

        const angle = 2 * Math.acos(Math.min(1, Math.max(-1, _qErr.w)));
        const kp = kpOrient * inertia * s;
        const kd = kdOrient * inertia * s;

        // Relative angular velocity in world: ω_child − ω_parent
        const pw = h.parentBody.angvel();
        const relWx = w.x - pw.x;
        const relWy = w.y - pw.y;
        const relWz = w.z - pw.z;

        let tx: number;
        let ty: number;
        let tz: number;
        if (angle > 1e-5) {
          const sinHalf = Math.sin(angle / 2);
          // Axis of error is in parent space; rotate to world.
          _axis.set(_qErr.x / sinHalf, _qErr.y / sinHalf, _qErr.z / sinHalf).normalize();
          _axis.applyQuaternion(_qParent);
          tx = kp * angle * _axis.x - kd * relWx;
          ty = kp * angle * _axis.y - kd * relWy;
          tz = kp * angle * _axis.z - kd * relWz;
        } else {
          tx = -kd * relWx;
          ty = -kd * relWy;
          tz = -kd * relWz;
        }

        const clamped = clampTorque(tx, ty, tz, maxTorque);
        // Equal-and-opposite torque pair — no net angular momentum.
        h.body.addTorque(clamped, true);
        h.parentBody.addTorque({ x: -clamped.x, y: -clamped.y, z: -clamped.z }, true);
      }
    },

    dispose() {
      localTargets.clear();
      hipsUpright = null;
      strength = 0;
    },
  };
}
