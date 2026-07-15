import type {
  ClientMessage,
  FighterInput,
  JoinResponse,
  ServerMessage,
  SnapshotMessage,
  WireEvent,
} from '@crowntag/protocol';
import { fighterInputToInputMessage } from '@crowntag/protocol';
import { createArenaWorld, World } from '@crowntag/sim';

const RECONCILE_POS_EPS = 0.35;
const MAX_PENDING = 64;

export type PendingInput = {
  seq: number;
  input: FighterInput;
};

export type NetClient = {
  fighterId: string;
  arenaId: string;
  world: World;
  /** Advance local prediction and send the same input to the Arena. */
  pump: (input: FighterInput) => void;
  dispose: () => void;
};

export type NetHandlers = {
  onWelcome?: (fighterId: string, arenaId: string) => void;
  onEvent?: (event: WireEvent, tick: number) => void;
  onDisconnect?: () => void;
};

/**
 * Join via HTTP then open Arena WebSocket. Runs local prediction + reconcile.
 */
export async function connectNet(
  displayName: string,
  handlers: NetHandlers = {},
): Promise<NetClient> {
  const joinRes = await fetch('/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName }),
  });
  if (!joinRes.ok) {
    const err = await joinRes.text();
    throw new Error(`Join failed (${joinRes.status}): ${err}`);
  }
  const join = (await joinRes.json()) as JoinResponse;

  const wsUrl = toSameOriginWsUrl(join.wsUrl);
  const ws = new WebSocket(wsUrl);

  const world = createArenaWorld();
  const pending: PendingInput[] = [];
  let seq = 0;
  let fighterId = '';
  let arenaId = join.arenaId;
  let authSnap: SnapshotMessage | null = null;
  let connected = false;
  let hardReconcile = false;

  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('WebSocket timeout')), 10000);
    ws.addEventListener('error', () => {
      clearTimeout(t);
      reject(new Error('WebSocket error'));
    });
    ws.addEventListener('message', (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === 'welcome') {
        fighterId = msg.fighterId;
        arenaId = msg.arenaId;
        connected = true;
        clearTimeout(t);
        handlers.onWelcome?.(fighterId, arenaId);
        resolve();
        return;
      }
      if (msg.type === 'event') {
        handlers.onEvent?.(msg.event, msg.tick);
        if (
          msg.event.kind === 'steal' ||
          msg.event.kind === 'stun' ||
          (msg.event.kind === 'claim' && msg.event.fighterId === fighterId)
        ) {
          hardReconcile = true;
        }
        return;
      }
      if (msg.type === 'snapshot') {
        authSnap = msg;
        if (fighterId) {
          reconcile(world, fighterId, msg, pending, hardReconcile);
          hardReconcile = false;
        }
      }
    });
  });

  ws.addEventListener('close', () => {
    connected = false;
    handlers.onDisconnect?.();
  });

  return {
    get fighterId() {
      return fighterId;
    },
    get arenaId() {
      return arenaId;
    },
    world,
    pump(input: FighterInput) {
      if (!fighterId || !connected || ws.readyState !== WebSocket.OPEN) return;
      seq += 1;
      const msg: ClientMessage = fighterInputToInputMessage(seq, input);
      pending.push({ seq, input: { ...input } });
      while (pending.length > MAX_PENDING) pending.shift();
      ws.send(JSON.stringify(msg));

      world.setInputWithSeq(fighterId, seq, input);
      world.step();
      if (authSnap) applyRemotePoses(world, fighterId, authSnap);
    },
    dispose() {
      connected = false;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    },
  };
}

/** Prefer same-origin WS so Vite can proxy `/arena` during local two-process dev. */
function toSameOriginWsUrl(wsUrl: string): string {
  const u = new URL(wsUrl, location.href);
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${u.pathname}${u.search}`;
}

function reconcile(
  world: World,
  localId: string,
  snap: SnapshotMessage,
  pending: PendingInput[],
  hard: boolean,
): void {
  if (!localId) {
    world.applySnapshot(snap);
    return;
  }

  const authLocal = snap.fighters.find((f) => f.id === localId);
  const pred = world.getSnapshot().fighters.find((f) => f.id === localId);
  const ack = authLocal?.lastInputSeq ?? 0;

  while (pending.length && pending[0]!.seq <= ack) pending.shift();

  const diverged =
    !pred ||
    !authLocal ||
    hard ||
    world.getFighterCount() !== snap.fighters.length ||
    authLocal.stunRemaining > 0 ||
    Math.hypot(authLocal.x - pred.x, authLocal.z - pred.z) > RECONCILE_POS_EPS ||
    snap.crown.holderId !== world.getSnapshot().crown.holderId;

  if (diverged) {
    world.applySnapshot(snap);
    for (const p of pending) {
      world.setInputWithSeq(localId, p.seq, p.input);
      world.step();
      applyRemotePoses(world, localId, snap);
    }
    return;
  }

  applyRemotePoses(world, localId, snap);
}

function applyRemotePoses(world: World, localId: string, snap: SnapshotMessage): void {
  const cur = world.getSnapshot();
  const local = cur.fighters.find((f) => f.id === localId);
  if (!local) {
    world.applySnapshot(snap);
    return;
  }
  const fighters = snap.fighters.map((f) =>
    f.id === localId ? { ...local, lastInputSeq: f.lastInputSeq } : f,
  );
  const crown =
    snap.crown.holderId === localId
      ? { holderId: localId, x: local.x, y: local.y + 1.85, z: local.z }
      : snap.crown;
  world.applySnapshot({ ...snap, fighters, crown });
}
