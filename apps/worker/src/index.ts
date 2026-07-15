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

export interface Env {
  ASSETS: Fetcher;
  ARENA: DurableObjectNamespace;
  MATCHMAKER: DurableObjectNamespace;
}

/** Single named arena for ticket #15 (full Matchmaker is #17). */
const SOLO_ARENA_ID = 'arena-1';

type Attachment = {
  fighterId: string;
  displayName: string;
};

const TICK_MS = 1000 / TICK_HZ;

/**
 * Stub Matchmaker: always routes Join to the solo Arena.
 * Occupancy bookkeeping for parallel rooms lands in #17.
 */
export class Matchmaker extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }
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

    const url = new URL(request.url);
    const wsUrl = `${url.protocol === 'https:' ? 'wss' : 'ws'}://${url.host}/arena/${SOLO_ARENA_ID}?name=${encodeURIComponent(displayName)}`;
    const res: JoinResponse = { arenaId: SOLO_ARENA_ID, wsUrl };
    return Response.json(res);
  }
}

/**
 * Authoritative Arena: Hibernation WebSocket API + 20 Hz sim tick while occupied.
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
      if (this.ctx.getWebSockets().length > 0) this.ensureTicking();
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const displayName = (url.searchParams.get('name') ?? 'Player').trim().slice(0, 24) || 'Player';
    if (this.world.getFighterCount() >= CAP) {
      return new Response('Arena full', { status: 503 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.fighterSeq += 1;
    const fighterId = `p-${this.fighterSeq}`;
    this.world.addPlayer(fighterId, displayName);

    this.ctx.acceptWebSocket(server);
    const attachment: Attachment = { fighterId, displayName };
    server.serializeAttachment(attachment);

    this.ensureTicking();

    const welcome: ServerMessage = {
      type: 'welcome',
      fighterId,
      arenaId: this.ctx.id.name ?? SOLO_ARENA_ID,
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
      this.broadcastSnapshot();
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
      const id = env.MATCHMAKER.idFromName('global');
      const stub = env.MATCHMAKER.get(id);
      return stub.fetch(request);
    }

    const arenaMatch = url.pathname.match(/^\/arena\/([^/]+)$/);
    if (arenaMatch) {
      const arenaId = decodeURIComponent(arenaMatch[1]!);
      const id = env.ARENA.idFromName(arenaId);
      const stub = env.ARENA.get(id);
      return stub.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};
