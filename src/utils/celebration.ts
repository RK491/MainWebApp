import confetti from 'canvas-confetti';

function canRunConfetti(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (typeof window.matchMedia === 'function') {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return false;
    }
  }
  return true;
}

function safeFire(options: confetti.Options): void {
  if (!canRunConfetti()) return;
  try {
    void confetti({
      disableForReducedMotion: true,
      ...options,
    });
  } catch {
    // Ignore canvas errors in restricted headless environments
  }
}

export function triggerWithdrawalConfetti(): void {
  safeFire({
    particleCount: 65,
    spread: 68,
    origin: { y: 0.68 },
    colors: ['#10B981', '#F59E0B', '#0EA5E9', '#FDE047'],
  });
}

export function triggerTop10RankConfetti(): void {
  safeFire({
    particleCount: 55,
    angle: 60,
    spread: 55,
    origin: { x: 0.15, y: 0.65 },
    colors: ['#F59E0B', '#FBBF24', '#10B981', '#38BDF8'],
  });
  safeFire({
    particleCount: 55,
    angle: 120,
    spread: 55,
    origin: { x: 0.85, y: 0.65 },
    colors: ['#F59E0B', '#FBBF24', '#10B981', '#38BDF8'],
  });
}
