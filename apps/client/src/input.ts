export type ClientInputState = {
  forward: number;
  strafe: number;
  yaw: number;
  sprint: boolean;
  jump: boolean;
  /** Latched until consumed by the sim pump */
  hitQueued: boolean;
  resetQueued: boolean;
};

const LOOK_SENS = 0.0022;

function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLElement && el.isContentEditable;
}

export type InputController = {
  state: ClientInputState;
  /** Read WASD / sprint / jump from the key set into `state`. */
  syncKeys: () => void;
  dispose: () => void;
  consumeHit: () => boolean;
  consumeReset: () => boolean;
};

export function createInput(canvas: HTMLElement): InputController {
  const keys = new Set<string>();
  const state: ClientInputState = {
    forward: 0,
    strafe: 0,
    yaw: 0,
    sprint: false,
    jump: false,
    hitQueued: false,
    resetQueued: false,
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (isTypingTarget(document.activeElement)) return;
    keys.add(e.code);
    if (e.code === 'KeyR') state.resetQueued = true;
    if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) e.preventDefault();
  };
  const onKeyUp = (e: KeyboardEvent) => {
    // Always release — keyup while typing must still clear held game keys.
    keys.delete(e.code);
  };
  const onBlur = () => keys.clear();

  const onClick = () => {
    if (document.pointerLockElement !== canvas) {
      canvas.requestPointerLock();
    }
  };

  const onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement !== canvas) return;
    state.yaw -= e.movementX * LOOK_SENS;
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button === 0 && document.pointerLockElement === canvas) {
      state.hitQueued = true;
    }
  };

  addEventListener('keydown', onKeyDown);
  addEventListener('keyup', onKeyUp);
  addEventListener('blur', onBlur);
  canvas.addEventListener('click', onClick);
  document.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('pointerdown', onPointerDown);

  return {
    state,
    syncKeys: () => {
      if (isTypingTarget(document.activeElement)) {
        state.forward = 0;
        state.strafe = 0;
        state.sprint = false;
        state.jump = false;
        return;
      }
      let f = 0;
      let r = 0;
      if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) r += 1;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) r -= 1;
      state.forward = f;
      state.strafe = r;
      state.sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
      state.jump = keys.has('Space');
    },
    dispose: () => {
      removeEventListener('keydown', onKeyDown);
      removeEventListener('keyup', onKeyUp);
      removeEventListener('blur', onBlur);
      canvas.removeEventListener('click', onClick);
      document.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('pointerdown', onPointerDown);
    },
    consumeHit: () => {
      const v = state.hitQueued;
      state.hitQueued = false;
      return v;
    },
    consumeReset: () => {
      const v = state.resetQueued;
      state.resetQueued = false;
      return v;
    },
  };
}
