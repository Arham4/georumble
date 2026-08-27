// Minimal WebAudio feedback: short soft blips for find/miss/victory. No
// background music — just interaction confirmation. The context is lazy
// (created on the first gesture-driven call, per autoplay policy) and the
// mute state persists per device.
const MUTED_KEY = "georush:sfx-muted";

let ctx: AudioContext | null = null;
let muted = false;
try {
  muted = localStorage.getItem(MUTED_KEY) === "1";
} catch {
  // Storage can throw in private modes; sounds just start unmuted.
}

function audio(): AudioContext | null {
  if (muted) {
    return null;
  }
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") {
      void ctx.resume();
    }
    return ctx;
  } catch {
    return null;
  }
}

function blip(freq: number, delay: number, duration: number, gain: number): void {
  const audioCtx = audio();
  if (!audioCtx) {
    return;
  }
  const osc = audioCtx.createOscillator();
  const amp = audioCtx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  const at = audioCtx.currentTime + delay;
  amp.gain.setValueAtTime(0, at);
  amp.gain.linearRampToValueAtTime(gain, at + 0.01);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  osc.connect(amp);
  amp.connect(audioCtx.destination);
  osc.start(at);
  osc.stop(at + duration + 0.05);
}

export const sfx = {
  get muted(): boolean {
    return muted;
  },
  toggle(): boolean {
    muted = !muted;
    try {
      localStorage.setItem(MUTED_KEY, muted ? "1" : "0");
    } catch {
      // Preference is best-effort; the toggle still works this session.
    }
    return muted;
  },
  correct(): void {
    blip(660, 0, 0.12, 0.07);
    blip(880, 0.07, 0.14, 0.06);
  },
  miss(): void {
    blip(150, 0, 0.16, 0.05);
  },
  /** Slot-machine tick for the map-roll sweep; pitch rises as it slows. */
  tick(progress: number): void {
    blip(440 + progress * 260, 0, 0.04, 0.028);
  },
  win(): void {
    blip(523, 0, 0.14, 0.07);
    blip(659, 0.12, 0.14, 0.07);
    blip(784, 0.24, 0.24, 0.08);
  },
};
