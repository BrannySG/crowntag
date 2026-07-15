import {
  ARENA_SIZE,
  CLAIM_RADIUS,
  CROWN_SPAWN,
  FIGHTER_SPAWNS,
  HIT,
  MOVEMENT,
  OBSTACLES,
  PHYSICS,
  PLAYER_SPAWN_INDEX,
  SCORE_PER_SECOND,
  TICK_HZ,
} from '@crowntag/content';
import type {
  ArenaSnapshot,
  FighterInput,
  FighterKind,
  FighterSnapshot,
  SimCommand,
  SimEvent,
} from '@crowntag/protocol';

/** Fixed sim timestep (ADR 0002 — 20 Hz). */
export const FIXED_DT = 1 / TICK_HZ;

type DummyPatrol = {
  /** Deterministic phase seed (no Math.random). */
  phase: number;
  homeX: number;
  homeZ: number;
  /** When true, walks an ellipse around home. */
  moving: boolean;
  /** Prefer orbiting near the pedestal so Claim / Steal can be tested. */
  nearCrown: boolean;
};

type FighterState = {
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
  radius: number;
  input: FighterInput;
  lastInputSeq: number;
  dummy?: DummyPatrol;
};

const EMPTY_INPUT: FighterInput = {
  forward: 0,
  strafe: 0,
  yaw: 0,
  sprint: false,
  jump: false,
  hit: false,
};

function distXZ(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.hypot(dx, dz);
}

function clampToArena(f: FighterState): void {
  const half = ARENA_SIZE / 2;
  const lim = half - f.radius - PHYSICS.wallMargin;
  if (f.x < -lim) f.x = -lim;
  else if (f.x > lim) f.x = lim;
  if (f.z < -lim) f.z = -lim;
  else if (f.z > lim) f.z = lim;
}

function resolveObstacles(f: FighterState): void {
  for (const o of OBSTACLES) {
    const hw = o.w / 2 + f.radius;
    const hd = o.d / 2 + f.radius;
    const dx = f.x - o.x;
    const dz = f.z - o.z;
    if (Math.abs(dx) < hw && Math.abs(dz) < hd) {
      const px = hw - Math.abs(dx);
      const pz = hd - Math.abs(dz);
      if (px < pz) f.x = o.x + Math.sign(dx || 1) * hw;
      else f.z = o.z + Math.sign(dz || 1) * hd;
    }
  }
}

export type WorldMode = 'offline' | 'arena';

/**
 * Authoritative Arena world — headless: no DOM, Three.js, Cloudflare, timers, or Math.random.
 * Offline mode seeds one player + dummies; arena mode starts empty and uses add/remove Fighter.
 */
export class World {
  private tick = 0;
  private time = 0;
  private fighters: FighterState[] = [];
  private holderId: string | null = null;
  private pendingInputs = new Map<string, FighterInput>();
  private pendingSeqs = new Map<string, number>();
  private nextSpawnIndex = 0;
  private readonly mode: WorldMode;

  constructor(mode: WorldMode = 'offline') {
    this.mode = mode;
    this.resetState();
  }

  getTick(): number {
    return this.tick;
  }

  getFighterCount(): number {
    return this.fighters.length;
  }

  send(cmd: SimCommand): void {
    if (cmd.type === 'reset') {
      this.resetState();
      return;
    }
    if (cmd.type === 'setInput') {
      this.pendingInputs.set(cmd.fighterId, { ...cmd.input });
    }
  }

  /** Apply sequenced input (Arena DO / prediction). Higher seq wins for the tick. */
  setInputWithSeq(fighterId: string, seq: number, input: FighterInput): void {
    const f = this.fighters.find((x) => x.id === fighterId);
    if (!f) return;
    const prev = this.pendingSeqs.get(fighterId) ?? f.lastInputSeq;
    if (seq < prev) return;
    this.pendingSeqs.set(fighterId, seq);
    this.pendingInputs.set(fighterId, { ...input });
  }

  /**
   * Add a human Player at the next Fighter Spawn.
   * Returns false if Cap would be exceeded (caller should reject join).
   */
  addPlayer(id: string, displayName: string, spawnIndex?: number): boolean {
    if (this.fighters.some((f) => f.id === id)) return false;
    const idx =
      spawnIndex !== undefined
        ? spawnIndex % FIGHTER_SPAWNS.length
        : this.nextSpawnIndex++ % FIGHTER_SPAWNS.length;
    const spawn = FIGHTER_SPAWNS[idx]!;
    // Face Crown Spawn (origin): forward (-sin yaw, -cos yaw) points inward.
    const yaw = Math.atan2(spawn.x, spawn.z);
    this.fighters.push({
      id,
      kind: 'player',
      displayName,
      x: spawn.x,
      y: 0,
      z: spawn.z,
      yaw,
      vx: 0,
      vy: 0,
      vz: 0,
      onGround: true,
      stunRemaining: 0,
      hitCooldownRemaining: 0,
      score: 0,
      radius: PHYSICS.playerRadius,
      input: { ...EMPTY_INPUT, yaw },
      lastInputSeq: 0,
    });
    return true;
  }

  /**
   * Disconnect / leave. If the Fighter was Holder, Crown returns to Crown Spawn.
   * Returns true if a Fighter was removed.
   */
  removeFighter(id: string): boolean {
    const idx = this.fighters.findIndex((f) => f.id === id);
    if (idx < 0) return false;
    if (this.holderId === id) this.holderId = null;
    this.fighters.splice(idx, 1);
    this.pendingInputs.delete(id);
    this.pendingSeqs.delete(id);
    return true;
  }

  /**
   * Replace world state from an authoritative snapshot (client reconcile).
   * Dummies/bots keep kind from snapshot; offline dummies are restored as `dummy`.
   */
  applySnapshot(snap: ArenaSnapshot): void {
    this.tick = snap.tick;
    this.time = snap.time;
    this.holderId = snap.crown.holderId;
    this.pendingInputs.clear();
    this.pendingSeqs.clear();

    const prev = new Map(this.fighters.map((f) => [f.id, f]));
    this.fighters = snap.fighters.map((s) => {
      const old = prev.get(s.id);
      return {
        id: s.id,
        kind: s.kind,
        displayName: s.displayName,
        x: s.x,
        y: s.y,
        z: s.z,
        yaw: s.yaw,
        vx: s.vx,
        vy: s.vy,
        vz: s.vz,
        onGround: s.onGround,
        stunRemaining: s.stunRemaining,
        hitCooldownRemaining: s.hitCooldownRemaining,
        score: s.score,
        radius:
          s.kind === 'dummy' ? PHYSICS.dummyRadius : PHYSICS.playerRadius,
        input: old ? { ...old.input } : { ...EMPTY_INPUT, yaw: s.yaw },
        lastInputSeq: s.lastInputSeq,
        dummy: old?.dummy,
      };
    });
  }

  /**
   * Advance one fixed tick. Variable `dt` is ignored — always uses FIXED_DT.
   */
  step(_dt?: number): SimEvent[] {
    const dt = FIXED_DT;
    const events: SimEvent[] = [];

    for (const [id, input] of this.pendingInputs) {
      const f = this.fighters.find((x) => x.id === id);
      if (f) {
        f.input = { ...input };
        const seq = this.pendingSeqs.get(id);
        if (seq !== undefined) f.lastInputSeq = seq;
      }
    }
    this.pendingInputs.clear();
    this.pendingSeqs.clear();

    for (const f of this.fighters) {
      f.hitCooldownRemaining = Math.max(0, f.hitCooldownRemaining - dt);
      f.stunRemaining = Math.max(0, f.stunRemaining - dt);
    }

    for (const f of this.fighters) {
      if (f.kind === 'dummy') this.stepDummy(f, dt);
      else this.stepPlayer(f, dt);
    }

    for (const f of this.fighters) {
      if (f.kind !== 'dummy' && f.input.hit) {
        events.push(...this.resolveHit(f));
        f.input.hit = false;
      }
    }

    events.push(...this.resolveClaim());

    if (this.holderId) {
      const holder = this.fighters.find((f) => f.id === this.holderId);
      if (holder) holder.score += SCORE_PER_SECOND * dt;
    }

    this.tick += 1;
    this.time += dt;
    return events;
  }

  getSnapshot(): ArenaSnapshot {
    const fighters: FighterSnapshot[] = this.fighters.map((f) => ({
      id: f.id,
      kind: f.kind,
      displayName: f.displayName,
      x: f.x,
      y: f.y,
      z: f.z,
      yaw: f.yaw,
      vx: f.vx,
      vy: f.vy,
      vz: f.vz,
      onGround: f.onGround,
      stunRemaining: f.stunRemaining,
      hitCooldownRemaining: f.hitCooldownRemaining,
      score: f.score,
      lastInputSeq: f.lastInputSeq,
    }));

    let cx = CROWN_SPAWN.x;
    let cy = 0.35;
    let cz = CROWN_SPAWN.z;
    if (this.holderId) {
      const holder = this.fighters.find((f) => f.id === this.holderId);
      if (holder) {
        cx = holder.x;
        cy = holder.y + 1.85;
        cz = holder.z;
      }
    }

    return {
      tick: this.tick,
      time: this.time,
      fighters,
      crown: {
        holderId: this.holderId,
        x: cx,
        y: cy,
        z: cz,
      },
    };
  }

  private resetState(): void {
    this.tick = 0;
    this.time = 0;
    this.holderId = null;
    this.pendingInputs.clear();
    this.pendingSeqs.clear();
    this.nextSpawnIndex = 0;

    if (this.mode === 'arena') {
      this.fighters = [];
      return;
    }

    const spawn = FIGHTER_SPAWNS[PLAYER_SPAWN_INDEX]!;
    const playerYaw = Math.atan2(spawn.x, spawn.z);

    this.fighters = [
      {
        id: 'player',
        kind: 'player',
        displayName: 'You',
        x: spawn.x,
        y: 0,
        z: spawn.z,
        yaw: playerYaw,
        vx: 0,
        vy: 0,
        vz: 0,
        onGround: true,
        stunRemaining: 0,
        hitCooldownRemaining: 0,
        score: 0,
        radius: PHYSICS.playerRadius,
        input: { ...EMPTY_INPUT, yaw: playerYaw },
        lastInputSeq: 0,
      },
      this.makeDummy('dummy-1', 'NearCrown', 3.5, 2.5, {
        phase: 0.4,
        moving: true,
        nearCrown: true,
      }),
      this.makeDummy('dummy-2', 'Patrol-A', 12, 8, {
        phase: 1.2,
        moving: true,
        nearCrown: false,
      }),
      this.makeDummy('dummy-3', 'Patrol-B', -12, -4, {
        phase: 2.6,
        moving: true,
        nearCrown: false,
      }),
      this.makeDummy('dummy-4', 'Static', 8, -8, {
        phase: 0,
        moving: false,
        nearCrown: false,
      }),
    ];
  }

  private makeDummy(
    id: string,
    displayName: string,
    x: number,
    z: number,
    opts: { phase: number; moving: boolean; nearCrown: boolean },
  ): FighterState {
    return {
      id,
      kind: 'dummy',
      displayName,
      x,
      y: 0,
      z,
      yaw: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      onGround: true,
      stunRemaining: 0,
      hitCooldownRemaining: 0,
      score: 0,
      radius: PHYSICS.dummyRadius,
      input: { ...EMPTY_INPUT },
      lastInputSeq: 0,
      dummy: {
        phase: opts.phase,
        homeX: x,
        homeZ: z,
        moving: opts.moving,
        nearCrown: opts.nearCrown,
      },
    };
  }

  private stepPlayer(f: FighterState, dt: number): void {
    const stunned = f.stunRemaining > 0;
    f.yaw = f.input.yaw;

    let inputF = stunned ? 0 : f.input.forward;
    let inputR = stunned ? 0 : f.input.strafe;
    const sprinting = !stunned && f.input.sprint;
    const speed = MOVEMENT.moveSpeed * (sprinting ? MOVEMENT.sprintMult : 1);

    if (inputF !== 0 || inputR !== 0) {
      const len = Math.hypot(inputF, inputR);
      inputF /= len;
      inputR /= len;
      const fx = -Math.sin(f.yaw);
      const fz = -Math.cos(f.yaw);
      const rx = Math.cos(f.yaw);
      const rz = -Math.sin(f.yaw);
      f.vx = (fx * inputF + rx * inputR) * speed;
      f.vz = (fz * inputF + rz * inputR) * speed;
    } else if (f.onGround) {
      f.vx *= Math.pow(0.01, dt);
      f.vz *= Math.pow(0.01, dt);
      if (Math.abs(f.vx) < 0.05) f.vx = 0;
      if (Math.abs(f.vz) < 0.05) f.vz = 0;
    }

    if (!stunned && f.onGround && f.input.jump) {
      f.vy = MOVEMENT.jumpImpulse;
      f.onGround = false;
    }

    if (!f.onGround) {
      f.vy -= PHYSICS.gravity * dt;
    }

    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.z += f.vz * dt;

    if (f.y <= 0) {
      f.y = 0;
      f.vy = 0;
      f.onGround = true;
    }

    clampToArena(f);
    resolveObstacles(f);
  }

  private stepDummy(f: FighterState, dt: number): void {
    const d = f.dummy!;
    if (f.stunRemaining > 0) {
      f.x += f.vx * dt;
      f.z += f.vz * dt;
      f.vx *= Math.pow(0.05, dt);
      f.vz *= Math.pow(0.05, dt);
    } else {
      f.vx *= Math.pow(0.02, dt);
      f.vz *= Math.pow(0.02, dt);
      f.x += f.vx * dt;
      f.z += f.vz * dt;

      if (d.moving) {
        const isHolder = this.holderId === f.id;
        if (d.nearCrown) {
          d.phase += dt * (isHolder ? 0.35 : 0.55);
          const radius = isHolder ? 1.2 : 1.6;
          const tx = Math.cos(d.phase) * radius;
          const tz = Math.sin(d.phase * 0.9) * radius;
          f.x += (tx - f.x) * Math.min(1, dt * 1.1);
          f.z += (tz - f.z) * Math.min(1, dt * 1.1);
        } else if (!isHolder) {
          d.phase += dt * 0.6;
          const tx = d.homeX + Math.cos(d.phase) * 3.5;
          const tz = d.homeZ + Math.sin(d.phase * 0.85) * 3.5;
          f.x += (tx - f.x) * Math.min(1, dt * 1.2);
          f.z += (tz - f.z) * Math.min(1, dt * 1.2);
        } else {
          d.phase += dt * 0.35;
          const tx = d.homeX + Math.cos(d.phase) * 2;
          const tz = d.homeZ + Math.sin(d.phase) * 2;
          f.x += (tx - f.x) * Math.min(1, dt);
          f.z += (tz - f.z) * Math.min(1, dt);
        }
      }
    }

    clampToArena(f);
    resolveObstacles(f);
  }

  private resolveHit(attacker: FighterState): SimEvent[] {
    const events: SimEvent[] = [];
    if (attacker.hitCooldownRemaining > 0 || attacker.stunRemaining > 0) {
      return events;
    }
    attacker.hitCooldownRemaining = HIT.hitCooldown;

    const fx = -Math.sin(attacker.yaw);
    const fz = -Math.cos(attacker.yaw);
    const halfArc = ((HIT.hitArcDeg * Math.PI) / 180) / 2;

    let best: FighterState | null = null;
    let bestDist = Infinity;

    for (const target of this.fighters) {
      if (target.id === attacker.id) continue;
      const dx = target.x - attacker.x;
      const dz = target.z - attacker.z;
      const dist = Math.hypot(dx, dz);
      if (dist > HIT.hitRange + target.radius) continue;
      if (dist < 0.001) {
        best = target;
        bestDist = 0;
        break;
      }
      const nx = dx / dist;
      const nz = dz / dist;
      const dot = fx * nx + fz * nz;
      const clamped = Math.max(-1, Math.min(1, dot));
      const ang = Math.acos(clamped);
      if (ang <= halfArc && dist < bestDist) {
        best = target;
        bestDist = dist;
      }
    }

    if (!best) {
      events.push({ type: 'hitMiss', fighterId: attacker.id });
      return events;
    }

    events.push({
      type: 'hitLanded',
      attackerId: attacker.id,
      targetId: best.id,
    });

    if (this.holderId === best.id) {
      const fromId = best.id;
      this.holderId = attacker.id;
      events.push({ type: 'stolen', fromId, toId: attacker.id });
    } else {
      best.stunRemaining = HIT.stunDuration;
      let ax = best.x - attacker.x;
      let az = best.z - attacker.z;
      const len = Math.hypot(ax, az);
      if (len < 1e-6) {
        ax = fx;
        az = fz;
      } else {
        ax /= len;
        az /= len;
      }
      best.vx += ax * HIT.knockbackStrength;
      best.vz += az * HIT.knockbackStrength;
      events.push({ type: 'stunned', fighterId: best.id, byId: attacker.id });
    }

    return events;
  }

  private resolveClaim(): SimEvent[] {
    if (this.holderId !== null) return [];
    const events: SimEvent[] = [];
    let best: FighterState | null = null;
    let bestDist = Infinity;
    for (const f of this.fighters) {
      const d = distXZ(f.x, f.z, CROWN_SPAWN.x, CROWN_SPAWN.z);
      if (d <= CLAIM_RADIUS && d < bestDist) {
        best = f;
        bestDist = d;
      }
    }
    if (best) {
      this.holderId = best.id;
      events.push({ type: 'claimed', fighterId: best.id });
    }
    return events;
  }
}

export function createOfflineWorld(): World {
  return new World('offline');
}

export function createArenaWorld(): World {
  return new World('arena');
}
