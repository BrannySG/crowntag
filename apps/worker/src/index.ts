import { DurableObject } from 'cloudflare:workers';
import { CAP, CONTENT_REVISION, TICK_HZ } from '@crowntag/content';
import type {
  ClientMessage,
  EventMessage,
  JoinRequest,
  JoinResponse,
  ServerMessage,
  SimEvent,
  SnapshotMessage,
  WireEvent,
} from '@crowntag/protocol';
import { inputMessageToFighterInput } from '@crowntag/protocol';
import { createArenaWorld, World } from '@crowntag/sim';
import {
  type ArenaOccupancy,
  releaseJoinSlot,
  reserveJoinSlot,
  setArenaOccupancy,
} from './matchmaking';

export interface Env {
  ASSETS: Fetcher;
  ARENA: DurableObjectNamespace;
  MATCHMAKER: DurableObjectNamespace;
}

type Attachment = {
  fighterId: string;
  displayName: string;
};

const TICK_MS = 1000 / TICK_HZ;
const MATCHMAKER_NAME = 'global';
const ARENAS_KEY = 'arenas';
const NEXT_SEQ_KEY = 'nextArenaSeq';

/**
 * Singleton Matchmaker: fullest non-full Arena, else create.
 * Occupancy is reserved on Join and corrected by Arena reports / Cap rejects.
 */
export class Matchmaker extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/occupancy') {
      return this.handleOccupancy(request);
    }
    if (request.method === 'POST' && url.pathname === '/release') {
      return this.handleRelease(request);
    }
    if (request.method === 'POST') {
      return this.handleJoin(request);
    }
    return new Response('Method not allowed', { status: 405 });
  }

  private async handleJoin(request: Request): Promise<Response> {
    let body: JoinRequest;
    try {
      body = (await request.json()) as JoinRequest;
    } catch {
      return Response.json({ error: 'invalid_json' }, { status: 400 });
    }
    const displayName = (body.displayName ?? '').trim().slice(0, 24);
    if (!displayName) {
      return Response.json({ error: 'display_name_required' }, { status: 400 });
    }

    const arenas = (await this.ctx.storage.get<ArenaOccupancy[]>(ARENAS_KEY)) ?? [];
    const nextSeq = (await this.ctx.storage.get<number>(NEXT_SEQ_KEY)) ?? 1;
    const reserved = reserveJoinSlot(arenas, nextSeq, CAP);
    await this.ctx.storage.put({
      [ARENAS_KEY]: reserved.arenas,
      [NEXT_SEQ_KEY]: reserved.nextSeq,
    });

    const url = new URL(request.url);
    const wsUrl = `${url.protocol === 'https:' ? 'wss' : 'ws'}://${url.host}/arena/${reserved.arenaId}?name=${encodeURIComponent(displayName)}`;
    const res: JoinResponse = { arenaId: reserved.arenaId, wsUrl };
    return Response.json(res);
  }

  private async handleOccupancy(request: Request): Promise<Response> {
    let body: { arenaId?: string; fighterCount?: number };
    try {
      body = (await request.json()) as { arenaId?: string; fighterCount?: number };
    } catch {
      return Response.json({ error: 'invalid_json' }, { status: 400 });
    }
    const arenaId = (body.arenaId ?? '').trim();
    if (!arenaId || typeof body.fighterCount !== 'number') {
      return Response.json({ error: 'invalid_occupancy' }, { status: 400 });
    }

    const arenas = (await this.ctx.storage.get<ArenaOccupancy[]>(ARENAS_KEY)) ?? [];
    const nextSeq = (await this.ctx.storage.get<number>(NEXT_SEQ_KEY)) ?? 1;
    const next = setArenaOccupancy(arenas, arenaId, body.fighterCount, nextSeq);
    await this.ctx.storage.put({
      [ARENAS_KEY]: next.arenas,
      [NEXT_SEQ_KEY]: next.nextSeq,
    });
    return Response.json({ ok: true });
  }

  private async handleRelease(request: Request): Promise<Response> {
    let body: { arenaId?: string };
    try {
      body = (await request.json()) as { arenaId?: string };
    } catch {
      return Response.json({ error: 'invalid_json' }, { status: 400 });
    }
    const arenaId = (body.arenaId ?? '').trim();
    if (!arenaId) {
      return Response.json({ error: 'arena_id_required' }, { status: 400 });
    }

    const arenas = (await this.ctx.storage.get<ArenaOccupancy[]>(ARENAS_KEY)) ?? [];
    const next = releaseJoinSlot(arenas, arenaId);
    await this.ctx.storage.put(ARENAS_KEY, next);
    return Response.json({ ok: true });
  }
}

/**
 * Authoritative Arena: Hibernation WebSocket API + 20 Hz sim tick while occupied.
 * Bots fill toward Cap while ≥1 human is present (ADR 0004).
 * Cap enforced here as well as in Matchmaker (race: despawn Bot or reject + /release).
 */
export class Arena extends DurableObject<Env> {
  private world: World = createArenaWorld();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private fighterSeq = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Restore any hibernated sockets into sim on wake (attachments carry ids).
    this.ctx.blockConcurrencyWhile(async () => {
      for (const ws of this.ctx.getWebSockets()) {
        const att = ws.deserializeAttachment() as Attachment | null;
        if (!att?.fighterId) continue;
        if (!this.world.getSnapshot().fighters.some((f) => f.id === att.fighterId)) {
          this.world.addPlayer(att.fighterId, att.displayName);
        }
      }
      if (this.ctx.getWebSockets().length > 0) {
        this.world.fillBotsTowardCap(CAP);
        this.ensureTicking();
      }
    });
  }

  private arenaId(): string {
    return this.ctx.id.name ?? 'arena-unknown';
  }

  private matchmaker(): DurableObjectStub {
    return this.env.MATCHMAKER.get(this.env.MATCHMAKER.idFromName(MATCHMAKER_NAME));
  }

  private async reportOccupancy(): Promise<void> {
    try {
      await this.matchmaker().fetch(
        new Request('https://matchmaker/occupancy', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            arenaId: this.arenaId(),
            fighterCount: this.world.getFighterCount(),
          }),
        }),
      );
    } catch {
      // Matchmaker sync is best-effort; Arena Cap remains authoritative.
    }
  }

  private async releaseReservedSlot(): Promise<void> {
    try {
      await this.matchmaker().fetch(
        new Request('https://matchmaker/release', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ arenaId: this.arenaId() }),
        }),
      );
    } catch {
      // ignore
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const displayName = (url.searchParams.get('name') ?? 'Player').trim().slice(0, 24) || 'Player';

    // Cap includes Bots: despawn a Bot to free a slot when full (ADR 0004).
    // If still full, release Matchmaker reservation (Cap race).
    if (this.world.getFighterCount() >= CAP) {
      if (!this.world.despawnBotForPlayerJoin()) {
        await this.releaseReservedSlot();
        return new Response('Arena full', { status: 503 });
      }
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.fighterSeq += 1;
    const fighterId = `p-${this.fighterSeq}`;
    if (!this.world.addPlayer(fighterId, displayName)) {
      await this.releaseReservedSlot();
      return new Response('Arena full', { status: 503 });
    }

    this.ctx.acceptWebSocket(server);
    const attachment: Attachment = { fighterId, displayName };
    server.serializeAttachment(attachment);

    this.world.fillBotsTowardCap(CAP);
    this.ensureTicking();
    await this.reportOccupancy();

    const welcome: ServerMessage = {
      type: 'welcome',
      fighterId,
      arenaId: this.arenaId(),
      tick: this.world.getTick(),
      contentRevision: CONTENT_REVISION,
    };
    server.send(JSON.stringify(welcome));

    this.broadcastEvent({ kind: 'join', fighterId, displayName }, server);
    this.broadcastSnapshot();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att?.fighterId) return;

    let raw: string;
    if (typeof message === 'string') raw = message;
    else raw = new TextDecoder().decode(message);

    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      return;
    }
    if (msg.type !== 'input') return;

    this.world.setInputWithSeq(
      att.fighterId,
      msg.seq,
      inputMessageToFighterInput(msg),
    );
  }

  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    this.handleDisconnect(ws);
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    this.handleDisconnect(ws);
  }

  private handleDisconnect(ws: WebSocket): void {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att?.fighterId) {
      this.maybeStopTicking();
      return;
    }
    const removed = this.world.removeFighter(att.fighterId);
    if (removed) {
      this.broadcastEvent({ kind: 'leave', fighterId: att.fighterId });
      if (this.world.getPlayerCount() === 0) {
        // Last human left — despawn Bots and allow Arena idle (ADR 0004).
        this.world.despawnAllBots();
      } else {
        this.world.fillBotsTowardCap(CAP);
      }
      this.broadcastSnapshot();
      void this.reportOccupancy();
    }
    this.maybeStopTicking();
  }

  private ensureTicking(): void {
    if (this.tickTimer !== null) return;
    this.tickTimer = setInterval(() => this.tickOnce(), TICK_MS);
  }

  private maybeStopTicking(): void {
    if (this.ctx.getWebSockets().length > 0) return;
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private tickOnce(): void {
    if (this.ctx.getWebSockets().length === 0) {
      this.maybeStopTicking();
      return;
    }
    // Bot chase / Claim / Hit / flee runs inside World.step (ADR 0004).
    const events = this.world.step();
    for (const ev of events) {
      const wire = simEventToWire(ev);
      if (wire) this.broadcastEvent(wire);
    }
    this.broadcastSnapshot();
  }

  private broadcastSnapshot(): void {
    const snap = this.world.getSnapshot();
    const msg: SnapshotMessage = {
      type: 'snapshot',
      tick: snap.tick,
      time: snap.time,
      crown: snap.crown,
      fighters: snap.fighters,
    };
    this.broadcast(msg);
  }

  private broadcastEvent(event: WireEvent, except?: WebSocket): void {
    const msg: EventMessage = {
      type: 'event',
      tick: this.world.getTick(),
      event,
    };
    this.broadcast(msg, except);
  }

  private broadcast(msg: ServerMessage, except?: WebSocket): void {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (except && ws === except) continue;
      try {
        ws.send(data);
      } catch {
        // socket may already be closing
      }
    }
  }
}

function simEventToWire(ev: SimEvent): WireEvent | null {
  switch (ev.type) {
    case 'claimed':
      return { kind: 'claim', fighterId: ev.fighterId };
    case 'stolen':
      return { kind: 'steal', fromId: ev.fromId, toId: ev.toId };
    case 'stunned':
      return {
        kind: 'stun',
        targetId: ev.fighterId,
        byId: ev.byId,
        impulseX: 0,
        impulseZ: 0,
        stunRemaining: 0,
      };
    case 'hitLanded':
      return { kind: 'hit', hitterId: ev.attackerId, targetId: ev.targetId };
    default:
      return null;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/join' && request.method === 'POST') {
      const stub = env.MATCHMAKER.get(env.MATCHMAKER.idFromName(MATCHMAKER_NAME));
      return stub.fetch(request);
    }

    const arenaMatch = url.pathname.match(/^\/arena\/([^/]+)$/);
    if (arenaMatch) {
      const arenaId = decodeURIComponent(arenaMatch[1]!);
      const stub = env.ARENA.get(env.ARENA.idFromName(arenaId));
      return stub.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};
