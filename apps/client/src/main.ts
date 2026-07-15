import { createOfflineWorld, FIXED_DT } from '@crowntag/sim';
import { createArenaScene } from './scene';
import { createInput } from './input';
import { connectNet, type NetClient } from './net';

const app = document.getElementById('app');
if (!app) throw new Error('#app missing');

const holderEl = document.getElementById('holder');
const scoreEl = document.getElementById('score');
const leaderboardList = document.getElementById('leaderboard-list');
const hintEl = document.getElementById('hint');
const joinEl = document.getElementById('join');
const nameInput = document.getElementById('display-name') as HTMLInputElement | null;
const joinBtn = document.getElementById('join-btn');
const joinErr = document.getElementById('join-err');
const offlineLink = document.getElementById('offline-link');
const modeLabel = document.getElementById('mode-label');
const controlsEl = document.getElementById('controls');

const params = new URLSearchParams(location.search);
const wantOffline = params.get('offline') === '1';

const arena = createArenaScene(app);
const input = createInput(arena.renderer.domElement);

document.addEventListener('pointerlockchange', () => {
  if (!hintEl) return;
  const locked = document.pointerLockElement === arena.renderer.domElement;
  hintEl.classList.toggle('hidden', locked);
});

if (wantOffline) {
  joinEl?.classList.add('hidden');
  if (modeLabel) modeLabel.textContent = 'Offline arena';
  if (controlsEl) {
    controlsEl.innerHTML = 'Offline arena<br />Claim by proximity · Steal with Hit · R reset';
  }
  startOffline();
} else {
  offlineLink?.addEventListener('click', (e) => {
    e.preventDefault();
    location.search = '?offline=1';
  });
  joinBtn?.addEventListener('click', () => void tryJoin());
  nameInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void tryJoin();
  });
  nameInput?.focus();
}

async function tryJoin() {
  const name = (nameInput?.value ?? '').trim();
  if (!name) {
    if (joinErr) joinErr.textContent = 'Enter a Display Name';
    return;
  }
  if (joinErr) joinErr.textContent = '';
  if (joinBtn instanceof HTMLButtonElement) joinBtn.disabled = true;
  try {
    const net = await connectNet(name, {
      onDisconnect: () => {
        if (joinErr) joinErr.textContent = 'Disconnected — refresh to rejoin';
        joinEl?.classList.remove('hidden');
      },
    });
    joinEl?.classList.add('hidden');
    if (modeLabel) modeLabel.textContent = `Arena ${net.arenaId}`;
    if (controlsEl) {
      controlsEl.innerHTML =
        'Hosted arena · Bots fill Cap<br />Claim by proximity · Steal with Hit';
    }
    if (hintEl) {
      hintEl.textContent =
        'Click to capture mouse · WASD move · Shift sprint · Space jump · Click hit';
      hintEl.classList.remove('hidden');
    }
    startOnline(net);
  } catch (err) {
    if (joinErr) {
      joinErr.textContent =
        err instanceof Error ? err.message : 'Join failed — is wrangler running?';
    }
    if (joinBtn instanceof HTMLButtonElement) joinBtn.disabled = false;
  }
}

function startOffline() {
  const world = createOfflineWorld();
  let accumulator = 0;
  let last = performance.now();

  function frame(now: number) {
    const frameDt = Math.min((now - last) / 1000, 0.05);
    last = now;
    accumulator += frameDt;
    input.syncKeys();

    if (input.consumeReset()) {
      world.send({ type: 'reset' });
      input.state.yaw = 0;
    }

    let firstTick = true;
    while (accumulator >= FIXED_DT) {
      const hit = firstTick ? input.consumeHit() : false;
      firstTick = false;
      world.send({
        type: 'setInput',
        fighterId: 'player',
        input: {
          forward: input.state.forward,
          strafe: input.state.strafe,
          yaw: input.state.yaw,
          sprint: input.state.sprint,
          jump: input.state.jump,
          hit,
        },
      });
      world.step();
      accumulator -= FIXED_DT;
    }

    const snap = world.getSnapshot();
    arena.updateFromSnapshot(snap, 'player', input.state.yaw, frameDt);
    arena.renderer.render(arena.scene, arena.camera);
    updateHud(snap, 'player');
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

function startOnline(net: NetClient) {
  let accumulator = 0;
  let last = performance.now();

  function frame(now: number) {
    const frameDt = Math.min((now - last) / 1000, 0.05);
    last = now;
    accumulator += frameDt;
    input.syncKeys();

    let firstTick = true;
    while (accumulator >= FIXED_DT) {
      const hit = firstTick ? input.consumeHit() : false;
      firstTick = false;
      net.pump({
        forward: input.state.forward,
        strafe: input.state.strafe,
        yaw: input.state.yaw,
        sprint: input.state.sprint,
        jump: input.state.jump,
        hit,
      });
      accumulator -= FIXED_DT;
    }

    const snap = net.world.getSnapshot();
    const localId = net.fighterId || 'player';
    arena.updateFromSnapshot(snap, localId, input.state.yaw, frameDt);
    arena.renderer.render(arena.scene, arena.camera);
    updateHud(snap, localId);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

function updateHud(
  snap: {
    crown: { holderId: string | null };
    fighters: { id: string; displayName: string; score: number; kind?: string }[];
  },
  localId: string,
) {
  const local = snap.fighters.find((f) => f.id === localId);
  if (holderEl) {
    if (!snap.crown.holderId) holderEl.textContent = 'unheld';
    else if (snap.crown.holderId === localId) holderEl.textContent = 'You';
    else {
      const h = snap.fighters.find((f) => f.id === snap.crown.holderId);
      holderEl.textContent = h?.displayName ?? snap.crown.holderId;
    }
  }
  if (scoreEl && local) scoreEl.textContent = local.score.toFixed(1);
  updateLeaderboard(snap, localId);
}

/** Rank Fighters (Players + Bots) by Score — ADR 0004 / CONTEXT Leaderboard. */
function updateLeaderboard(
  snap: {
    crown: { holderId: string | null };
    fighters: { id: string; displayName: string; score: number; kind?: string }[];
  },
  localId: string,
) {
  if (!leaderboardList) return;
  const ranked = snap.fighters
    .filter((f) => f.kind !== 'dummy')
    .slice()
    .sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName));

  leaderboardList.replaceChildren();
  for (const f of ranked) {
    const li = document.createElement('li');
    if (f.id === localId) li.classList.add('you');
    if (snap.crown.holderId === f.id) li.classList.add('holder');
    const name = document.createElement('span');
    name.className = 'lb-name';
    name.textContent = f.id === localId ? `${f.displayName} (you)` : f.displayName;
    const score = document.createElement('span');
    score.className = 'lb-score';
    score.textContent = f.score.toFixed(1);
    li.append(name, score);
    leaderboardList.append(li);
  }
}
