/** Horizontal / 3D vector helpers for snapshots and inputs. */
export type Vec2 = { x: number; z: number };
export type Vec3 = { x: number; y: number; z: number };

export type FighterInput = {
  /** +1 forward / -1 back in camera/look space */
  forward: number;
  /** +1 right / -1 left */
  strafe: number;
  /** Radians; facing + hit cone */
  yaw: number;
  sprint: boolean;
  /** Sim treats as jump if grounded when true */
  jump: boolean;
  /** True on the tick(s) the player clicked hit */
  hit: boolean;
};

export type SimCommand =
  | { type: 'setInput'; fighterId: string; input: FighterInput }
  | { type: 'reset' };

export type SimEvent =
  | { type: 'claimed'; fighterId: string }
  | { type: 'stolen'; fromId: string; toId: string }
  | { type: 'stunned'; fighterId: string; byId: string }
  | { type: 'hitMiss'; fighterId: string }
  | { type: 'hitLanded'; attackerId: string; targetId: string };

export type FighterSnapshot = {
  id: string;
  kind: 'player' | 'dummy';
  displayName: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  vx: number;
  vy: number;
  vz: number;
  onGround: boolean;
  stunRemaining: number;
  hitCooldownRemaining: number;
  score: number;
};

export type CrownSnapshot = {
  /** null = at Crown Spawn */
  holderId: string | null;
  x: number;
  y: number;
  z: number;
};

export type ArenaSnapshot = {
  tick: number;
  time: number;
  fighters: FighterSnapshot[];
  crown: CrownSnapshot;
};

/** Compatibility stub for early worker scaffolding (unused by offline arena). */
export type StubMessage = { type: 'ping' } | { type: 'pong' };
