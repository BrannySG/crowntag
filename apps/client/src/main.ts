import { createOfflineWorld, FIXED_DT } from '@crowntag/sim';
import { createArenaScene } from './scene';
import { createInput } from './input';

const app = document.getElementById('app');
if (!app) throw new Error('#app missing');

const holderEl = document.getElementById('holder');
const scoreEl = document.getElementById('score');
const hintEl = document.getElementById('hint');

const world = createOfflineWorld();
const arena = createArenaScene(app);
const input = createInput(arena.renderer.domElement);

document.addEventListener('pointerlockchange', () => {
  if (!hintEl) return;
  const locked = document.pointerLockElement === arena.renderer.domElement;
  hintEl.classList.toggle('hidden', locked);
});

let accumulator = 0;
let last = performance.now();

function frame(now: number) {
  const frameDt = Math.min((now - last) / 1000, 0.05);
  last = now;
  accumulator += frameDt;

  input.syncKeys();

  if (input.consumeReset()) {
    world.send({ type: 'reset' });
    input.state.yaw = Math.PI;
  }

  // Only consume hit when at least one sim tick runs this frame (avoid dropping clicks).
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
  arena.updateFromSnapshot(snap, input.state.yaw, frameDt);
  arena.renderer.render(arena.scene, arena.camera);

  const player = snap.fighters.find((f) => f.id === 'player');
  if (holderEl) {
    if (!snap.crown.holderId) holderEl.textContent = 'unheld';
    else if (snap.crown.holderId === 'player') holderEl.textContent = 'You';
    else {
      const h = snap.fighters.find((f) => f.id === snap.crown.holderId);
      holderEl.textContent = h?.displayName ?? snap.crown.holderId;
    }
  }
  if (scoreEl && player) {
    scoreEl.textContent = player.score.toFixed(1);
  }

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
