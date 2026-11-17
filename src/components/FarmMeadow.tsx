import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, Award, Package, Plus, Sparkles, X, Zap } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { ChickenBreedId, UserFarmProfile } from '../types/farm';
import {
  calculateProductionRate,
  calculateTotalChickens,
  CHICKEN_MILESTONES,
  type ChickenMilestoneInfo,
  eggsToGram,
  eggsToUsd,
  FEED_BOOSTER_COST_COINS,
  getChickenMilestoneReached,
  getWithdrawAdGateStatus,
  GOLDEN_EGG_REWARD_COINS,
  isFeedBoosterActive,
  isGoldenEggReady,
} from '../game/economy';
import { ChickenSprite, EggIcon } from './GameIcons';
import farmMeadowBg from '../assets/images/poultry_farm_meadow_1794853573543.jpg';

interface FarmMeadowProps {
  profile: UserFarmProfile;
  pendingEggs: number;
  collectLabel: string;
  isVisible?: boolean;
  isProfileSynced?: boolean;
  onCollect: () => void;
  onOpenYourFarm: () => void;
  onOpenWithdraw?: () => void;
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

interface FlyingEggParticle {
  id: string;
  startX: number;
  startY: number;
  midX: number;
  midY: number;
  endX: number;
  endY: number;
  delay: number;
  duration: number;
  rotateDeg: number;
}

const SPAWN_SPOTS = [
  { x: 46, y: 55 },
  { x: 34, y: 61 },
  { x: 55, y: 65 },
  { x: 66, y: 54 },
  { x: 41, y: 49 },
  { x: 70, y: 63 },
  { x: 28, y: 56 },
  { x: 50, y: 60 },
  { x: 38, y: 67 },
  { x: 60, y: 49 },
  { x: 23, y: 61 },
  { x: 60, y: 68 },
  { x: 75, y: 59 },
  { x: 33, y: 49 },
  { x: 47, y: 69 },
  { x: 56, y: 52 },
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
  onOpenWithdraw,
  onChickenTap,
  onGoldenEggDrop,
  onActivateBooster,
  onBuyChickens,
}: FarmMeadowProps) {
  const prefersReducedMotion = useReducedMotion();
  const [bgFailed, setBgFailed] = useState(false);
  const [stepTick, setStepTick] = useState(0);
  const [liveNowMs, setLiveNowMs] = useState(() => Date.now());
  const [chirps, setChirps] = useState<Array<{ seq: number; henId: string; text: string; isGolden: boolean }>>([]);
  const [tapBursts, setTapBursts] = useState<Array<{ seq: number; henId: string; isGolden: boolean }>>([]);
  const [harvestBurst, setHarvestBurst] = useState<{ seq: number; amount: number } | null>(null);
  const [isCollectPopping, setIsCollectPopping] = useState(false);
  const [collectRippleSeq, setCollectRippleSeq] = useState(0);
  const [flyingEggs, setFlyingEggs] = useState<FlyingEggParticle[]>([]);
  const [poppedHen, setPoppedHen] = useState<{ id: string; seq: number } | null>(null);
  const [activeMilestone, setActiveMilestone] = useState<ChickenMilestoneInfo | null>(null);

  const prevUidRef = useRef<string>(profile.uid);
  const prevTotalChickensRef = useRef<number | null>(null);
  const chirpSeqRef = useRef(0);
  const harvestSeqRef = useRef(0);
  const flyingBatchSeqRef = useRef(0);
  const collectBtnRef = useRef<HTMLButtonElement | null>(null);
  const popTimerRef = useRef<number | null>(null);
  const collectPopTimerRef = useRef<number | null>(null);
  const harvestTimerRef = useRef<number | null>(null);
  const effectTimersRef = useRef<number[]>([]);

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
  const gramPerHour = eggsToGram(productionRate);
  const totalMinedEggs = profile.eggs + pendingEggs;
  const totalMinedGram = eggsToGram(totalMinedEggs);
  const totalMinedUsd = eggsToUsd(totalMinedEggs);
  const adGate = getWithdrawAdGateStatus(profile);

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
      if (collectPopTimerRef.current) window.clearTimeout(collectPopTimerRef.current);
      if (harvestTimerRef.current) window.clearTimeout(harvestTimerRef.current);
      for (const timerId of effectTimersRef.current) {
        window.clearTimeout(timerId);
      }
      effectTimersRef.current = [];
    };
  }, []);

  const triggerCollectEffects = () => {
    setIsCollectPopping(false);
    window.requestAnimationFrame(() => {
      setIsCollectPopping(true);
    });
    setCollectRippleSeq((s) => s + 1);
    if (collectPopTimerRef.current) window.clearTimeout(collectPopTimerRef.current);
    collectPopTimerRef.current = window.setTimeout(() => {
      setIsCollectPopping(false);
    }, 460);

    if (prefersReducedMotion || typeof window === 'undefined') {
      window.dispatchEvent(new CustomEvent('alphagram:coin-arrival'));
      return;
    }

    const btnRect = collectBtnRef.current?.getBoundingClientRect();
    const targetEl = document.querySelector('[data-coin-balance-target="true"]');
    const targetRect = targetEl?.getBoundingClientRect();

    const originX = btnRect ? btnRect.left + btnRect.width * 0.32 : window.innerWidth * 0.65;
    const originY = btnRect ? btnRect.top + btnRect.height * 0.45 : window.innerHeight * 0.6;
    const endX =
      targetRect && targetRect.width > 0 && targetRect.height > 0
        ? targetRect.left + targetRect.width / 2
        : window.innerWidth * 0.22;
    const endY =
      targetRect && targetRect.width > 0 && targetRect.height > 0
        ? targetRect.top + targetRect.height / 2
        : 84;

    const batchId = ++flyingBatchSeqRef.current;
    const count = 8;
    const created: FlyingEggParticle[] = Array.from({ length: count }, (_, idx) => {
      const spreadX = (idx - (count - 1) / 2) * 14;
      const spreadY = ((idx % 3) - 1) * 7;
      const startX = originX + spreadX;
      const startY = originY + spreadY;
      const arcBend = (idx % 2 === 0 ? -1 : 1) * (24 + (idx % 4) * 14);
      const midX = (startX + endX) / 2 + arcBend;
      const midY = Math.min(startY, endY) - 44 - (idx % 3) * 24;
      return {
        id: `fly-egg-${batchId}-${idx}`,
        startX,
        startY,
        midX,
        midY,
        endX,
        endY,
        delay: idx * 0.045,
        duration: 0.64 + (idx % 3) * 0.06,
        rotateDeg: (idx % 2 === 0 ? 1 : -1) * (18 + idx * 5),
      };
    });

    setFlyingEggs((prev) => [...prev.slice(-16), ...created]);

    const arrivalTimer = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('alphagram:coin-arrival'));
    }, 600);
    const cleanupTimer = window.setTimeout(() => {
      const ids = new Set(created.map((p) => p.id));
      setFlyingEggs((prev) => prev.filter((p) => !ids.has(p.id)));
    }, 1250);
    effectTimersRef.current.push(arrivalTimer, cleanupTimer);
  };

  const roamingHens: RoamingHen[] = useMemo(() => {
    return baseHens.map((breed, idx) => {
      const spot = SPAWN_SPOTS[idx % SPAWN_SPOTS.length];
      const phase = (stepTick + idx) % 4;
      const dx = phase === 0 ? 0 : phase === 1 ? 4.5 : phase === 2 ? 2 : -4;
      const dy = phase === 0 ? 0 : phase === 1 ? -2.2 : phase === 2 ? 2.5 : -1;
      return {
        id: `${breed}-${idx}`,
        breed,
        x: Math.max(14, Math.min(86, spot.x + dx)),
        y: Math.max(46, Math.min(71, spot.y + dy)),
        facingLeft: phase >= 2,
        delayMs: (idx % 5) * 200,
      };
    });
  }, [baseHens, stepTick]);

  const fillPct = Math.min(100, Math.round((pendingEggs / Math.max(1, profile.basketCapacity)) * 100));

  return (
    <section
      aria-label="Interactive GRAM Mining Poultry Farm"
      className="animate-clay-enter relative w-full flex-1 lg:flex-none overflow-hidden rounded-none lg:rounded-[2rem] lg:clay-card bg-gradient-to-b from-sky-300 via-emerald-700 to-stone-900 min-h-[540px] h-full lg:h-auto lg:aspect-[9/14] lg:min-h-[600px] lg:max-h-[760px]"
    >
      {!bgFailed && (
        <img
          src={farmMeadowBg}
          alt="Realistic outdoor free-range poultry farm with weathered wooden chicken coop, red timber barn, sunlit green meadow, and packed-earth path"
          referrerPolicy="no-referrer"
          onError={() => setBgFailed(true)}
          className="absolute inset-0 w-full h-full object-cover object-center select-none pointer-events-none"
        />
      )}

      {/* Natural golden morning sunlight & subtle floating pollen motes */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        <div
          className="animate-sunbeam absolute -top-20 -left-16 w-72 h-[125%] bg-gradient-to-b from-amber-100/25 via-yellow-50/10 to-transparent blur-2xl"
        />
        <div
          style={{ animationDelay: '2.4s' }}
          className="animate-sunbeam absolute -top-24 left-1/3 w-52 h-[125%] bg-gradient-to-b from-white/20 via-amber-100/8 to-transparent blur-2xl"
        />
        {POLLEN_MOTES.map((mote, idx) => (
          <span
            key={idx}
            style={{ left: mote.left, top: mote.top, animationDelay: mote.delay }}
            className={`animate-pollen-drift absolute ${mote.size} rounded-full ${
              boosterActive
                ? 'bg-emerald-200/85 shadow-[0_0_10px_rgba(52,211,153,0.9)]'
                : 'bg-amber-100/75 shadow-[0_0_8px_rgba(254,243,199,0.75)]'
            }`}
          />
        ))}
      </div>

      {/* 2x Laying Feed Active Booster Aura */}
      {boosterActive && (
        <div
          aria-hidden="true"
          className="animate-booster-aura pointer-events-none absolute inset-0 z-[15] lg:rounded-[2rem] ring-4 ring-inset ring-emerald-400/55 shadow-[inset_0_0_32px_rgba(16,185,129,0.28)]"
        />
      )}

      {/* Top sky & bottom earth scrims for natural outdoor readability */}
      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-stone-950/45 via-stone-950/15 to-transparent pointer-events-none" />
      <div className="absolute inset-x-0 bottom-0 h-52 bg-gradient-to-t from-stone-950/80 via-stone-950/35 to-transparent pointer-events-none" />

      {/* Top Mining HUD: 2x Feed Booster + Golden Egg Alert + GRAM Payout Status */}
      {!activeMilestone && (
        <div className="absolute top-3 inset-x-3 z-20 flex items-center justify-between gap-2 pointer-events-none">
          {totalChickens <= 0 ? (
            <div className="pointer-events-auto min-h-[44px] rounded-2xl bg-stone-950/70 backdrop-blur-md border border-white/15 px-3 py-2 text-[11px] font-extrabold text-stone-100 inline-flex items-center gap-1.5 shadow-lg">
              <EggIcon className="w-3.5 h-3.5 opacity-75 shrink-0" />
              <span>Mining Idle · 0 Hens</span>
            </div>
          ) : boosterActive ? (
            <div className="clay-btn-emerald pointer-events-auto min-h-[44px] px-3 py-2 rounded-2xl text-[11px] font-extrabold inline-flex items-center gap-1.5 shadow-lg">
              <Zap className="w-3.5 h-3.5 fill-current shrink-0" />
              <span className="font-mono-num">2× Feed · {formatCountdownMs(boostRemainingMs)}</span>
            </div>
          ) : onActivateBooster ? (
            <button
              type="button"
              onClick={onActivateBooster}
              aria-label={`Activate 2x Laying Feed booster for ${FEED_BOOSTER_COST_COINS} coins`}
              className="clay-btn pointer-events-auto min-h-[44px] rounded-2xl bg-stone-950/75 hover:bg-stone-900/85 backdrop-blur-md border border-amber-300/35 px-3 py-2 text-[11px] font-extrabold text-amber-100 inline-flex items-center gap-1.5 shadow-lg"
            >
              <Zap className="w-3.5 h-3.5 text-amber-400 fill-amber-400 shrink-0" />
              <span>2× Boost ({FEED_BOOSTER_COST_COINS})</span>
            </button>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-1.5">
            {totalChickens > 0 && goldenReady && onGoldenEggDrop && (
              <div className="animate-clay-badge clay-btn-amber pointer-events-none min-h-[44px] px-2.5 py-2 rounded-2xl text-[11px] font-extrabold inline-flex items-center gap-1 shadow-lg">
                <Sparkles className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">Tap Hen Gold!</span>
                <span className="sm:hidden">Gold!</span>
              </div>
            )}
            {onOpenWithdraw && (
              <button
                type="button"
                onClick={onOpenWithdraw}
                aria-label="Open GRAM Token withdrawal and payout status"
                className="clay-btn pointer-events-auto min-h-[44px] rounded-2xl bg-stone-950/75 hover:bg-stone-900/85 backdrop-blur-md border border-emerald-400/35 px-3 py-2 text-[11px] font-extrabold text-white inline-flex items-center gap-1.5 shadow-lg"
              >
                <span
                  aria-hidden="true"
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    adGate.unlocked ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                  }`}
                />
                <span>Withdraw</span>
                <span className="font-mono-num text-[10px] px-1.5 py-0.5 rounded-md bg-white/10 text-emerald-300">
                  {adGate.unlocked ? 'Ready' : `${adGate.watched}/${adGate.required}`}
                </span>
                <ArrowUpRight className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
              </button>
            )}
          </div>
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
            className="clay-btn clay-btn-neutral w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Animated Roaming Chickens (or Buy First Miner Prompt when 0 hens owned) */}
      <div className="absolute inset-0 z-10 pointer-events-none">
        {totalChickens <= 0 && (
          <div className="pointer-events-auto absolute inset-x-4 top-[44%] -translate-y-1/2 flex justify-center z-20">
            <div className="animate-clay-enter clay-card-warm !rounded-3xl max-w-[295px] w-full p-4 text-center space-y-2.5 shadow-2xl">
              <div className="w-12 h-12 rounded-2xl clay-icon-well mx-auto flex items-center justify-center">
                <ChickenSprite breed="leghorn" className="w-9 h-9" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-extrabold text-stone-900 dark:text-stone-100">
                  Buy a Chicken to Mine GRAM
                </h3>
                <p className="text-[11px] font-medium text-stone-600 dark:text-stone-300 leading-relaxed">
                  Hens lay eggs automatically every second so you can harvest and withdraw GRAM tokens.
                </p>
              </div>
              {onBuyChickens && (
                <button
                  type="button"
                  onClick={onBuyChickens}
                  className="clay-btn clay-btn-emerald w-full min-h-[44px] rounded-2xl text-xs font-extrabold inline-flex items-center justify-center gap-1.5"
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
          const depthScale = Number((0.86 + ((hen.y - 46) / 25) * 0.28).toFixed(3));
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
                setTapBursts((prev) => [
                  ...prev.slice(-4),
                  { seq: nextSeq, henId: hen.id, isGolden: triggeredGold },
                ]);
                window.setTimeout(() => {
                  setChirps((prev) => prev.filter((item) => item.seq !== nextSeq));
                  setTapBursts((prev) => prev.filter((item) => item.seq !== nextSeq));
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
                zIndex: Math.round(hen.y),
                transform: `translate(-50%, -50%) scale(${depthScale})`,
                transition: 'left 2.6s ease-in-out, top 2.6s ease-in-out, transform 2.6s ease-in-out',
              }}
              className="group absolute p-1 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 rounded-full pointer-events-auto"
            >
              {isGoldenTarget && (
                <>
                  <span
                    aria-hidden="true"
                    className="animate-collect-halo pointer-events-none absolute -inset-2 rounded-full bg-amber-300/35 blur-sm"
                  />
                  <span
                    aria-hidden="true"
                    className="animate-golden-ring pointer-events-none absolute -inset-1.5 rounded-full border-2 border-dashed border-amber-300 shadow-[0_0_12px_rgba(251,191,36,0.85)]"
                  />
                </>
              )}
              {tapBursts
                .filter((b) => b.henId === hen.id)
                .map((b) => (
                  <span key={`burst-${b.seq}`} aria-hidden="true" className="pointer-events-none absolute inset-0">
                    {[0, 60, 120, 180, 240, 300].map((angle) => (
                      <span
                        key={angle}
                        style={{ '--burst-angle': `${angle}deg` } as React.CSSProperties}
                        className={`animate-sparkle-burst absolute left-1/2 top-1/2 w-2 h-2 rounded-full ${
                          b.isGolden
                            ? 'bg-amber-300 shadow-[0_0_8px_rgba(251,191,36,0.95)]'
                            : 'bg-amber-100 shadow-[0_0_6px_rgba(255,255,255,0.9)]'
                        }`}
                      />
                    ))}
                  </span>
                ))}
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
              <div className="relative transition-transform duration-200 ease-out group-hover:scale-110 group-hover:-translate-y-1 group-active:scale-95">
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-3 rounded-full bg-stone-950/45 blur-[3px]"
                />
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
                      className="w-16 h-16 sm:w-[4.4rem] sm:h-[4.4rem] drop-shadow-[0_6px_10px_rgba(12,18,10,0.42)] group-hover:drop-shadow-[0_10px_15px_rgba(12,18,10,0.52)] transition-all duration-200"
                      facingLeft={hen.facingLeft}
                    />
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Bottom GRAM Mining Telemetry + Action Dock (floats cleanly above mobile BottomNav) */}
      <div className="absolute inset-x-3 bottom-[4.85rem] lg:bottom-3 z-20 flex flex-col gap-2">
        {/* Live GRAM Mining Telemetry Strip */}
        <div className="rounded-2xl bg-stone-950/72 backdrop-blur-md border border-white/15 px-3 py-1.5 flex items-center justify-between gap-2 text-white shadow-lg">
          <div className="flex items-center gap-2 min-w-0">
            <span
              aria-hidden="true"
              className={`w-2 h-2 rounded-full shrink-0 ${
                totalChickens > 0 ? 'bg-emerald-400 animate-pulse' : 'bg-stone-500'
              }`}
            />
            <div className="min-w-0 flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-extrabold font-mono-num text-emerald-300 whitespace-nowrap">
                +{gramPerHour.toFixed(4)} GRAM/h
              </span>
              <span className="text-[10px] font-semibold text-stone-300 font-mono-num whitespace-nowrap">
                Mined: {totalMinedGram.toFixed(4)} GRAM (${totalMinedUsd.toFixed(2)})
              </span>
            </div>
          </div>
          {onBuyChickens && (
            <button
              type="button"
              onClick={onBuyChickens}
              aria-label="Buy more hens to increase GRAM mining speed"
              className="clay-btn shrink-0 min-h-[32px] px-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-amber-950 text-[11px] font-extrabold inline-flex items-center gap-1 shadow-sm"
            >
              <Plus className="w-3 h-3 stroke-[2.75]" />
              <span>Add Hens</span>
            </button>
          )}
        </div>

        {/* Primary Farm & Collect Dock */}
        <div className="flex items-end gap-2.5">
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
              <div className="text-[11px] font-semibold text-stone-500 dark:text-stone-400 truncate font-mono-num">
                Lv.{profile.level} · {totalChickens} Hens · {profile.basketTierHours}h Cap
              </div>
            </div>
          </button>

          <div className="relative flex-1">
            {harvestBurst && (
              <div
                key={`harvest-${harvestBurst.seq}`}
                aria-hidden="true"
                className="animate-harvest-rise pointer-events-none absolute -top-9 left-1/2 z-30 flex items-center gap-1 rounded-full bg-gradient-to-r from-emerald-500 to-amber-400 text-stone-950 border border-white/70 px-3 py-1 text-xs font-extrabold shadow-xl whitespace-nowrap"
              >
                <Sparkles className="w-3.5 h-3.5 shrink-0" />
                <span className="font-mono-num">+{harvestBurst.amount.toLocaleString()} Eggs!</span>
              </div>
            )}

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

            <AnimatePresence>
              {collectRippleSeq > 0 && !prefersReducedMotion && (
                <motion.span
                  key={`collect-ripple-${collectRippleSeq}`}
                  aria-hidden="true"
                  initial={{ opacity: 0.72, scale: 0.92 }}
                  animate={{ opacity: 0, scale: 1.3 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                  className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-amber-300 shadow-[0_0_20px_rgba(251,191,36,0.65)]"
                />
              )}
            </AnimatePresence>

            <motion.button
              ref={collectBtnRef}
              type="button"
              animate={
                isCollectPopping && !prefersReducedMotion
                  ? {
                      scale: [1, 1.15, 0.94, 1.04, 1],
                      y: [0, -5, 1, 0],
                    }
                  : { scale: 1, y: 0 }
              }
              transition={{ duration: 0.44, ease: [0.16, 1, 0.3, 1] }}
              whileHover={pendingEggs > 0 && !prefersReducedMotion ? { scale: 1.025 } : undefined}
              whileTap={pendingEggs > 0 ? { scale: 0.92 } : undefined}
              onClick={() => {
                if (pendingEggs > 0) {
                  const nextSeq = ++harvestSeqRef.current;
                  setHarvestBurst({ seq: nextSeq, amount: pendingEggs });
                  if (harvestTimerRef.current) window.clearTimeout(harvestTimerRef.current);
                  harvestTimerRef.current = window.setTimeout(() => {
                    setHarvestBurst((cur) => (cur?.seq === nextSeq ? null : cur));
                  }, 1350);
                  triggerCollectEffects();
                }
                onCollect();
              }}
              disabled={pendingEggs <= 0}
              className={`clay-btn relative w-full min-h-[56px] rounded-2xl px-4 py-2 font-extrabold flex items-center justify-between gap-2 ${
                pendingEggs > 0
                  ? 'clay-btn-amber clay-cta-sheen'
                  : 'clay-btn-neutral opacity-85 cursor-not-allowed text-stone-500 dark:text-stone-400'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <EggIcon className={`w-5 h-5 shrink-0 ${pendingEggs > 0 ? 'animate-egg-wiggle' : ''}`} />
                <span className="text-sm sm:text-base">{collectLabel}</span>
              </div>
              <div className="flex flex-col items-end">
                <span className="text-xs font-bold font-mono-num leading-none">
                  {pendingEggs}/{profile.basketCapacity}
                </span>
                <div className="w-12 h-2 rounded-full bg-black/15 mt-1 overflow-hidden p-[1px]">
                  <div
                    className={`h-full bg-emerald-500 rounded-full transition-all duration-300 ${
                      pendingEggs > 0 ? 'clay-shimmer-bar' : ''
                    }`}
                    style={{ width: `${fillPct}%` }}
                  />
                </div>
              </div>
            </motion.button>
          </div>
        </div>
      </div>

      {typeof document !== 'undefined' &&
        flyingEggs.length > 0 &&
        createPortal(
          <div
            aria-hidden="true"
            className="pointer-events-none fixed inset-0 z-[70] overflow-hidden"
          >
            {flyingEggs.map((particle) => (
              <motion.div
                key={particle.id}
                initial={{
                  x: particle.startX - 14,
                  y: particle.startY - 14,
                  scale: 0.45,
                  opacity: 0,
                  rotate: 0,
                }}
                animate={{
                  x: [particle.startX - 14, particle.midX - 14, particle.endX - 14],
                  y: [particle.startY - 14, particle.midY - 14, particle.endY - 14],
                  scale: [0.5, 1.25, 0.95, 0.42],
                  opacity: [0, 1, 1, 0.15],
                  rotate: [0, particle.rotateDeg, particle.rotateDeg * 0.4, 0],
                }}
                transition={{
                  duration: particle.duration,
                  delay: particle.delay,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="absolute top-0 left-0 w-7 h-7 flex items-center justify-center will-change-transform drop-shadow-[0_4px_10px_rgba(245,158,11,0.55)]"
              >
                <EggIcon className="w-7 h-7" />
              </motion.div>
            ))}
          </div>,
          document.body,
        )}
    </section>
  );
}
