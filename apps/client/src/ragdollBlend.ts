import * as THREE from 'three';

export type BonePoseSample = {
  bone: THREE.Bone;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
};

/** Snapshot all skeleton bones under root. Never store/touch scale. */
export function captureBonePose(root: THREE.Object3D): BonePoseSample[] {
  const samples: BonePoseSample[] = [];
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Bone)) return;
    samples.push({
      bone: obj,
      position: obj.position.clone(),
      quaternion: obj.quaternion.clone(),
    });
  });
  return samples;
}

/**
 * Lerp bones from `from` toward `to` by t in [0,1].
 * Match by bone identity (same Bone refs). Never touch bone.scale.
 */
export function blendBonePose(from: BonePoseSample[], to: BonePoseSample[], t: number): void {
  const clamped = Math.min(1, Math.max(0, t));
  const toByBone = new Map<THREE.Bone, BonePoseSample>();
  for (const sample of to) {
    toByBone.set(sample.bone, sample);
  }
  for (const src of from) {
    const dst = toByBone.get(src.bone);
    if (!dst) continue;
    src.bone.position.lerpVectors(src.position, dst.position, clamped);
    src.bone.quaternion.copy(src.quaternion).slerp(dst.quaternion, clamped);
  }
}

/**
 * Controller for a timed blend. Call update(dt) until done (returns true when done).
 */
export function createPoseBlend(opts: {
  root: THREE.Object3D;
  from: BonePoseSample[];
  to: BonePoseSample[];
  durationSec: number;
}): { update(dt: number): boolean; readonly done: boolean; readonly t: number } {
  const { root, from, to, durationSec } = opts;
  const duration = Math.max(1e-6, durationSec);
  let elapsed = 0;
  let done = false;
  let t = 0;

  return {
    get done() {
      return done;
    },
    get t() {
      return t;
    },
    update(dt: number): boolean {
      if (done) return true;
      elapsed += dt;
      t = Math.min(1, elapsed / duration);
      blendBonePose(from, to, t);
      root.updateMatrixWorld(true);
      root.traverse((obj) => {
        if (obj instanceof THREE.SkinnedMesh && obj.skeleton) obj.skeleton.update();
      });
      if (t >= 1) done = true;
      return done;
    },
  };
}
