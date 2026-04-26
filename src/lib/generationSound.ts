// Lightweight WebAudio chime — no external assets needed.
// Plays a soft two-note "ding" used to signal that AI generation finished.

let audioCtx: AudioContext | null = null;
let firstSoundPlayed = false;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!audioCtx) {
      const Ctor: typeof AudioContext | undefined =
        (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return null;
      audioCtx = new Ctor();
    }
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume();
    }
    return audioCtx;
  } catch {
    return null;
  }
}

export function playGenerationCompleteChime() {
  const ctx = getCtx();
  if (!ctx) return;

  const now = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 0.0001;
  master.connect(ctx.destination);

  // Pleasant two-tone (E5 -> A5)
  const notes = [
    { freq: 659.25, start: 0, duration: 0.18 },
    { freq: 880.0, start: 0.12, duration: 0.28 },
  ];

  for (const n of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = n.freq;

    const t0 = now + n.start;
    const t1 = t0 + n.duration;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t1);

    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t1 + 0.05);
  }

  // Master envelope to soften
  master.gain.setValueAtTime(0.0001, now);
  master.gain.exponentialRampToValueAtTime(1, now + 0.01);
  master.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
}

export type GenerationSoundMode = 'first' | 'always' | 'never';

export function maybePlayGenerationSound(mode: GenerationSoundMode | string | undefined) {
  if (!mode || mode === 'never') return;
  if (mode === 'first') {
    if (firstSoundPlayed) return;
    firstSoundPlayed = true;
  }
  playGenerationCompleteChime();
}

export function resetGenerationSoundState() {
  firstSoundPlayed = false;
}
