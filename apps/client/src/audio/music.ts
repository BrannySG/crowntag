const TRACK_URL = '/music/MUSIC_ChaosCups_PartyGame_Sax.ogg';
const VOLUME = 0.25;

let audio: HTMLAudioElement | null = null;
let started = false;
let unlockAttached = false;

function ensureAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio(TRACK_URL);
    audio.loop = true;
    audio.volume = VOLUME;
  }
  return audio;
}

function tryPlay(): void {
  const el = ensureAudio();
  void el.play().catch(() => {
    if (unlockAttached) return;
    unlockAttached = true;
    const unlock = () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      unlockAttached = false;
      void el.play().catch(() => {
        /* still blocked — ignore */
      });
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  });
}

/** Begin looping BGM. Idempotent — safe to call more than once. */
export function startMusic(): void {
  if (started) return;
  started = true;
  tryPlay();
}
