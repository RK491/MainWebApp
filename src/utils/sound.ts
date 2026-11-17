export const AUDIO_SETTINGS_STORAGE_KEY = 'chickenland_audio_settings_v2';

export interface AudioSettings {
  musicEnabled: boolean;
  soundsEnabled: boolean;
  preMuteMusicEnabled?: boolean;
  preMuteSoundsEnabled?: boolean;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  musicEnabled: true,
  soundsEnabled: true,
};

export function isAllAudioMuted(settings: Pick<AudioSettings, 'musicEnabled' | 'soundsEnabled'>): boolean {
  return !settings.musicEnabled && !settings.soundsEnabled;
}

export function computeMuteAllToggle(current: AudioSettings): AudioSettings {
  if (!isAllAudioMuted(current)) {
    return {
      musicEnabled: false,
      soundsEnabled: false,
      preMuteMusicEnabled: current.musicEnabled,
      preMuteSoundsEnabled: current.soundsEnabled,
    };
  }

  const hadPreMuteMusic = Boolean(current.preMuteMusicEnabled);
  const hadPreMuteSounds = Boolean(current.preMuteSoundsEnabled);
  if (hadPreMuteMusic || hadPreMuteSounds) {
    return {
      musicEnabled: hadPreMuteMusic,
      soundsEnabled: hadPreMuteSounds,
      preMuteMusicEnabled: current.preMuteMusicEnabled,
      preMuteSoundsEnabled: current.preMuteSoundsEnabled,
    };
  }

  return {
    musicEnabled: true,
    soundsEnabled: true,
    preMuteMusicEnabled: true,
    preMuteSoundsEnabled: true,
  };
}

export function getStoredAudioSettings(): AudioSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_AUDIO_SETTINGS };
  try {
    const raw = window.localStorage.getItem(AUDIO_SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_AUDIO_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AudioSettings> | null;
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_AUDIO_SETTINGS };
    return {
      musicEnabled:
        typeof parsed.musicEnabled === 'boolean'
          ? parsed.musicEnabled
          : DEFAULT_AUDIO_SETTINGS.musicEnabled,
      soundsEnabled:
        typeof parsed.soundsEnabled === 'boolean'
          ? parsed.soundsEnabled
          : DEFAULT_AUDIO_SETTINGS.soundsEnabled,
      ...(typeof parsed.preMuteMusicEnabled === 'boolean'
        ? { preMuteMusicEnabled: parsed.preMuteMusicEnabled }
        : {}),
      ...(typeof parsed.preMuteSoundsEnabled === 'boolean'
        ? { preMuteSoundsEnabled: parsed.preMuteSoundsEnabled }
        : {}),
    };
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
}

export function setStoredAudioSettings(settings: AudioSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(AUDIO_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage errors
  }
}

let audioCtx: AudioContext | null = null;
let noiseBuffer: AudioBuffer | null = null;
let musicIntervalId: number | null = null;
let musicMasterGain: GainNode | null = null;
let musicStepIndex = 0;
let musicRunning = false;
let musicShouldPlay = false;
let gestureHooksAttached = false;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return null;
    audioCtx = new AudioCtor();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx
      .resume()
      .then(() => {
        if (musicShouldPlay && musicRunning && audioCtx?.state === 'running') {
          ensureMusicMasterGain(audioCtx);
        }
      })
      .catch(() => {});
  }
  return audioCtx;
}

function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) {
    return noiseBuffer;
  }
  const len = Math.floor(ctx.sampleRate * 0.08);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  }
  noiseBuffer = buf;
  return buf;
}

function ensureGestureUnlockHooks(): void {
  if (typeof window === 'undefined' || gestureHooksAttached) return;
  gestureHooksAttached = true;

  const unlock = () => {
    if (!musicShouldPlay) return;
    const ctx = getCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx
        .resume()
        .then(() => {
          if (musicShouldPlay && ctx.state === 'running') {
            ensureMusicMasterGain(ctx);
            triggerCozyFarmBeat();
          }
        })
        .catch(() => {});
    }
  };

  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('touchend', unlock, { passive: true });
  window.addEventListener('click', unlock, { passive: true });
  window.addEventListener('keydown', unlock, { passive: true });
}

export function playEggCollectSound(enabled: boolean): void {
  if (!enabled) return;
  const ctx = getCtx();
  if (!ctx) return;

  const now = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = i === notes.length - 1 ? 'sine' : 'triangle';
    const start = now + i * 0.048;
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.095, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.17);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.18);
  });
}

export function playCoinChimeSound(enabled: boolean): void {
  if (!enabled) return;
  const ctx = getCtx();
  if (!ctx) return;

  const now = ctx.currentTime;
  [1046.5, 1318.51, 1567.98].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    const start = now + i * 0.05;
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.085, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.19);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.2);
  });
}

export function playTabTapSound(enabled: boolean): void {
  if (!enabled) return;
  const ctx = getCtx();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(620, now);
  osc.frequency.exponentialRampToValueAtTime(940, now + 0.032);
  gain.gain.setValueAtTime(0.065, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.048);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.055);
}

export function playClaimSound(enabled: boolean): void {
  if (!enabled) return;
  const ctx = getCtx();
  if (!ctx) return;

  const now = ctx.currentTime;
  const notes = [587.33, 739.99, 880, 1174.66];
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = i === notes.length - 1 ? 'triangle' : 'sine';
    const start = now + i * 0.05;
    const duration = i === notes.length - 1 ? 0.26 : 0.14;
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.09, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.01);
  });
}

export function playPurchaseSuccessSound(enabled: boolean): void {
  if (!enabled) return;
  const ctx = getCtx();
  if (!ctx) return;

  const now = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99, 987.77, 1046.5];
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    const start = now + i * 0.042;
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.085, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.22);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.23);
  });
}

export function playChickenCluckSound(enabled: boolean): void {
  if (!enabled) return;
  const ctx = getCtx();
  if (!ctx) return;

  const now = ctx.currentTime;
  // Cheerful two-chirp farm cluck
  [0, 0.095].forEach((offset, idx) => {
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    const start = now + offset;
    const baseFreq = idx === 0 ? 490 : 580;
    osc.frequency.setValueAtTime(baseFreq, start);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.42, start + 0.03);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.78, start + 0.078);

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(980, start);
    filter.Q.setValueAtTime(2.2, start);

    gain.gain.setValueAtTime(0.001, start);
    gain.gain.linearRampToValueAtTime(0.11, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.082);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.088);
  });
}

export function playSoftTapSound(enabled: boolean): void {
  if (!enabled) return;
  const ctx = getCtx();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(460, now);
  osc.frequency.exponentialRampToValueAtTime(300, now + 0.05);
  gain.gain.setValueAtTime(0.05, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.065);
}

export function playGoldenEggSound(enabled: boolean): void {
  if (!enabled) return;
  const ctx = getCtx();
  if (!ctx) return;

  const now = ctx.currentTime;
  const shimmer = [659.25, 783.99, 987.77, 1318.51, 1567.98];
  shimmer.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    const start = now + i * 0.045;
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.09, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.28);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.3);
  });
}

// ============================================================================
// COZY PASTORAL FARM BGM SYNTHESIZER (32-step C Major / A Minor / F / G Loop)
// Warm acoustic kalimba/guitar pluck + marimba chord pad + soft bass + light shaker
// ============================================================================
const FARM_MELODY_STEPS: ReadonlyArray<number | null> = [
  // Bar 1 (Cmaj7)
  523.25, 659.25, 783.99, 659.25, 880.0, 783.99, 659.25, 587.33,
  // Bar 2 (Am7)
  440.0, 523.25, 659.25, 523.25, 783.99, 659.25, 523.25, 493.88,
  // Bar 3 (Fmaj7)
  349.23, 440.0, 523.25, 659.25, 587.33, 523.25, 440.0, 392.0,
  // Bar 4 (G6 -> G7 resolve)
  392.0, 493.88, 587.33, 659.25, 587.33, 493.88, 440.0, 392.0,
];

const BAR_CHORDS: ReadonlyArray<{ bass: number; chord: readonly [number, number, number] }> = [
  { bass: 130.81, chord: [261.63, 329.63, 392.0] }, // Cmaj
  { bass: 110.0, chord: [220.0, 261.63, 329.63] },  // Am
  { bass: 87.31, chord: [174.61, 220.0, 261.63] },  // Fmaj
  { bass: 98.0, chord: [196.0, 246.94, 293.66] },   // Gmaj
];

function ensureMusicMasterGain(ctx: AudioContext): GainNode {
  if (!musicMasterGain) {
    musicMasterGain = ctx.createGain();
    musicMasterGain.gain.setValueAtTime(0.32, ctx.currentTime);
    musicMasterGain.connect(ctx.destination);
  } else {
    musicMasterGain.gain.setTargetAtTime(0.32, ctx.currentTime, 0.1);
  }
  return musicMasterGain;
}

function triggerCozyFarmBeat(): void {
  const ctx = getCtx();
  if (!ctx || ctx.state !== 'running') return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

  const master = ensureMusicMasterGain(ctx);
  const now = ctx.currentTime;
  const step = musicStepIndex % FARM_MELODY_STEPS.length;
  const barIdx = Math.floor(step / 8) % BAR_CHORDS.length;
  const stepInBar = step % 8;
  musicStepIndex = (musicStepIndex + 1) % FARM_MELODY_STEPS.length;

  const melodyFreq = FARM_MELODY_STEPS[step];
  if (melodyFreq) {
    // Acoustic pluck filter
    const pluckFilter = ctx.createBiquadFilter();
    pluckFilter.type = 'lowpass';
    pluckFilter.frequency.setValueAtTime(2200, now);
    pluckFilter.frequency.exponentialRampToValueAtTime(750, now + 0.42);

    const leadOsc = ctx.createOscillator();
    const leadGain = ctx.createGain();
    leadOsc.type = 'triangle';
    leadOsc.frequency.setValueAtTime(melodyFreq, now);

    const accent = stepInBar === 0 || stepInBar === 4 ? 0.17 : 0.125;
    leadGain.gain.setValueAtTime(0.0005, now);
    leadGain.gain.linearRampToValueAtTime(accent, now + 0.018);
    leadGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.52);

    leadOsc.connect(pluckFilter);
    pluckFilter.connect(leadGain);
    leadGain.connect(master);
    leadOsc.start(now);
    leadOsc.stop(now + 0.55);

    // Subtle soft octave shimmer on bar downbeat & beat 3
    if (stepInBar === 0 || stepInBar === 4) {
      const shimmerOsc = ctx.createOscillator();
      const shimmerGain = ctx.createGain();
      shimmerOsc.type = 'sine';
      shimmerOsc.frequency.setValueAtTime(melodyFreq * 2, now);
      shimmerGain.gain.setValueAtTime(0.0005, now);
      shimmerGain.gain.linearRampToValueAtTime(0.032, now + 0.025);
      shimmerGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.36);
      shimmerOsc.connect(shimmerGain);
      shimmerGain.connect(master);
      shimmerOsc.start(now);
      shimmerOsc.stop(now + 0.38);
    }
  }

  const bar = BAR_CHORDS[barIdx];

  // Warm bass pulse on beats 1 and 3 (steps 0 and 4)
  if (stepInBar === 0 || stepInBar === 4) {
    const bassFilter = ctx.createBiquadFilter();
    bassFilter.type = 'lowpass';
    bassFilter.frequency.setValueAtTime(420, now);

    const bassOsc = ctx.createOscillator();
    const bassGain = ctx.createGain();
    bassOsc.type = 'triangle';
    bassOsc.frequency.setValueAtTime(
      stepInBar === 0 ? bar.bass : bar.bass * 1.5,
      now,
    );
    bassGain.gain.setValueAtTime(0.0005, now);
    bassGain.gain.linearRampToValueAtTime(0.14, now + 0.03);
    bassGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.72);
    bassOsc.connect(bassFilter);
    bassFilter.connect(bassGain);
    bassGain.connect(master);
    bassOsc.start(now);
    bassOsc.stop(now + 0.75);
  }

  // Soft warm chord pad on the start of each bar
  if (stepInBar === 0) {
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.setValueAtTime(900, now);
    padFilter.connect(master);

    bar.chord.forEach((chordFreq) => {
      const padOsc = ctx.createOscillator();
      const padGain = ctx.createGain();
      padOsc.type = 'sine';
      padOsc.frequency.setValueAtTime(chordFreq, now);
      padGain.gain.setValueAtTime(0.0005, now);
      padGain.gain.linearRampToValueAtTime(0.042, now + 0.18);
      padGain.gain.exponentialRampToValueAtTime(0.0008, now + 2.1);
      padOsc.connect(padGain);
      padGain.connect(padFilter);
      padOsc.start(now);
      padOsc.stop(now + 2.15);
    });
  }

  // Soft cozy acoustic shaker / brush tick on off-beats
  if (stepInBar % 2 === 1) {
    const src = ctx.createBufferSource();
    src.buffer = getNoiseBuffer(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(4200, now);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(7200, now);
    const tickGain = ctx.createGain();
    tickGain.gain.setValueAtTime(0.024, now);
    tickGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.045);

    src.connect(hp);
    hp.connect(lp);
    lp.connect(tickGain);
    tickGain.connect(master);
    src.start(now);
    src.stop(now + 0.05);
  }
}

export function stopAmbientMusic(): void {
  musicShouldPlay = false;
  musicRunning = false;
  if (typeof window !== 'undefined' && musicIntervalId !== null) {
    window.clearInterval(musicIntervalId);
    musicIntervalId = null;
  }
  if (musicMasterGain && audioCtx) {
    try {
      const now = audioCtx.currentTime;
      musicMasterGain.gain.setTargetAtTime(0.0001, now, 0.05);
    } catch {
      // Ignore WebAudio teardown errors
    }
  }
  if (
    audioCtx &&
    audioCtx.state === 'running' &&
    typeof document !== 'undefined' &&
    document.visibilityState === 'hidden'
  ) {
    audioCtx.suspend().catch(() => {});
  }
}

export function syncAmbientMusic(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  if (!enabled || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) {
    stopAmbientMusic();
    return;
  }

  musicShouldPlay = true;
  ensureGestureUnlockHooks();

  const ctx = getCtx();
  if (!ctx) return;

  if (ctx.state === 'running') {
    ensureMusicMasterGain(ctx);
  }

  if (musicRunning && musicIntervalId !== null) return;
  musicRunning = true;
  if (ctx.state === 'running') {
    triggerCozyFarmBeat();
  }
  musicIntervalId = window.setInterval(() => {
    if (musicRunning && musicShouldPlay) {
      triggerCozyFarmBeat();
    }
  }, 290);
}
