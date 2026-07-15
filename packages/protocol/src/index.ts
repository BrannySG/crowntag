/** Horizontal / 3D vector helpers for snapshots and inputs. */
export type Vec2 = { x: number; z: number };
export type Vec3 = { x: number; y: number; z: number };

/** Local sim / prediction input (camera-relative axes + look yaw). */
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
  | {
      type: 'stunned';
      fighterId: string;
      byId: string;
      impulseX: number;
      impulseZ: number;
      stunRemaining: number;
    }
  | { type: 'hitMiss'; fighterId: string }
  | { type: 'hitLanded'; attackerId: string; targetId: string };

export type FighterKind = 'player' | 'bot' | 'dummy';

export type FighterSnapshot = {
  id: string;
  kind: FighterKind;
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
  /** Remaining sprint stamina (0..STAMINA.max). */
  stamina: number;
  /** Last input seq consumed by authority for this Fighter (players). */
  lastInputSeq: number;
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

// --- Wire protocol (ADR 0002 / docs/protocol/v1-wire-sketch.md) ---

export type JoinRequest = {
  displayName: string;
};

export type JoinResponse = {
  arenaId: string;
  wsUrl: string;
};

/** Client → Arena. `moveX`/`moveZ` are strafe / forward (normalized by sim). */
export type InputMessage = {
  type: 'input';
  seq: number;
  moveX: number;
  moveZ: number;
  yaw: number;
  jump: boolean;
  sprint: boolean;
  hit: boolean;
};

export type ClientMessage = InputMessage;

export type WelcomeMessage = {
  type: 'welcome';
  fighterId: string;
  arenaId: string;
  tick: number;
  contentRevision: string;
};

export type SnapshotMessage = {
  type: 'snapshot';
  tick: number;
  time: number;
  crown: CrownSnapshot;
  fighters: FighterSnapshot[];
};

export type WireEventKind = 'join' | 'leave' | 'claim' | 'hit' | 'steal' | 'stun';

export type WireEvent =
  | { kind: 'join'; fighterId: string; displayName: string }
  | { kind: 'leave'; fighterId: string }
  | { kind: 'claim'; fighterId: string }
  | { kind: 'hit'; hitterId: string; targetId: string }
  | { kind: 'steal'; fromId: string; toId: string }
  | {
      kind: 'stun';
      targetId: string;
      byId: string;
      impulseX: number;
      impulseZ: number;
      stunRemaining: number;
    };

export type EventMessage = {
  type: 'event';
  tick: number;
  event: WireEvent;
};

export type ServerMessage = WelcomeMessage | SnapshotMessage | EventMessage;

/** @deprecated early scaffolding; prefer ClientMessage / ServerMessage */
export type StubMessage = { type: 'ping' } | { type: 'pong' };

export function inputMessageToFighterInput(msg: InputMessage): FighterInput {
  return {
    forward: msg.moveZ,
    strafe: msg.moveX,
    yaw: msg.yaw,
    sprint: msg.sprint,
    jump: msg.jump,
    hit: msg.hit,
  };
}

export function fighterInputToInputMessage(
  seq: number,
  input: FighterInput,
): InputMessage {
  return {
    type: 'input',
    seq,
    moveX: input.strafe,
    moveZ: input.forward,
    yaw: input.yaw,
    jump: input.jump,
    sprint: input.sprint,
    hit: input.hit,
  };
}
