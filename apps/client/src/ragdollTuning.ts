export type RagdollTuning = {
  gravityY: number;
  linearDamping: number;
  impulseScale: number;
  impulseUp: number;
  angularKick: number;
  maxLinvel: number;
  maxAngvel: number;
  massDensity: number;
  solverIterations: number;
  revoluteLimitMin: number;
  revoluteLimitMax: number;
  // Pose / PD
  kpOrient: number;
  kdOrient: number;
  maxTorque: number;
  kpHipsUpright: number;
  kdHipsUpright: number;
  // Secondary spring-follow bones (ears/muzzle/tail)
  secondarySpringKp: number;
  secondarySpringKd: number;
  // Swing cone clamp (radians) for spherical torso/head
  torsoConeLimit: number;
  headConeLimit: number;
  coneClampKp: number;
  // Fixed timestep
  fixedDt: number;
  maxSubsteps: number;
};

export const DEFAULT_RAGDOLL_TUNING: Readonly<RagdollTuning> = Object.freeze({
  gravityY: -12,
  linearDamping: 1.2,
  impulseScale: 0.2,
  impulseUp: 1,
  angularKick: 2,
  maxLinvel: 12,
  maxAngvel: 20,
  massDensity: 80,
  solverIterations: 8,
  revoluteLimitMin: -2.2,
  revoluteLimitMax: 0.4,
  kpOrient: 40,
  kdOrient: 8,
  maxTorque: 15,
  kpHipsUpright: 20,
  kdHipsUpright: 6,
  secondarySpringKp: 25,
  secondarySpringKd: 5,
  torsoConeLimit: 0.7,
  headConeLimit: 0.9,
  coneClampKp: 30,
  fixedDt: 1 / 60,
  maxSubsteps: 4,
});

export const ragdollTuning: RagdollTuning = { ...DEFAULT_RAGDOLL_TUNING };

export function resetRagdollTuning(): void {
  Object.assign(ragdollTuning, DEFAULT_RAGDOLL_TUNING);
}
