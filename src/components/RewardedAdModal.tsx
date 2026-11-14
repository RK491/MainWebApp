import { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, Play, Sparkles, Timer, X } from 'lucide-react';
import type { AdConfig } from '../types/farm';
import clayHenMascot from '../assets/images/clay_hen_mascot_1794678825872.jpg';
import { ChickenSprite } from './GameIcons';

interface RewardedAdModalProps {
  adConfig: AdConfig;
  watchedCount: number;
  fallbackNotice?: string | null;
  onComplete: () => void;
  onClose: () => void;
}

export function RewardedAdModal({
  adConfig,
  watchedCount,
  fallbackNotice,
  onComplete,
  onClose,
}: RewardedAdModalProps) {
  const totalSeconds = Math.max(3, Math.min(60, adConfig.watchSeconds || 5));
  const [secondsLeft, setSecondsLeft] = useState(totalSeconds);
  const [claimed, setClaimed] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = window.setTimeout(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [secondsLeft]);

  const progressPct = Math.round(((totalSeconds - secondsLeft) / totalSeconds) * 100);
  const readyToClaim = secondsLeft === 0;
  const sponsorUrl = adConfig.customUrl.trim();

  const handleClaim = () => {
    if (!readyToClaim || claimed) return;
    setClaimed(true);
    onComplete();
  };

  return (
    <div
      className="animate-clay-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rewarded-ad-title"
    >
      <div className="animate-clay-modal clay-card w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="clay-card-warm !rounded-xl inline-flex items-center gap-1.5 text-xs font-extrabold text-amber-800 dark:text-amber-300 px-3 py-1.5">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Sponsored Reward ({watchedCount + 1}/10)</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close ad"
            className="clay-btn clay-btn-neutral w-9 h-9 rounded-xl flex items-center justify-center text-stone-600 dark:text-stone-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="clay-card-mint !rounded-2xl p-4 text-center space-y-2.5">
          <div className="flex justify-center">
            <div className="animate-clay-float w-20 h-20 rounded-2xl clay-icon-well p-1 flex items-center justify-center overflow-hidden">
              {!imgFailed ? (
                <img
                  src={clayHenMascot}
                  alt="Clay ChickenLand mascot"
                  referrerPolicy="no-referrer"
                  onError={() => setImgFailed(true)}
                  className="w-full h-full object-cover rounded-xl"
                />
              ) : (
                <ChickenSprite breed="leghorn" className="w-12 h-12" />
              )}
            </div>
          </div>
          <h2 id="rewarded-ad-title" className="text-base font-extrabold text-stone-900 dark:text-stone-100">
            {adConfig.customTitle || 'ChickenLand Sponsor Showcase'}
          </h2>
          <p className="text-xs text-stone-600 dark:text-stone-300 leading-relaxed">
            {adConfig.customDescription ||
              'Watch until the timer ends to earn +1 progress toward a free White Leghorn.'}
          </p>

          {sponsorUrl && (
            <a
              href={sponsorUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="clay-btn clay-btn-neutral inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-extrabold text-sky-700 dark:text-sky-400"
            >
              <span>Visit Sponsor</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>

        {fallbackNotice && (
          <div className="clay-inset px-3 py-2 text-[11px] font-semibold text-stone-600 dark:text-stone-300">
            {fallbackNotice}
          </div>
        )}

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs font-bold text-stone-600 dark:text-stone-300">
            <span className="inline-flex items-center gap-1">
              <Timer className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              <span>{readyToClaim ? 'Reward unlocked!' : 'Reward timer'}</span>
            </span>
            <span className="font-mono-num text-stone-900 dark:text-stone-100">
              {readyToClaim ? 'Ready' : `${secondsLeft}s`}
            </span>
          </div>
          <div className="h-3 rounded-full clay-inset p-0.5 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all duration-500 clay-shimmer-bar"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        <button
          type="button"
          disabled={!readyToClaim}
          onClick={handleClaim}
          className={`clay-btn w-full min-h-[48px] rounded-2xl font-extrabold text-sm flex items-center justify-center gap-2 ${
            readyToClaim
              ? 'clay-btn-emerald'
              : 'clay-btn-neutral opacity-60 cursor-not-allowed text-stone-500 dark:text-stone-400'
          }`}
        >
          {readyToClaim ? (
            <>
              <CheckCircle2 className="w-4 h-4" />
              <span>Claim Ad Step ({Math.min(10, watchedCount + 1)}/10)</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              <span>Please wait {secondsLeft}s...</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
