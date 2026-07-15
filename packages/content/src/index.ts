/** Bumped when tweakable content that clients must agree on changes. */
export const CONTENT_REVISION = '4';

/** Default Cap for an Arena (ADR domain). */
export const CAP = 12;

/**
 * Curated Bot Display Names (ADR 0004) — human-like, no `Bot###`.
 * Sim picks unused names when filling toward Cap.
 */
export const BOT_NAMES = [
  'Mira',
  'Jax',
  'Nova',
  'Reed',
  'Sable',
  'Kai',
  'Luna',
  'Orion',
  'Vera',
  'Ash',
  'Piper',
  'Cole',
  'Riven',
  'Tess',
  'Quinn',
  'Drake',
  'Wren',
  'Felix',
  'Ivy',
  'Knox',
  'Sage',
  'Blaze',
  'Nina',
  'Cruz',
] as const;

/** Authoritative / predicted tick rate (ADR 0002). */
export const TICK_HZ = 20;

/** ADR 0005 movement baselines. */
export const MOVEMENT = {
  moveSpeed: 5.5,
  sprintMult: 1.45,
  /** Applied while Fighter is Holder (stacks with sprint). */
  holderSpeedMult: 1.35,
  jumpImpulse: 9,
} as const;

/** ADR 0005 hit / stun / knockback baselines. */
export const HIT = {
  hitRange: 2.4,
  hitArcDeg: 90,
  hitCooldown: 0.35,
  stunDuration: 0.7,
  knockbackStrength: 11,
} as const;

/** Steal immunity after becoming Holder via Claim or Steal (seconds). */
export const GRACE_DURATION = 2;

/** Physics + body sizes used by the sim. */
export const PHYSICS = {
  gravity: 22,
  playerRadius: 0.45,
  dummyRadius: 0.5,
  /** Extra inset from arena walls when clamping. */
  wallMargin: 0.3,
} as const;

/** Hold-time Score: 1 second held → 1 score. */
export const SCORE_PER_SECOND = 1;

/** ADR 0003 graybox floor size (meters). */
export const ARENA_SIZE = 48;

/** ADR 0003 perimeter wall height (meters). */
export const WALL_HEIGHT = 3;

/** Proximity Claim radius around Crown Spawn (meters). */
export const CLAIM_RADIUS = 1.75;

/** Crown Spawn — arena center. */
export const CROWN_SPAWN: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };

/**
 * Eight Fighter Spawns (cardinals + diagonals), each ≥15 m from Crown Spawn.
 * Order: N, NE, E, SE, S, SW, W, NW.
 */
export const FIGHTER_SPAWNS = [
  { x: 0, y: 0, z: -18 },
  { x: 12.73, y: 0, z: -12.73 },
  { x: 18, y: 0, z: 0 },
  { x: 12.73, y: 0, z: 12.73 },
  { x: 0, y: 0, z: 18 },
  { x: -12.73, y: 0, z: 12.73 },
  { x: -18, y: 0, z: 0 },
  { x: -12.73, y: 0, z: -12.73 },
] as const;

/** Index into FIGHTER_SPAWNS for the offline solo player (south). */
export const PLAYER_SPAWN_INDEX = 4;

export type ObstacleKind = 'box' | 'pillar';

/** Axis-aligned obstacle footprint; `w`/`h`/`d` are full extents. */
export type ObstacleDef = {
  kind: ObstacleKind;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
};

/**
 * Graybox cover from the accepted movement-hit prototype:
 * waist-high boxes + low pillars around the pedestal.
 */
export const OBSTACLES: readonly ObstacleDef[] = [
  // Cover boxes [w, h, d, x, y, z]
  { kind: 'box', x: -8, y: 0.55, z: -6, w: 4, h: 1.1, d: 2 },
  { kind: 'box', x: 10, y: 0.55, z: 4, w: 2, h: 1.1, d: 5 },
  { kind: 'box', x: -4, y: 0.55, z: 12, w: 3, h: 1.1, d: 3 },
  { kind: 'box', x: 6, y: 0.55, z: -14, w: 6, h: 1.1, d: 1.5 },
  { kind: 'box', x: -14, y: 0.55, z: 2, w: 1.5, h: 1.1, d: 4 },
  { kind: 'box', x: 14, y: 0.55, z: -8, w: 2.5, h: 1.1, d: 2.5 },
  // Low pillars on a ring around Crown Spawn (radius 5 m)
  { kind: 'pillar', x: 5, y: 0.6, z: 0, w: 0.8, h: 1.2, d: 0.8 },
  { kind: 'pillar', x: 2.5, y: 0.6, z: 4.33, w: 0.8, h: 1.2, d: 0.8 },
  { kind: 'pillar', x: -2.5, y: 0.6, z: 4.33, w: 0.8, h: 1.2, d: 0.8 },
  { kind: 'pillar', x: -5, y: 0.6, z: 0, w: 0.8, h: 1.2, d: 0.8 },
  { kind: 'pillar', x: -2.5, y: 0.6, z: -4.33, w: 0.8, h: 1.2, d: 0.8 },
  { kind: 'pillar', x: 2.5, y: 0.6, z: -4.33, w: 0.8, h: 1.2, d: 0.8 },
];

/** Pedestal visual sizes (client); Claim uses CLAIM_RADIUS. */
export const PEDESTAL = {
  topRadius: 1.2,
  bottomRadius: 1.4,
  height: 0.35,
} as const;

/**
 * Bot private vision / memory (ADR 0004) — sim-only; not on the wire.
 * Soft center bias blends roam waypoints toward Crown Spawn.
 */
export const BOT_VISION = {
  range: 28,
  fovDeg: 120,
  memorySeconds: 3.5,
  hearRadius: 18,
  hearMemorySeconds: 2,
  holderAwarenessRange: 14,
  softCenterBias: 0.25,
} as const;
