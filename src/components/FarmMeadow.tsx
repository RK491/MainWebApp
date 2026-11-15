import { useEffect, useMemo, useRef, useState } from 'react';
import { Award, Package, Sparkles, X, Zap } from 'lucide-react';
import { motion } from 'motion/react';
import type { ChickenBreedId, UserFarmProfile } from '../types/farm';
import {
  calculateProductionRate,
  calculateTotalChickens,
  CHICKEN_MILESTONES,
  type ChickenMilestoneInfo,
  FEED_BOOSTER_COST_COINS,
  getChickenMilestoneReached,
  GOLDEN_EGG_REWARD_COINS,
  isFeedBoosterActive,
  isGoldenEggReady,
} from '../game/economy';
import { ChickenSprite, EggIcon } from './GameIcons';
import farmMeadowBg from '../assets/images/clay_farm_meadow_1794678824788.jpg';

interface FarmMeadowProps {
  profile: UserFarmProfile;
  pendingEggs: number;
  collectLabel: string;
  isVisible?: boolean;
  isProfileSynced?: boolean;
  onCollect: () => void;
  onOpenYourFarm: () => void;
  onChickenTap: () => void;
  onGoldenEggDrop?: () => void;
  onActivateBooster?: () => void;
  onBuyChickens?: () => void;
}

interface RoamingHen {
  id: string;
  breed: ChickenBreedId;
  x: number;
  y: number;
  facingLeft: boolean;
  delayMs: number;
}

const SPAWN_SPOTS = [
  { x: 46, y: 56 },
  { x: 35, y: 63 },
  { x: 54, y: 68 },
  { x: 64, y: 54 },
  { x: 42, y: 48 },
  { x: 68, y: 67 },
  { x: 30, y: 55 },
  { x: 50, y: 62 },
  { x: 40, y: 71 },
  { x: 60, y: 47 },
  { x: 25, y: 60 },
  { x: 58, y: 72 },
  { x: 72, y: 59 },
  { x: 36, y: 47 },
  { x: 48, y: 73 },
  { x: 55, y: 52 },
];

function getStoredMilestone(uid: string): number {
  try {
    const raw = localStorage.getItem(`chickenland_milestone_${uid}`);
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

function setStoredMilestone(uid: string, milestone: number): void {
  try {
    localStorage.setItem(`chickenland_milestone_${uid}`, String(milestone));
  } catch {
    // Ignore storage errors
  }
}

function formatCountdownMs(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const POLLEN_MOTES = [
  { left: '16%', top: '34%', delay: '0s', size: 'w-2 h-2' },
  { left: '34%', top: '44%', delay: '1.1s', size: 'w-1.5 h-1.5' },
  { left: '56%', top: '30%', delay: '2.2s', size: 'w-2 h-2' },
  { left: '74%', top: '42%', delay: '0.7s', size: 'w-1.5 h-1.5' },
  { left: '84%', top: '28%', delay: '3.1s', size: 'w-2 h-2' },
  { left: '24%', top: '58%', delay: '1.8s', size: 'w-1.5 h-1.5' },
];

export function FarmMeadow({
  profile,
  pendingEggs,
  collectLabel,
  isVisible = true,
  isProfileSynced = true,
  onCollect,
  onOpenYourFarm,
  onChickenTap,
  onGoldenEggDrop,
  onActivateBooster,
  onBuyChickens,
}: FarmMeadowProps) {
  const [bgFailed, setBgFailed] = useState(false);
  const [stepTick, setStepTick] = useState(0);
  const [liveNowMs, setLiveNowMs] = useState(() => Date.now());
  const [chirps, setChirps] = useState<Array<{ seq: number; henId: string; text: string; isGolden: boolean }>>([]);
  const [poppedHen, setPoppedHen] = useState<{ id: string; seq: number } | null>(null);
  const [activeMilestone, setActiveMilestone] = useState<ChickenMilestoneInfo | null>(null);

  const prevUidRef = useRef<string>(profile.uid);
  const prevTotalChickensRef = useRef<number | null>(null);
  const chirpSeqRef = useRef(0);
  const popTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => {
      setLiveNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const boosterActive = isFeedBoosterActive(profile, liveNowMs);
  const boostRemainingMs = Math.max(0, Number(profile.feedBoostUntilMs ?? 0) - liveNowMs);
  const goldenReady = isGoldenEggReady(profile, liveNowMs);
  const productionRate = calculateProductionRate(profile, liveNowMs);
  const totalChickens = calculateTotalChickens(profile);

  useEffect(() => {
    if (prevUidRef.current !== profile.uid) {
      prevUidRef.current = profile.uid;
      prevTotalChickensRef.current = null;
      setActiveMilestone(null);
    }

    if (!isProfileSynced) return;

    if (prevTotalChickensRef.current === null) {
      prevTotalChickensRef.current = totalChickens;
      const stored = getStoredMilestone(profile.uid);
      if (stored === 0) {
        const baseline = [...CHICKEN_MILESTONES].reverse().find((m) => totalChickens >= m) ?? 0;
        if (baseline > 0) {
          setStoredMilestone(profile.uid, baseline);
        }
      }
      return;
    }

    const prevCount = prevTotalChickensRef.current;
    prevTotalChickensRef.current = totalChickens;

    if (totalChickens > prevCount) {
      const reached = getChickenMilestoneReached(prevCount, totalChickens);
      const storedMax = getStoredMilestone(profile.uid);
      if (reached && reached.threshold > storedMax) {
        setStoredMilestone(profile.uid, reached.threshold);
        setActiveMilestone(reached);
      }
    }
  }, [isProfileSynced, profile.uid, totalChickens]);

  useEffect(() => {
    const visibleInViewport =
      isVisible || (typeof window !== 'undefined' && window.innerWidth >= 1024);
    if (!activeMilestone || !visibleInViewport) return;
    const timer = window.setTimeout(() => {
      setActiveMilestone(null);
    }, 9000);
    return () => window.clearTimeout(timer);
  }, [activeMilestone, isVisible]);

  const baseHens = useMemo(() => {
    const list: ChickenBreedId[] = [];
    const pushCount = (breed: ChickenBreedId, count: number, cap: number) => {
      for (let i = 0; i < Math.min(count, cap); i += 1) {
        list.push(breed);
      }
    };
    pushCount('australorp', profile.australorpCount, 4);
    pushCount('orpington', profile.orpingtonCount, 4);
    pushCount('rhode', profile.rhodeCount, 4);
    pushCount('leghorn', profile.leghornCount, 6);
    return list.slice(0, 16);
  }, [profile.australorpCount, profile.orpingtonCount, profile.rhodeCount, profile.leghornCount]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setStepTick((t) => t + 1);
    }, 3200);
    return () => {
      window.clearInterval(id);
      if (popTimerRef.current) window.clearTimeout(popTimerRef.current);
    };
  }, []);

  const roamingHens: RoamingHen[] = useMemo(() => {
    return baseHens.map((breed, idx) => {
      const spot = SPAWN_SPOTS[idx % SPAWN_SPOTS.length];
      const phase = (stepTick + idx) % 4;
      const dx = phase === 0 ? 0 : phase === 1 ? 4.5 : phase === 2 ? 2 : -4;
      const dy = phase === 0 ? 0 : phase === 1 ? -2.5 : phase === 2 ? 3 : -1;
      return {
        id: `${breed}-${idx}`,
        breed,
        x: Math.max(14, Math.min(84, spot.x + dx)),
        y: Math.max(42, Math.min(76, spot.y + dy)),
        facingLeft: phase >= 2,
        delayMs: (idx % 5) * 200,
      };
    });
  }, [baseHens, stepTick]);

  const fillPct = Math.min(100, Math.round((pendingEggs / Math.max(1, profile.basketCapacity)) * 100));

  return (
    <section
      aria-label="Interactive Chicken Farm Meadow"
      className="animate-clay-enter clay-card relative w-full overflow-hidden !rounded-[2rem] bg-gradient-to-b from-sky-200 via-lime-300 to-emerald-600 aspect-[3/4] max-h-[620px] min-h-[430px]"
    >
      {!bgFailed && (
        <img
          src={farmMeadowBg}
          alt="Claymorphism Alpha Gram farm meadow with sculpted red barn, pasture hills, hay bales, and pond"
          referrerPolicy="no-referrer"
          onError={() => setBgFailed(true)}
          className="absolute inset-0 w-full h-full object-cover object-center scale-[1.06] select-none pointer-events-none"
        />
      )}

      {/* Ambient sunlit golden pollen motes */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        {POLLEN_MOTES.map((mote, idx) => (
          <span
            key={idx}
            style={{ left: mote.left, top: mote.top, animationDelay: mote.delay }}
            className={`animate-pollen-drift absolute ${mote.size} rounded-full bg-amber-200/80 shadow-[0_0_8px_rgba(253,230,138,0.8)]`}
          />
        ))}
      </div>

      {/* Subtle bottom scrim so dock controls maintain high readability */}
      <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/50 via-black/15 to-transparent pointer-events-none" />

      {/* Top Meadow HUD: 2x Booster Status + Golden Egg Ready Sparkle (or 0-Hen status) */}
      {!activeMilestone && (
        <div className="absolute top-3 inset-x-3 z-20 flex items-center justify-between gap-2 pointer-events-none">
          {totalChickens <= 0 ? (
            <div className="clay-card pointer-events-auto !rounded-2xl px-3 py-1.5 text-[11px] font-extrabold text-stone-700 dark:text-stone-200 inline-flex items-center gap-1.5 shadow-md">
              <EggIcon className="w-3.5 h-3.5 opacity-60 shrink-0" />
              <span>Mining Inactive · 0 Hens</span>
            </div>
          ) : boosterActive ? (
            <div className="clay-btn-emerald pointer-events-auto px-3 py-1.5 rounded-2xl text-[11px] font-extrabold inline-flex items-center gap-1.5 shadow-md">
              <Zap className="w-3.5 h-3.5 fill-current shrink-0" />
              <span className="font-mono-num">2× Feed · {formatCountdownMs(boostRemainingMs)}</span>
            </div>
          ) : onActivateBooster ? (
            <button
              type="button"
              onClick={onActivateBooster}
              aria-label={`Activate 2x Laying Feed booster for ${FEED_BOOSTER_COST_COINS} coins`}
              className="clay-btn clay-card pointer-events-auto !rounded-2xl px-3 py-1.5 text-[11px] font-extrabold text-stone-800 dark:text-stone-100 inline-flex items-center gap-1.5 shadow-md"
            >
              <Zap className="w-3.5 h-3.5 text-amber-500 fill-amber-400 shrink-0" />
              <span>2× Feed ({FEED_BOOSTER_COST_COINS})</span>
            </button>
          ) : (
            <span />
          )}

          {totalChickens > 0 && goldenReady && onGoldenEggDrop && (
            <div className="animate-clay-badge clay-btn-amber pointer-events-none px-2.5 py-1.5 rounded-2xl text-[11px] font-extrabold inline-flex items-center gap-1 shadow-md">
              <Sparkles className="w-3.5 h-3.5 shrink-0" />
              <span>Tap Hen for Gold Egg!</span>
            </div>
          )}
        </div>
      )}

      {/* Chicken Count Milestone Visual Notification */}
      {activeMilestone && (
        <div
          role="status"
          aria-live="polite"
          data-testid="farm-milestone-banner"
          className="animate-clay-modal clay-card-warm absolute top-3 inset-x-3 z-30 !rounded-2xl px-3.5 py-2.5 flex items-center justify-between gap-2.5"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl clay-icon-well text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0">
              <Award className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-extrabold text-stone-900 dark:text-stone-100">
                  {activeMilestone.title}
                </span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-800 dark:text-emerald-300 text-[10px] font-extrabold font-mono-num">
                  {activeMilestone.badge}
                </span>
              </div>
              <p className="text-[11px] font-semibold text-stone-600 dark:text-stone-300 truncate">
                {activeMilestone.subtitle}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Dismiss milestone notification"
            onClick={() => setActiveMilestone(null)}
            className="clay-btn clay-btn-neutral w-7 h-7 rounded-xl flex items-center justify-center shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Animated Roaming Chickens (or Buy First Miner Prompt when 0 hens owned) */}
      <div className="absolute inset-0 z-10">
        {totalChickens <= 0 && (
          <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 flex justify-center z-20">
            <div className="animate-clay-enter clay-card-warm !rounded-3xl max-w-[290px] w-full p-4 text-center space-y-2.5 shadow-xl">
              <div className="w-12 h-12 rounded-2xl clay-icon-well mx-auto flex items-center justify-center">
                <ChickenSprite breed="leghorn" className="w-9 h-9" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-extrabold text-stone-900 dark:text-stone-100">
                  Buy a Chicken to Start Mining
                </h3>
                <p className="text-[11px] font-medium text-stone-600 dark:text-stone-300 leading-relaxed">
                  Egg mining stays paused until you purchase your first chicken in Packs.
                </p>
              </div>
              {onBuyChickens && (
                <button
                  type="button"
                  onClick={onBuyChickens}
                  className="clay-btn clay-btn-emerald w-full min-h-[42px] rounded-2xl text-xs font-extrabold inline-flex items-center justify-center gap-1.5"
                >
                  <Package className="w-4 h-4" />
                  <span>Buy First Chicken</span>
                </button>
              )}
            </div>
          </div>
        )}
        {roamingHens.map((hen, idx) => {
          const isPopping = poppedHen?.id === hen.id;
          const isGoldenTarget = goldenReady && Boolean(onGoldenEggDrop) && idx === 0;
          return (
            <button
              key={hen.id}
              type="button"
              onClick={() => {
                const triggeredGold = goldenReady && Boolean(onGoldenEggDrop);
                const nextSeq = ++chirpSeqRef.current;
                const nextText = triggeredGold ? `+${GOLDEN_EGG_REWARD_COINS} ★ Gold` : '+egg';
                if (triggeredGold) {
                  onGoldenEggDrop?.();
                } else {
                  onChickenTap();
                }
                setChirps((prev) => [
                  ...prev.slice(-6),
                  { seq: nextSeq, henId: hen.id, text: nextText, isGolden: triggeredGold },
                ]);
                window.setTimeout(() => {
                  setChirps((prev) => prev.filter((item) => item.seq !== nextSeq));
                }, 1300);

                setPoppedHen((prev) => ({ id: hen.id, seq: (prev?.seq ?? 0) + 1 }));
                if (popTimerRef.current) window.clearTimeout(popTimerRef.current);
                popTimerRef.current = window.setTimeout(() => {
                  setPoppedHen((cur) => (cur?.id === hen.id ? null : cur));
                }, 440);
              }}
              aria-label={`${hen.breed} hen on farm`}
              style={{
                left: `${hen.x}%`,
                top: `${hen.y}%`,
                transition: 'left 2.6s ease-in-out, top 2.6s ease-in-out',
              }}
              className={`group absolute -translate-x-1/2 -translate-y-1/2 p-1 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 rounded-full ${
                isGoldenTarget ? 'ring-2 ring-amber-300/90 bg-amber-300/20' : ''
              }`}
            >
              {chirps
                .filter((c) => c.henId === hen.id)
                .map((c) => (
                  <span
                    key={c.seq}
                    className={`animate-float-egg pointer-events-none absolute -top-5 left-1/2 rounded-full px-2 py-0.5 text-[10px] font-extrabold whitespace-nowrap shadow-md ${
                      c.isGolden
                        ? 'bg-gradient-to-r from-amber-400 to-yellow-300 text-amber-950 border border-amber-600/40'
                        : 'clay-btn-amber'
                    }`}
                  >
                    {c.text}
                  </span>
                ))}
              <div className="transition-transform duration-200 ease-out group-hover:scale-110 group-hover:-translate-y-1 group-active:scale-95">
                <div
                  key={isPopping ? `pop-${poppedHen.seq}` : 'idle'}
                  className={isPopping ? 'animate-chicken-pop' : ''}
                >
                  <div
                    className="animate-chicken-bob"
                    style={{ animationDelay: `${hen.delayMs}ms` }}
                  >
                    <ChickenSprite
                      breed={hen.breed}
                      className="w-11 h-11 sm:w-12 sm:h-12 drop-shadow-[0_6px_8px_rgba(15,23,42,0.32)] group-hover:drop-shadow-[0_8px_12px_rgba(15,23,42,0.4)] transition-all duration-200"
                      facingLeft={hen.facingLeft}
                    />
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Bottom Clay HUD Dock */}
      <div className="absolute inset-x-3 bottom-3 z-20 flex items-end gap-2.5">
        <button
          type="button"
          onClick={onOpenYourFarm}
          className="clay-btn clay-card !rounded-2xl flex-1 min-h-[56px] px-3 py-2 flex items-center gap-2.5 text-left"
        >
          <div className="w-9 h-9 rounded-xl clay-icon-well flex items-center justify-center shrink-0">
            <EggIcon className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-extrabold text-stone-900 dark:text-stone-100 font-mono-num whitespace-nowrap">
              {productionRate} eggs/h
            </div>
            <div className="text-[11px] font-semibold text-stone-500 dark:text-stone-400 truncate">
              Your Farm · {profile.basketTierHours}h basket
            </div>
          </div>
        </button>

        <div className="relative flex-1">
          {pendingEggs > 0 && (
            <>
              <div
                aria-hidden="true"
                className="animate-collect-halo pointer-events-none absolute -inset-1 rounded-2xl bg-amber-300/45 blur-sm"
              />
              <div className="animate-clay-badge absolute -top-7 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full bg-amber-950/90 text-amber-200 border border-amber-400/40 px-2.5 py-0.5 text-xs font-extrabold shadow-lg whitespace-nowrap pointer-events-none">
                <EggIcon className="w-3.5 h-3.5" />
                <span className="font-mono-num">+{pendingEggs.toLocaleString()}</span>
              </div>
            </>
          )}

          <motion.button
            type="button"
            whileTap={pendingEggs > 0 ? { scale: 0.96 } : undefined}
            onClick={onCollect}
            disabled={pendingEggs <= 0}
            className={`clay-btn relative w-full min-h-[56px] rounded-2xl px-4 py-2 font-extrabold flex items-center justify-between gap-2 ${
              pendingEggs > 0
                ? 'clay-btn-amber'
                : 'clay-btn-neutral opacity-85 cursor-not-allowed text-stone-500 dark:text-stone-400'
            }`}
          >
            <div className="flex items-center gap-1.5">
              <EggIcon className="w-5 h-5 shrink-0" />
              <span className="text-sm sm:text-base">{collectLabel}</span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-xs font-bold font-mono-num leading-none">
                {pendingEggs}/{profile.basketCapacity}
              </span>
              <div className="w-12 h-2 rounded-full bg-black/15 mt-1 overflow-hidden p-[1px]">
                <div
                  className={`h-full bg-emerald-500 rounded-full transition-all ${
                    pendingEggs > 0 ? 'clay-shimmer-bar' : ''
                  }`}
                  style={{ width: `${fillPct}%` }}
                />
              </div>
            </div>
          </motion.button>
        </div>
      </div>
    </section>
  );
}
