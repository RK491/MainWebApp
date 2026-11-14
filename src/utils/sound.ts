export const AUDIO_SETTINGS_STORAGE_KEY = 'chickenland_audio_settings_v1';

export interface AudioSettings {
  musicEnabled: boolean;
  soundsEnabled: boolean;
  preMuteMusicEnabled?: boolean;
  preMuteSoundsEnabled?: boolean;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  musicEnabled: false,
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

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return null;
    audioCtx = new AudioCtor();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export function playEggCollectSound(enabled: boolean): void {
  if (!enabled) return;
  const ctx = getCtx();
  if (!ctx) return;

  const now = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99];
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now + i * 0.055);
    gain.gain.setValueAtTime(0.08, now + i * 0.055);
    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.055 + 0.16);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + i * 0.055);
    osc.stop(now + i * 0.055 + 0.17);
  });
}

export function playCoinChimeSound(enabled: boolean): void {
  if (!enabled) return;
  const ctx = getCtx();
  if (!ctx) return;

  const now = ctx.currentTime;
  [880, 1174.66].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now + i * 0.06);
    gain.gain.setValueAtTime(0.07, now + i * 0.06);
    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.06 + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + i * 0.06);
    osc.stop(now + i * 0.06 + 0.19);
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
  osc.frequency.setValueAtTime(640, now);
  osc.frequency.exponentialRampToValueAtTime(920, now + 0.032);
  gain.gain.setValueAtTime(0.055, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.05);
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
    const duration = i === notes.length - 1 ? 0.24 : 0.14;
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.075, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.01);
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
  osc.frequency.setValueAtTime(420, now);
  osc.frequency.exponentialRampToValueAtTime(280, now + 0.05);
  gain.gain.setValueAtTime(0.04, now);
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
  const shimmer = [659.25, 783.99, 987.77, 1318.51];
  shimmer.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    const start = now + i * 0.045;
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.08, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.28);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.3);
  });
}

// Procedural warm acoustic pentatonic loop for Farm background music
const MELODY_NOTES = [
  261.63, // C4
  329.63, // E4
  392.0,  // G4
  440.0,  // A4
  392.0,  // G4
  329.63, // E4
  293.66, // D4
  329.63, // E4
  261.63, // C4
  392.0,  // G4
  523.25, // C5
  440.0,  // A4
  392.0,  // G4
  329.63, // E4
  293.66, // D4
  261.63, // C4
];

let musicIntervalId: number | null = null;
let musicMasterGain: GainNode | null = null;
let musicStepIndex = 0;
let musicRunning = false;

function triggerAmbientNote(): void {
  const ctx = getCtx();
  if (!ctx || !musicMasterGain || ctx.state !== 'running') return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

  const now = ctx.currentTime;
  const freq = MELODY_NOTES[musicStepIndex % MELODY_NOTES.length];
  const isDownbeat = musicStepIndex % 4 === 0;
  musicStepIndex = (musicStepIndex + 1) % MELODY_NOTES.length;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1100, now);

  const osc = ctx.createOscillator();
  const noteGain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, now);

  noteGain.gain.setValueAtTime(0.0001, now);
  noteGain.gain.linearRampToValueAtTime(isDownbeat ? 0.16 : 0.11, now + 0.08);
  noteGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.78);

  osc.connect(filter);
  filter.connect(noteGain);
  noteGain.connect(musicMasterGain);
  osc.start(now);
  osc.stop(now + 0.8);

  if (isDownbeat) {
    const bass = ctx.createOscillator();
    const bassGain = ctx.createGain();
    bass.type = 'triangle';
    bass.frequency.setValueAtTime(freq * 0.5, now);
    bassGain.gain.setValueAtTime(0.0001, now);
    bassGain.gain.linearRampToValueAtTime(0.09, now + 0.12);
    bassGain.gain.exponentialRampToValueAtTime(0.0008, now + 1.45);
    bass.connect(filter);
    filter.connect(bassGain);
    bassGain.connect(musicMasterGain);
    bass.start(now);
    bass.stop(now + 1.5);
  }
}

export function stopAmbientMusic(): void {
  musicRunning = false;
  if (typeof window !== 'undefined' && musicIntervalId !== null) {
    window.clearInterval(musicIntervalId);
    musicIntervalId = null;
  }
  if (musicMasterGain && audioCtx) {
    try {
      const now = audioCtx.currentTime;
      musicMasterGain.gain.setTargetAtTime(0.0001, now, 0.08);
    } catch {
      // Ignore WebAudio teardown errors
    }
  }
}

export function syncAmbientMusic(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  if (!enabled) {
    stopAmbientMusic();
    return;
  }

  const ctx = getCtx();
  if (!ctx) return;

  if (!musicMasterGain) {
    musicMasterGain = ctx.createGain();
    musicMasterGain.gain.setValueAtTime(0.18, ctx.currentTime);
    musicMasterGain.connect(ctx.destination);
  } else {
    musicMasterGain.gain.setTargetAtTime(0.18, ctx.currentTime, 0.12);
  }

  if (musicRunning && musicIntervalId !== null) return;
  musicRunning = true;
  triggerAmbientNote();
  musicIntervalId = window.setInterval(() => {
    if (musicRunning) {
      triggerAmbientNote();
    }
  }, 680);
}

