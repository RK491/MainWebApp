import { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, Gift, Play, Sparkles, Timer, X } from 'lucide-react';
import { CHICKEN_PACKS } from '../game/economy';
import type { AdConfig, ChickenBreedId } from '../types/farm';
import clayHenMascot from '../assets/images/clay_hen_mascot_1794678825872.jpg';
import { ChickenSprite, CoinIcon, EggIcon } from './GameIcons';

export type ModalAdActionKind =
  | 'startup'
  | 'collect_eggs'
  | 'claim_promo'
  | 'buy_chicken'
  | 'ad_network'
  | 'watch_ad';

interface RewardedAdModalProps {
  adConfig: AdConfig;
  watchedCount: number;
  actionKind?: ModalAdActionKind;
  networkLabel?: string | null;
  rewardCoins?: number | null;
  pendingEggs?: number | null;
  promoCode?: string | null;
  promoRewardSummary?: string | null;
  chickenBreed?: ChickenBreedId | null;
  chickenQty?: number | null;
  minerCostCoins?: number | null;
  fallbackNotice?: string | null;
  mandatory?: boolean;
  onComplete: () => void;
  onClose: () => void;
}

export function RewardedAdModal({
  adConfig,
  watchedCount,
  actionKind = 'watch_ad',
  networkLabel,
  rewardCoins,
  pendingEggs,
  promoCode,
  promoRewardSummary,
  chickenBreed,
  chickenQty,
  minerCostCoins,
  fallbackNotice,
  mandatory = false,
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
  const hasCoinReward = typeof rewardCoins === 'number' && rewardCoins > 0;
  const safeEggs = Math.max(0, Math.floor(Number(pendingEggs ?? 0)));
  const safeChickenQty = Math.max(1, Math.floor(Number(chickenQty ?? 1)));
  const minerPack = chickenBreed
    ? CHICKEN_PACKS.find((p) => p.id === chickenBreed) ?? null
    : null;
  const minerPackName = minerPack?.name || 'Hen Miner';
  const safeMinerCost = Math.max(0, Math.floor(Number(minerCostCoins ?? 0)));

  const handleClaim = () => {
    if (!readyToClaim || claimed) return;
    setClaimed(true);
    onComplete();
  };

  const badgeText = (() => {
    if (actionKind === 'startup') return 'App Launch Ad';
    if (actionKind === 'collect_eggs') return 'Egg Harvest Ad';
    if (actionKind === 'claim_promo') return 'Gift Code Ad';
    if (actionKind === 'buy_chicken') return 'Miner Purchase Ad';
    if (networkLabel) return `${networkLabel} Reward`;
    return `Sponsored Reward (${watchedCount + 1}/10)`;
  })();

  const headline = (() => {
    if (actionKind === 'startup') return adConfig.customTitle || 'Welcome to Alpha Gram';
    if (actionKind === 'collect_eggs') return 'Unlock Egg Harvest';
    if (actionKind === 'claim_promo') return `Unlock Gift ${promoCode || 'Code'}`;
    if (actionKind === 'buy_chicken') return `Unlock ${safeChickenQty}× ${minerPackName}`;
    if (networkLabel) return `${networkLabel} Daily Ad`;
    return adConfig.customTitle || 'Alpha Gram Sponsor Showcase';
  })();

  const description = (() => {
    if (actionKind === 'startup') {
      return 'Watch this short ad to enter your farm & start mining.';
    }
    if (actionKind === 'collect_eggs') {
      return `Complete the ad timer to collect +${safeEggs.toLocaleString()} eggs into your basket.`;
    }
    if (actionKind === 'claim_promo') {
      return `Complete the ad timer to claim ${promoCode || 'your gift code'}${
        promoRewardSummary ? ` (${promoRewardSummary})` : ''
      }.`;
    }
    if (actionKind === 'buy_chicken') {
      return `Complete the ad timer to confirm buying ${safeChickenQty}× ${minerPackName}${
        safeMinerCost > 0 ? ` for ${safeMinerCost.toLocaleString()} coins` : ''
      }.`;
    }
    if (hasCoinReward) {
      return `Watch until the timer ends to earn +${rewardCoins} coins & +1/10 progress toward a free White Leghorn.`;
    }
    return (
      adConfig.customDescription ||
      'Watch until the timer ends to earn +1 progress toward a free White Leghorn.'
    );
  })();

  const completeButtonLabel = (() => {
    if (actionKind === 'startup') return 'Continue to Alpha Gram';
    if (actionKind === 'collect_eggs') return `Collect +${safeEggs.toLocaleString()} Eggs`;
    if (actionKind === 'claim_promo') return `Claim Gift (${promoCode || 'Reward'})`;
    if (actionKind === 'buy_chicken') return `Buy ${safeChickenQty}× ${minerPackName}`;
    if (hasCoinReward) return `Claim +${rewardCoins} Coins`;
    return `Claim Ad Step (${Math.min(10, watchedCount + 1)}/10)`;
  })();

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
            <span>{badgeText}</span>
          </div>
          {!mandatory && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Cancel ad without claiming"
              title="Closing early cancels the reward"
              className="clay-btn clay-btn-neutral w-9 h-9 rounded-xl flex items-center justify-center text-stone-600 dark:text-stone-300"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="clay-card-mint !rounded-2xl p-4 text-center space-y-2.5">
          <div className="flex justify-center">
            <div className="animate-clay-float w-20 h-20 rounded-2xl clay-icon-well p-1 flex items-center justify-center overflow-hidden">
              {actionKind === 'buy_chicken' && chickenBreed ? (
                <ChickenSprite breed={chickenBreed} className="w-14 h-14" />
              ) : !imgFailed ? (
                <img
                  src={clayHenMascot}
                  alt="Clay Alpha Gram mascot"
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
            {headline}
          </h2>
          <p className="text-xs text-stone-600 dark:text-stone-300 leading-relaxed">
            {description}
          </p>

          {actionKind === 'collect_eggs' && safeEggs > 0 && (
            <div className="inline-flex items-center gap-1.5 rounded-xl bg-amber-100/80 dark:bg-amber-950/60 border border-amber-300/70 dark:border-amber-700/50 px-3 py-1 text-xs font-extrabold text-amber-800 dark:text-amber-300">
              <EggIcon className="w-4 h-4" />
              <span className="font-mono-num">+{safeEggs.toLocaleString()} eggs</span>
            </div>
          )}

          {actionKind === 'claim_promo' && promoRewardSummary && (
            <div className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-100/80 dark:bg-emerald-950/60 border border-emerald-300/70 dark:border-emerald-700/50 px-3 py-1 text-xs font-extrabold text-emerald-800 dark:text-emerald-300">
              <Gift className="w-4 h-4" />
              <span>{promoRewardSummary}</span>
            </div>
          )}

          {actionKind === 'buy_chicken' && chickenBreed && (
            <div className="inline-flex items-center gap-2 rounded-xl bg-amber-100/80 dark:bg-amber-950/60 border border-amber-300/70 dark:border-amber-700/50 px-3 py-1 text-xs font-extrabold text-amber-900 dark:text-amber-200">
              <ChickenSprite breed={chickenBreed} className="w-4 h-4" />
              <span>
                +{safeChickenQty} {minerPackName}
              </span>
              {safeMinerCost > 0 && (
                <span className="inline-flex items-center gap-1 font-mono-num text-stone-700 dark:text-stone-200">
                  · <CoinIcon className="w-3.5 h-3.5" /> {safeMinerCost.toLocaleString()}
                </span>
              )}
            </div>
          )}

          {hasCoinReward && (
            <div className="inline-flex items-center gap-1.5 rounded-xl bg-amber-100/80 dark:bg-amber-950/60 border border-amber-300/70 dark:border-amber-700/50 px-3 py-1 text-xs font-extrabold text-amber-800 dark:text-amber-300">
              <CoinIcon className="w-4 h-4" />
              <span className="font-mono-num">+{rewardCoins} coins</span>
            </div>
          )}

          {sponsorUrl && (
            <div>
              <a
                href={sponsorUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="clay-btn clay-btn-neutral inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-extrabold text-sky-700 dark:text-sky-400"
              >
                <span>Visit Sponsor</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
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
              <span>{readyToClaim ? 'Ad completed!' : 'Complete ad to unlock'}</span>
            </span>
            <span className="font-mono-num text-stone-900 dark:text-stone-100">
              {readyToClaim ? 'Ready' : `${secondsLeft}s`}
            </span>
          </div>
          <div className="h-3 rounded-xl clay-inset p-0.5 overflow-hidden">
            <div
              className="h-full rounded-lg bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all duration-500 clay-shimmer-bar"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          {!mandatory && !readyToClaim && (
            <p className="text-[10px] font-semibold text-stone-400 dark:text-stone-500 text-center">
              Closing early cancels this claim until the ad completes.
            </p>
          )}
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
              <span>{completeButtonLabel}</span>
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
