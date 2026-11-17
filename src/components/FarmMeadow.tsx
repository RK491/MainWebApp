import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, Award, Bot, Feather, Flame, Package, Plus, Sparkles, Star, X, Zap } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { ChickenBreedId, UserFarmProfile } from '../types/farm';
import {
  calculateProductionRate,
  calculateTotalChickens,
  CHICKEN_MILESTONES,
  type ChickenMilestoneInfo,
  COOP_FEVER_MULTIPLIER,
  COOP_FEVER_REQUIRED_ADS,
  eggsToGram,
  eggsToUsd,
  FEED_BOOSTER_COST_COINS,
  getChickenMilestoneReached,
  getCoopFeverProgress,
  getWithdrawAdGateStatus,
  GOLDEN_EGG_REWARD_COINS,
  isAutoHarvestDroneActive,
  isCoopFeverActive,
  isFeedBoosterActive,
  isGoldenEggReady,
} from '../game/economy';
import { ChickenSprite, CoinIcon, EggIcon } from './GameIcons';
import farmMeadowBg from '../assets/images/isometric_farm_no_hens_1794882362098.jpg';

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
  onActivateCoopFever?: () => void;
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

interface MeadowParticle {
  id: string;
  kind: 'egg_collect' | 'chicken_buy';
  glyph: 'egg' | 'coin' | 'feather' | 'star';
  originXPercent: number;
  originYPercent: number;
  dx: number;
  dy: number;
  delay: number;
  duration: number;
  rotateDeg: number;
  scale: number;
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
  { x: 45, y: 55 },
  { x: 56, y: 58 },
  { x: 38, y: 50 },
  { x: 64, y: 61 },
  { x: 51, y: 49 },
  { x: 69, y: 56 },
  { x: 41, y: 59 },
  { x: 59, y: 52 },
  { x: 47, y: 63 },
  { x: 34, y: 47 },
  { x: 62, y: 65 },
  { x: 53, y: 60 },
  { x: 72, y: 59 },
  { x: 43, y: 46 },
  { x: 49, y: 65 },
  { x: 67, y: 51 },
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

const ATMOSPHERIC_DUST_PARTICLES = [
  { left: '11%', top: '26%', size: 5, dx: 26, dy: -22, duration: 12.5, delay: 0.2, tone: 'gold' },
  { left: '22%', top: '38%', size: 4, dx: -18, dy: -28, duration: 14.2, delay: 1.4, tone: 'ivory' },
  { left: '31%', top: '21%', size: 6, dx: 22, dy: -16, duration: 11.8, delay: 2.6, tone: 'amber' },
  { left: '42%', top: '44%', size: 4, dx: 28, dy: -24, duration: 15.6, delay: 0.8, tone: 'gold' },
  { left: '53%', top: '31%', size: 5, dx: -24, dy: -20, duration: 13.4, delay: 3.1, tone: 'ivory' },
  { left: '64%', top: '47%', size: 6, dx: 20, dy: -26, duration: 16.0, delay: 1.9, tone: 'amber' },
  { left: '76%', top: '29%', size: 4, dx: -22, dy: -18, duration: 12.2, delay: 4.0, tone: 'gold' },
  { left: '87%', top: '41%', size: 5, dx: -16, dy: -24, duration: 14.8, delay: 0.5, tone: 'ivory' },
  { left: '17%', top: '57%', size: 5, dx: 24, dy: -26, duration: 13.8, delay: 2.2, tone: 'amber' },
  { left: '29%', top: '65%', size: 4, dx: 18, dy: -20, duration: 15.2, delay: 3.7, tone: 'gold' },
  { left: '46%', top: '60%', size: 6, dx: -20, dy: -30, duration: 17.0, delay: 1.1, tone: 'ivory' },
  { left: '58%', top: '68%', size: 4, dx: 22, dy: -22, duration: 12.9, delay: 4.5, tone: 'gold' },
  { left: '72%', top: '62%', size: 5, dx: -26, dy: -24, duration: 14.4, delay: 2.9, tone: 'amber' },
  { left: '84%', top: '56%', size: 4, dx: -18, dy: -18, duration: 13.1, delay: 0.9, tone: 'ivory' },
  { left: '36%', top: '76%', size: 5, dx: 20, dy: -28, duration: 15.8, delay: 2.4, tone: 'gold' },
  { left: '61%', top: '79%', size: 4, dx: -16, dy: -22, duration: 16.4, delay: 5.0, tone: 'ivory' },
  { left: '79%', top: '74%', size: 5, dx: -22, dy: -26, duration: 13.7, delay: 1.6, tone: 'amber' },
  { left: '14%', top: '43%', size: 3.5, dx: 16, dy: -16, duration: 11.2, delay: 3.3, tone: 'ivory' },
] as const;

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
  onActivateCoopFever,
  onBuyChickens,
}: FarmMeadowProps) {
  const prefersReducedMotion = useReducedMotion();
  const [bgFailed, setBgFailed] = useState(false);
  const [stepTick, setStepTick] = useState(0);
  const [liveNowMs, setLiveNowMs] = useState(() => Date.now());
  const [chirps, setChirps] = useState<Array<{ seq: number; henId: string; text: string; isGolden: boolean }>>([]);
  const [tapBursts, setTapBursts] = useState<Array<{ seq: number; henId: string; isGolden: boolean }>>([]);
  const [harvestBurst, setHarvestBurst] = useState<{ seq: number; amount: number } | null>(null);
  const [chickenPurchaseBanner, setChickenPurchaseBanner] = useState<{ seq: number; addedCount: number } | null>(null);
  const [meadowParticles, setMeadowParticles] = useState<MeadowParticle[]>([]);
  const [isCollectPopping, setIsCollectPopping] = useState(false);
  const [collectRippleSeq, setCollectRippleSeq] = useState(0);
  const [flyingEggs, setFlyingEggs] = useState<FlyingEggParticle[]>([]);
  const [poppedHen, setPoppedHen] = useState<{ id: string; seq: number } | null>(null);
  const [activeMilestone, setActiveMilestone] = useState<ChickenMilestoneInfo | null>(null);

  const prevUidRef = useRef<string>(profile.uid);
  const prevTotalChickensRef = useRef<number | null>(null);
  const pendingChickenBurstCountRef = useRef(0);
  const particleBatchSeqRef = useRef(0);
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
  const feverActive = isCoopFeverActive(profile, liveNowMs);
  const feverRemainingMs = Math.max(0, Number(profile.coopFeverUntilMs ?? 0) - liveNowMs);
  const feverProgress = getCoopFeverProgress(profile, liveNowMs);
  const droneActive = isAutoHarvestDroneActive(profile, liveNowMs);
  const droneRemainingMs = Math.max(0, Number(profile.autoHarvestUntilMs ?? 0) - liveNowMs);
  const goldenReady = isGoldenEggReady(profile, liveNowMs);
  const productionRate = calculateProductionRate(profile, liveNowMs);
  const totalChickens = calculateTotalChickens(profile);
  const gramPerHour = eggsToGram(productionRate);
  const totalMinedEggs = profile.eggs + pendingEggs;
  const totalMinedGram = eggsToGram(totalMinedEggs);
  const totalMinedUsd = eggsToUsd(totalMinedEggs);
  const adGate = getWithdrawAdGateStatus(profile);

  const spawnMeadowParticleBurst = (kind: 'egg_collect' | 'chicken_buy', countAdded = 1) => {
    const batchSeq = ++particleBatchSeqRef.current;
    if (kind === 'chicken_buy') {
      setChickenPurchaseBanner({ seq: batchSeq, addedCount: countAdded });
      const bannerTimer = window.setTimeout(() => {
        setChickenPurchaseBanner((cur) => (cur?.seq === batchSeq ? null : cur));
      }, 1500);
      effectTimersRef.current.push(bannerTimer);
    }

    if (prefersReducedMotion) return;

    const particleCount = kind === 'chicken_buy' ? 18 : 14;
    const originXPercent = kind === 'chicken_buy' ? 50 : 73;
    const originYPercent = kind === 'chicken_buy' ? 56 : 82;

    const created: MeadowParticle[] = Array.from({ length: particleCount }, (_, idx) => {
      const angle =
        kind === 'chicken_buy'
          ? (idx / particleCount) * Math.PI * 2 + (idx % 2 === 0 ? 0.14 : -0.14)
          : -Math.PI * 0.92 + (idx / Math.max(1, particleCount - 1)) * Math.PI * 0.84;
      const dist =
        kind === 'chicken_buy'
          ? 70 + (idx % 4) * 26
          : 60 + (idx % 4) * 22;

      const glyphs: MeadowParticle['glyph'][] =
        kind === 'chicken_buy'
          ? ['feather', 'star', 'coin', 'feather']
          : ['egg', 'star', 'coin', 'egg'];

      return {
        id: `mp-${batchSeq}-${idx}`,
        kind,
        glyph: glyphs[idx % glyphs.length],
        originXPercent,
        originYPercent,
        dx: Math.round(Math.cos(angle) * dist),
        dy: Math.round(Math.sin(angle) * dist - (kind === 'egg_collect' ? 24 : 10)),
        delay: (idx % 5) * 0.03,
        duration: 0.65 + (idx % 3) * 0.12,
        rotateDeg: (idx % 2 === 0 ? 1 : -1) * (25 + idx * 14),
        scale: 0.85 + (idx % 3) * 0.2,
      };
    });

    setMeadowParticles((prev) => [...prev.slice(-24), ...created]);
    const cleanup = window.setTimeout(() => {
      const idSet = new Set(created.map((p) => p.id));
      setMeadowParticles((prev) => prev.filter((p) => !idSet.has(p.id)));
    }, 1200);
    effectTimersRef.current.push(cleanup);
  };

  useEffect(() => {
    if (prevUidRef.current !== profile.uid) {
      prevUidRef.current = profile.uid;
      prevTotalChickensRef.current = null;
      pendingChickenBurstCountRef.current = 0;
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
      const added = totalChickens - prevCount;
      const visibleInViewport =
        isVisible || (typeof window !== 'undefined' && window.innerWidth >= 1024);
      if (visibleInViewport) {
        spawnMeadowParticleBurst('chicken_buy', added);
      } else {
        pendingChickenBurstCountRef.current += added;
      }

      const reached = getChickenMilestoneReached(prevCount, totalChickens);
      const storedMax = getStoredMilestone(profile.uid);
      if (reached && reached.threshold > storedMax) {
        setStoredMilestone(profile.uid, reached.threshold);
        setActiveMilestone(reached);
      }
    }
  }, [isProfileSynced, isVisible, profile.uid, totalChickens]);

  useEffect(() => {
    const visibleInViewport =
      isVisible || (typeof window !== 'undefined' && window.innerWidth >= 1024);
    if (!visibleInViewport || pendingChickenBurstCountRef.current <= 0) return;
    const count = pendingChickenBurstCountRef.current;
    pendingChickenBurstCountRef.current = 0;
    const t = window.setTimeout(() => {
      spawnMeadowParticleBurst('chicken_buy', count);
    }, 120);
    return () => window.clearTimeout(t);
  }, [isVisible]);

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
    }, 2600);
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
    spawnMeadowParticleBurst('egg_collect', 1);
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
      const dx = phase === 0 ? 0 : phase === 1 ? 3.8 : phase === 2 ? 1.8 : -3.4;
      const dy = phase === 0 ? 0 : phase === 1 ? -1.8 : phase === 2 ? 2.1 : -0.9;
      return {
        id: `${breed}-${idx}`,
        breed,
        x: Math.max(24, Math.min(74, spot.x + dx)),
        y: Math.max(41, Math.min(64, spot.y + dy)),
        facingLeft: phase >= 2,
        delayMs: (idx % 5) * 200,
      };
    });
  }, [baseHens, stepTick]);

  const fillPct = Math.min(100, Math.round((pendingEggs / Math.max(1, profile.basketCapacity)) * 100));

  return (
    <section
      aria-label="Live Isometric Sustainable Poultry Estate"
      className="animate-clay-enter relative w-full flex-1 lg:flex-none overflow-hidden rounded-none lg:rounded-[2rem] lg:clay-card bg-gradient-to-b from-amber-200 via-emerald-800 to-stone-950 min-h-[540px] h-full lg:h-auto lg:aspect-[9/14] lg:min-h-[600px] lg:max-h-[760px]"
    >
      {/* Synchronized Living 3D Isometric Estate Canvas (continuous video-like motion + aligned animations) */}
      <motion.div
        animate={
          prefersReducedMotion
            ? undefined
            : {
                scale: [1.018, 1.042, 1.028, 1.018],
                x: [-4, 4, -2, -4],
                y: [-2.5, 2.5, -1, -2.5],
              }
        }
        transition={{
          duration: 22,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
        className="absolute inset-0 pointer-events-none overflow-hidden will-change-transform"
        aria-hidden="true"
      >
        {!bgFailed ? (
          <img
            src={farmMeadowBg}
            alt="3D isometric sustainable farm complex in golden hour sunlight featuring a two-story farmhouse with glass solarium and rooftop garden, solar-roofed barn with hydroponic wall, packing facility with delivery truck, two solar chicken coops, terraced crop fields, foreground pond with fountain and waterfowl, forest, and distant wind farm"
            referrerPolicy="no-referrer"
            onError={() => setBgFailed(true)}
            className="w-full h-full object-cover object-center select-none pointer-events-none"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-b from-amber-300/40 via-emerald-800 to-stone-900 flex items-center justify-center">
            <div className="rounded-3xl bg-stone-950/55 border border-white/15 px-5 py-3 text-center text-amber-100 text-xs font-semibold">
              Sustainable Eco-Farm Estate
            </div>
          </div>
        )}

        {/* 1. Golden-hour atmospheric sunbeams & horizon warmth */}
        <div
          className="animate-sunbeam absolute -top-20 -left-16 w-80 h-[125%] bg-gradient-to-b from-amber-100/28 via-yellow-50/12 to-transparent blur-2xl"
        />
        <div
          style={{ animationDelay: '2.4s' }}
          className="animate-sunbeam absolute -top-24 left-1/3 w-56 h-[125%] bg-gradient-to-b from-amber-50/20 via-amber-100/10 to-transparent blur-2xl"
        />
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_8%,rgba(253,230,138,0.22),transparent_48%)]"
        />

        {!prefersReducedMotion && (
          <>
            {/* Drifting golden-hour high sky clouds */}
            <motion.div
              animate={{ x: [-48, 72, -48], opacity: [0.22, 0.38, 0.22] }}
              transition={{ duration: 26, repeat: Infinity, ease: 'easeInOut' }}
              style={{ left: '10%', top: '1.8%' }}
              className="absolute w-36 h-6 rounded-full bg-amber-100/45 blur-md"
            />
            <motion.div
              animate={{ x: [42, -52, 42], opacity: [0.18, 0.32, 0.18] }}
              transition={{ duration: 32, repeat: Infinity, ease: 'easeInOut' }}
              style={{ left: '54%', top: '3.0%' }}
              className="absolute w-40 h-5 rounded-full bg-orange-100/40 blur-md"
            />
            <motion.div
              animate={{ x: [-28, 46, -28], opacity: [0.14, 0.28, 0.14] }}
              transition={{ duration: 22, delay: 4, repeat: Infinity, ease: 'easeInOut' }}
              style={{ left: '34%', top: '4.6%' }}
              className="absolute w-28 h-4 rounded-full bg-amber-50/35 blur-md"
            />

            {/* Soaring farm swallows gliding across distant lake & forest */}
            {[0, 1, 2, 3].map((idx) => (
              <motion.svg
                key={`bird-${idx}`}
                viewBox="0 0 24 12"
                initial={{ x: -30, y: 0, opacity: 0 }}
                animate={{
                  x: [-35 + idx * 14, 150 + idx * 20, 350],
                  y: [0, -11 - idx * 3, -4],
                  scaleY: [1, 0.55, 1.15, 0.65, 1],
                  opacity: [0, 0.85, 0.85, 0],
                }}
                transition={{
                  duration: 14 + idx * 2.2,
                  delay: idx * 3.1,
                  repeat: Infinity,
                  ease: 'linear',
                }}
                style={{ left: `${8 + idx * 4}%`, top: `${7.5 + idx * 2.2}%` }}
                className="absolute w-4 h-2.5 text-stone-800/75"
              >
                <path
                  d="M1 8 Q6 2 12 7 Q18 2 23 8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </motion.svg>
            ))}

            {/* Distant lake sunlight water glints */}
            {[
              { left: '24%', top: '10.4%', width: 'w-9', delay: 0 },
              { left: '36%', top: '11.6%', width: 'w-11', delay: 0.9 },
              { left: '48%', top: '9.8%', width: 'w-8', delay: 1.7 },
              { left: '57%', top: '11.2%', width: 'w-7', delay: 2.5 },
            ].map((glint, idx) => (
              <motion.span
                key={`lake-glint-${idx}`}
                animate={{ opacity: [0.15, 0.78, 0.15], scaleX: [0.85, 1.4, 0.85] }}
                transition={{ duration: 3.1, delay: glint.delay, repeat: Infinity, ease: 'easeInOut' }}
                style={{ left: glint.left, top: glint.top }}
                className={`absolute ${glint.width} h-[2px] rounded-full bg-amber-100/80 blur-[0.5px]`}
              />
            ))}

            {/* 2. Spinning 3-blade rotors on the 5 distant wind farm turbines */}
            {[59.5, 63.4, 67.1, 70.9, 75.0].map((leftPct, idx) => (
              <motion.span
                key={`turbine-${idx}`}
                animate={{ rotate: 360 }}
                transition={{
                  duration: 2.0 + idx * 0.22,
                  repeat: Infinity,
                  ease: 'linear',
                }}
                style={{ left: `${leftPct}%`, top: '6.4%' }}
                className="absolute w-4 h-4 -translate-x-1/2 -translate-y-1/2 opacity-80"
              >
                <span className="absolute left-1/2 top-0 -translate-x-1/2 w-[1.5px] h-2 bg-white/95 rounded-full shadow-[0_0_5px_rgba(255,255,255,0.85)]" />
                <span className="absolute left-1/2 bottom-0.5 -translate-x-1/2 rotate-[120deg] origin-top w-[1.5px] h-2 bg-white/90 rounded-full" />
                <span className="absolute left-1/2 bottom-0.5 -translate-x-1/2 -rotate-[120deg] origin-top w-[1.5px] h-2 bg-white/90 rounded-full" />
              </motion.span>
            ))}

            {/* 3. Solar panel golden-hour reflection glint sweeps (Barn roof, Packing roof & Distant solar array) */}
            <motion.div
              animate={{ opacity: [0, 0.5, 0], x: [-28, 32] }}
              transition={{ duration: 4.8, repeat: Infinity, repeatDelay: 2.8, ease: 'easeInOut' }}
              style={{ left: '52%', top: '23%', transform: 'rotate(-22deg)' }}
              className="absolute w-28 h-9 rounded-full bg-gradient-to-r from-transparent via-amber-100/60 to-transparent blur-sm"
            />
            <motion.div
              animate={{ opacity: [0, 0.45, 0], x: [-16, 18] }}
              transition={{ duration: 4.2, delay: 1.9, repeat: Infinity, repeatDelay: 3.4, ease: 'easeInOut' }}
              style={{ left: '77%', top: '36.5%', transform: 'rotate(-22deg)' }}
              className="absolute w-16 h-5 rounded-full bg-gradient-to-r from-transparent via-sky-100/60 to-transparent blur-sm"
            />
            <motion.div
              animate={{ opacity: [0, 0.42, 0], x: [-20, 22] }}
              transition={{ duration: 5.5, delay: 0.8, repeat: Infinity, repeatDelay: 3.8, ease: 'easeInOut' }}
              style={{ left: '78%', top: '11.5%', transform: 'rotate(-16deg)' }}
              className="absolute w-24 h-4 rounded-full bg-gradient-to-r from-transparent via-amber-100/55 to-transparent blur-sm"
            />

            {/* 4. Forest canopy, rooftop garden & vertical hydroponic wind sway */}
            {[
              { left: '12%', top: '24%', w: 'w-20', h: 'h-14', dx: 4, dur: 5.8, delay: 0 },
              { left: '84%', top: '25%', w: 'w-20', h: 'h-16', dx: -4, dur: 6.4, delay: 1.2 },
              { left: '26%', top: '25%', w: 'w-14', h: 'h-8', dx: 3, dur: 4.9, delay: 0.6 },
              { left: '55%', top: '33%', w: 'w-14', h: 'h-9', dx: 2.5, dur: 5.3, delay: 1.8 },
              { left: '14%', top: '91%', w: 'w-24', h: 'h-14', dx: 5, dur: 6.8, delay: 0.9 },
              { left: '84%', top: '89%', w: 'w-24', h: 'h-16', dx: -5, dur: 6.1, delay: 2.1 },
            ].map((foliage, idx) => (
              <motion.div
                key={`foliage-breeze-${idx}`}
                animate={{
                  x: [-foliage.dx, foliage.dx, -foliage.dx],
                  scale: [1, 1.03, 0.99, 1],
                  opacity: [0.12, 0.28, 0.12],
                }}
                transition={{
                  duration: foliage.dur,
                  delay: foliage.delay,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
                style={{ left: foliage.left, top: foliage.top }}
                className={`absolute -translate-x-1/2 -translate-y-1/2 ${foliage.w} ${foliage.h} rounded-full bg-lime-200/25 blur-md`}
              />
            ))}

            {/* 5. Main Farmhouse cozy chimney smoke, solarium glass shimmer & porch lantern glow */}
            {[0, 1.2, 2.4].map((delaySec, idx) => (
              <motion.span
                key={`smoke-${idx}`}
                initial={{ opacity: 0, y: 0, x: 0, scale: 0.55 }}
                animate={{
                  opacity: [0, 0.48, 0.25, 0],
                  y: [-2, -28 - idx * 4],
                  x: [0, 12 + idx * 3],
                  scale: [0.55, 1.35, 1.8],
                }}
                transition={{
                  duration: 4.0,
                  delay: delaySec,
                  repeat: Infinity,
                  ease: 'easeOut',
                }}
                style={{ left: '29.2%', top: '24.4%' }}
                className="absolute w-3.5 h-3.5 rounded-full bg-amber-50/70 blur-[3px]"
              />
            ))}
            <motion.div
              animate={{ opacity: [0.12, 0.36, 0.12] }}
              transition={{ duration: 4.4, repeat: Infinity, ease: 'easeInOut' }}
              style={{ left: '14.5%', top: '37.5%', transform: 'rotate(-20deg)' }}
              className="absolute -translate-x-1/2 -translate-y-1/2 w-14 h-7 rounded-full bg-amber-100/40 blur-md"
            />
            <motion.span
              animate={{ opacity: [0.45, 0.9, 0.45], scale: [0.9, 1.2, 0.9] }}
              transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
              style={{ left: '34.4%', top: '36.8%' }}
              className="absolute w-3 h-3 rounded-full bg-amber-300/75 blur-[3px]"
            />

            {/* 6. Terraced crop fields butterflies & golden grain breeze waves */}
            {[
              { left: '20%', top: '52%', dx: 20, dy: -13, dur: 5.2, color: 'text-amber-300' },
              { left: '31%', top: '59%', dx: -17, dy: -11, dur: 6.0, color: 'text-yellow-200' },
              { left: '14%', top: '63%', dx: 15, dy: -14, dur: 4.7, color: 'text-orange-200' },
              { left: '39%', top: '63%', dx: 16, dy: -9, dur: 5.7, color: 'text-amber-200' },
            ].map((bf, idx) => (
              <motion.div
                key={`butterfly-${idx}`}
                animate={{
                  x: [0, bf.dx, bf.dx * 0.4, -bf.dx * 0.5, 0],
                  y: [0, bf.dy, -4, bf.dy * 0.7, 0],
                  scaleX: [1, 0.4, 1, 0.45, 1],
                }}
                transition={{
                  duration: bf.dur,
                  delay: idx * 0.85,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
                style={{ left: bf.left, top: bf.top }}
                className={`absolute w-2.5 h-2.5 ${bf.color} drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)]`}
              >
                <svg viewBox="0 0 16 12" className="w-full h-full fill-current">
                  <path d="M8 6 C5 1, 1 2, 2 6 C1 9, 5 11, 8 7 C11 11, 15 9, 14 6 C15 2, 11 1, 8 6 Z" />
                </svg>
              </motion.div>
            ))}

            {/* Warm wind ripples passing across golden wheat & terraced vegetable beds */}
            <motion.div
              animate={{ x: [-30, 38, -30], opacity: [0.1, 0.36, 0.1] }}
              transition={{ duration: 5.8, repeat: Infinity, ease: 'easeInOut' }}
              style={{ left: '84%', top: '61%', transform: 'rotate(-20deg)' }}
              className="absolute -translate-x-1/2 -translate-y-1/2 w-24 h-12 rounded-full bg-gradient-to-r from-transparent via-amber-200/50 to-transparent blur-md"
            />
            <motion.div
              animate={{ x: [-28, 34, -28], opacity: [0.08, 0.28, 0.08] }}
              transition={{ duration: 6.4, delay: 1.8, repeat: Infinity, ease: 'easeInOut' }}
              style={{ left: '25%', top: '58%', transform: 'rotate(-22deg)' }}
              className="absolute -translate-x-1/2 -translate-y-1/2 w-28 h-12 rounded-full bg-gradient-to-r from-transparent via-lime-200/40 to-transparent blur-md"
            />

            {/* 7. Packing & Processing delivery truck idle life & amber dispatch beacon */}
            <motion.span
              animate={{ opacity: [0.35, 1, 0.35], scale: [0.85, 1.25, 0.85] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
              style={{ left: '86.4%', top: '47.6%' }}
              className="absolute w-2 h-2 rounded-full bg-amber-300 shadow-[0_0_9px_rgba(252,211,77,0.95)]"
            />
            <motion.span
              animate={{ opacity: [0.18, 0.42, 0.18], scaleX: [0.95, 1.06, 0.95] }}
              transition={{ duration: 0.45, repeat: Infinity, ease: 'easeInOut' }}
              style={{ left: '92.5%', top: '49.8%' }}
              className="absolute w-3.5 h-2 rounded-full bg-stone-200/40 blur-[2px]"
            />

            {/* 8. Foreground pond fountain live vertical plume, droplet spray, shimmer & concentric ripples */}
            <div
              style={{ left: '63.5%', top: '75.5%' }}
              className="absolute -translate-x-1/2 -translate-y-1/2 w-32 h-16"
            >
              {[0, 0.7, 1.4].map((delaySec, idx) => (
                <motion.span
                  key={`ripple-${idx}`}
                  initial={{ opacity: 0.72, scale: 0.22 }}
                  animate={{ opacity: 0, scale: 1.5 }}
                  transition={{
                    duration: 2.1,
                    delay: delaySec,
                    repeat: Infinity,
                    ease: 'easeOut',
                  }}
                  className="absolute inset-0 rounded-[999px] border border-sky-100/75"
                />
              ))}
              {/* Vertical mist jet pulsing like video water spray */}
              <motion.span
                animate={{ scaleY: [0.82, 1.15, 0.88, 1.08, 0.82], opacity: [0.55, 0.85, 0.6, 0.8, 0.55] }}
                transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute left-1/2 bottom-1/2 -translate-x-1/2 w-3 h-7 origin-bottom rounded-t-full bg-gradient-to-t from-sky-100/75 via-white/85 to-transparent blur-[1px]"
              />
              {[
                { dx: -9, peak: -16, delay: 0 },
                { dx: -4, peak: -19, delay: 0.25 },
                { dx: 0, peak: -21, delay: 0.5 },
                { dx: 4, peak: -18, delay: 0.75 },
                { dx: 9, peak: -15, delay: 0.4 },
              ].map((drop, idx) => (
                <motion.span
                  key={`drop-${idx}`}
                  animate={{
                    y: [2, drop.peak, 5],
                    x: [0, drop.dx * 0.6, drop.dx],
                    opacity: [0, 0.95, 0],
                    scale: [0.6, 1.15, 0.5],
                  }}
                  transition={{
                    duration: 1.15,
                    delay: drop.delay,
                    repeat: Infinity,
                    ease: 'easeOut',
                  }}
                  className="absolute left-1/2 top-1/2 w-1.5 h-1.5 rounded-full bg-white/95 shadow-[0_0_6px_rgba(224,242,254,0.95)]"
                />
              ))}
            </div>

            {/* Foreground pond gentle sunlight water sparkles */}
            {[
              { left: '47%', top: '76%', delay: 0.2 },
              { left: '54%', top: '81%', delay: 1.1 },
              { left: '72%', top: '74%', delay: 0.6 },
              { left: '77%', top: '79%', delay: 1.9 },
            ].map((sparkle, idx) => (
              <motion.span
                key={`pond-glint-${idx}`}
                animate={{ opacity: [0.1, 0.75, 0.1], scaleX: [0.8, 1.35, 0.8] }}
                transition={{ duration: 2.8, delay: sparkle.delay, repeat: Infinity, ease: 'easeInOut' }}
                style={{ left: sparkle.left, top: sparkle.top }}
                className="absolute w-5 h-[2px] rounded-full bg-sky-100/80 blur-[0.5px]"
              />
            ))}

            {/* 9. Realistic swimming swans & ducks moving smoothly across the pond */}
            {[
              { left: '53%', top: '76%', rx: 22, ry: 7, dur: 9.2, isSwan: true },
              { left: '71%', top: '78%', rx: -20, ry: -6, dur: 10.6, isSwan: true },
              { left: '56%', top: '82%', rx: 18, ry: -5, dur: 8.0, isSwan: false },
              { left: '67%', top: '72%', rx: -16, ry: 5, dur: 9.8, isSwan: false },
            ].map((bird, idx) => (
              <motion.div
                key={`waterfowl-${idx}`}
                animate={{
                  x: [0, bird.rx, bird.rx * 0.5, -bird.rx * 0.4, 0],
                  y: [0, bird.ry, -bird.ry * 0.6, bird.ry * 0.4, 0],
                  rotate: [-2, 2, -1.5, 1.5, -2],
                }}
                transition={{
                  duration: bird.dur,
                  delay: idx * 0.75,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
                style={{ left: bird.left, top: bird.top }}
                className="absolute -translate-x-1/2 -translate-y-1/2"
              >
                <motion.span
                  animate={{ scale: [0.85, 1.25, 0.85], opacity: [0.55, 0.18, 0.55] }}
                  transition={{ duration: 2.2, delay: idx * 0.4, repeat: Infinity, ease: 'easeInOut' }}
                  className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-5 h-1.5 rounded-full border border-sky-100/65"
                />
                {bird.isSwan ? (
                  <svg viewBox="0 0 20 16" className="w-4 h-3.5 drop-shadow-[0_2px_3px_rgba(12,35,48,0.45)]">
                    <path
                      d="M4 11 C4 8, 9 8, 12 10 C13 7, 13 4, 15 3 C16.5 2.5, 17.5 3.5, 16.5 4.8 C15 5, 14.5 8, 15 11 C15 13, 6 13.5, 4 11 Z"
                      fill="#ffffff"
                    />
                    <path d="M16.5 4 L18.5 4.6 L16.4 5.2 Z" fill="#f59e0b" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 18 14" className="w-3.5 h-3 drop-shadow-[0_2px_3px_rgba(12,35,48,0.45)]">
                    <ellipse cx="8" cy="9" rx="5" ry="3" fill="#785032" />
                    <circle cx="13" cy="5.5" r="2.2" fill="#065f46" />
                    <path d="M14.8 5.4 L17 6 L14.8 6.4 Z" fill="#f59e0b" />
                  </svg>
                )}
              </motion.div>
            ))}
          </>
        )}

        {/* Active Auto-Harvest Drone patrolling smoothly above solar coops & crops */}
        {droneActive && !prefersReducedMotion && (
          <motion.div
            animate={{
              x: [-58, 56, 42, -46, -58],
              y: [-10, -24, 6, -4, -10],
            }}
            transition={{
              duration: 11,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
            style={{ left: '50%', top: '38%' }}
            className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center"
          >
            <div className="w-8 h-8 rounded-full bg-sky-500/20 border border-sky-300/70 backdrop-blur-sm flex items-center justify-center shadow-[0_6px_14px_rgba(14,165,233,0.45)]">
              <Bot className="w-4 h-4 text-sky-100" />
            </div>
            <span className="mt-1.5 w-6 h-1.5 rounded-full bg-stone-950/35 blur-[2px]" />
          </motion.div>
        )}
      </motion.div>

      {/* Dedicated Subtle Golden-Hour Atmospheric Layer: slow-drifting pollen & warm light dust */}
      <div
        data-layer="golden-hour-atmosphere"
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[5] overflow-hidden"
      >
        <div
          className={`absolute inset-0 transition-opacity duration-700 ${
            boosterActive
              ? 'bg-[radial-gradient(ellipse_at_25%_20%,rgba(110,231,183,0.14),transparent_60%)]'
              : 'bg-[radial-gradient(ellipse_at_22%_18%,rgba(253,224,71,0.14),transparent_62%),radial-gradient(ellipse_at_80%_72%,rgba(251,146,60,0.08),transparent_55%)]'
          }`}
        />
        {!prefersReducedMotion &&
          ATMOSPHERIC_DUST_PARTICLES.map((particle, idx) => {
            const toneClass = boosterActive
              ? 'bg-emerald-200/80 shadow-[0_0_8px_rgba(52,211,153,0.75)]'
              : particle.tone === 'amber'
                ? 'bg-amber-200/80 shadow-[0_0_8px_rgba(251,191,36,0.7)]'
                : particle.tone === 'gold'
                  ? 'bg-yellow-100/75 shadow-[0_0_7px_rgba(254,240,138,0.65)]'
                  : 'bg-amber-50/70 shadow-[0_0_6px_rgba(255,251,235,0.6)]';

            return (
              <motion.span
                key={`atmo-dust-${idx}`}
                initial={{ opacity: 0, x: 0, y: 0, scale: 0.7 }}
                animate={{
                  opacity: [0, 0.55, 0.35, 0.62, 0],
                  x: [0, particle.dx * 0.45, particle.dx * 0.85, particle.dx],
                  y: [0, particle.dy * 0.35, particle.dy * 0.72, particle.dy],
                  scale: [0.7, 1.05, 0.9, 1.1, 0.75],
                }}
                transition={{
                  duration: particle.duration,
                  delay: particle.delay,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
                style={{
                  left: particle.left,
                  top: particle.top,
                  width: `${particle.size}px`,
                  height: `${particle.size}px`,
                }}
                className={`absolute rounded-full will-change-transform ${toneClass}`}
              />
            );
          })}
      </div>

      {/* 2x Laying Feed & 3x Coop Fever Active Booster Auras */}
      {boosterActive && (
        <div
          aria-hidden="true"
          className="animate-booster-aura pointer-events-none absolute inset-0 z-[15] lg:rounded-[2rem] ring-4 ring-inset ring-emerald-400/55 shadow-[inset_0_0_32px_rgba(16,185,129,0.28)]"
        />
      )}
      {feverActive && (
        <div
          aria-hidden="true"
          className="animate-booster-aura pointer-events-none absolute inset-0 z-[15] lg:rounded-[2rem] ring-4 ring-inset ring-amber-400/75 shadow-[inset_0_0_44px_rgba(245,158,11,0.42)]"
        />
      )}

      {/* Top sky & bottom earth scrims for natural outdoor readability */}
      <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-stone-950/50 via-stone-950/20 to-transparent pointer-events-none" />
      <div className="absolute inset-x-0 bottom-0 h-52 bg-gradient-to-t from-stone-950/80 via-stone-950/35 to-transparent pointer-events-none" />

      {/* Top Mining HUD: 2x Feed Booster + Golden Egg Alert + GRAM Payout Status */}
      {!activeMilestone && (
        <div className="absolute top-3 inset-x-3 z-20 flex flex-col gap-1.5 pointer-events-none">
          <div className="flex items-center justify-between gap-2">
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

          {/* Row 2: Coop Fever 3x Rush (inside Farm section) + Auto-Harvest Drone Chip */}
          <div className="flex items-center justify-between gap-2">
            {feverActive ? (
              <div className="pointer-events-auto min-h-[40px] px-3 py-1.5 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 text-amber-950 border border-amber-200/70 text-[11px] font-extrabold inline-flex items-center gap-1.5 shadow-lg">
                <Flame className="w-3.5 h-3.5 fill-current shrink-0" />
                <span className="font-mono-num">
                  {COOP_FEVER_MULTIPLIER}× Fever · {formatCountdownMs(feverRemainingMs)}
                </span>
              </div>
            ) : onActivateCoopFever ? (
              <button
                type="button"
                onClick={onActivateCoopFever}
                aria-label={
                  feverProgress.ready
                    ? `Activate ${COOP_FEVER_MULTIPLIER}x Coop Fever Rush`
                    : `Coop Fever ${COOP_FEVER_MULTIPLIER}x Rush progress: ${feverProgress.adsCollected} of ${COOP_FEVER_REQUIRED_ADS} ads`
                }
                className={`clay-btn pointer-events-auto min-h-[40px] px-3 py-1.5 rounded-2xl text-[11px] font-extrabold inline-flex items-center gap-1.5 shadow-lg ${
                  feverProgress.ready
                    ? 'bg-gradient-to-r from-amber-400 via-orange-400 to-amber-300 text-amber-950 border border-amber-200 animate-pulse'
                    : 'bg-stone-950/72 hover:bg-stone-900/85 backdrop-blur-md border border-orange-400/35 text-amber-100'
                }`}
              >
                <Flame
                  className={`w-3.5 h-3.5 shrink-0 ${
                    feverProgress.ready ? 'text-orange-700 fill-orange-700' : 'text-orange-400'
                  }`}
                />
                {feverProgress.ready ? (
                  <span>Activate {COOP_FEVER_MULTIPLIER}× Fever!</span>
                ) : (
                  <span className="font-mono-num tabular-nums">
                    {COOP_FEVER_MULTIPLIER}× Fever · {feverProgress.adsCollected}/{COOP_FEVER_REQUIRED_ADS} Ads
                  </span>
                )}
              </button>
            ) : (
              <span />
            )}

            <button
              type="button"
              onClick={onOpenYourFarm}
              aria-label="Open Farm Manager & Auto-Harvest Drone controls"
              className={`clay-btn pointer-events-auto min-h-[40px] px-2.5 py-1.5 rounded-2xl text-[11px] font-extrabold inline-flex items-center gap-1.5 shadow-lg ${
                droneActive
                  ? 'bg-sky-950/80 backdrop-blur-md border border-sky-400/45 text-sky-200'
                  : 'bg-stone-950/65 hover:bg-stone-900/80 backdrop-blur-md border border-white/15 text-stone-200'
              }`}
            >
              <Bot className={`w-3.5 h-3.5 shrink-0 ${droneActive ? 'text-sky-400' : 'text-stone-400'}`} />
              <span className="font-mono-num tabular-nums">
                {droneActive
                  ? `Drone ${droneRemainingMs >= 3_600_000 ? `${Math.ceil(droneRemainingMs / 3_600_000)}h` : formatCountdownMs(droneRemainingMs)}`
                  : 'Auto-Drone'}
              </span>
            </button>
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
          const depthScale = Number((0.68 + ((hen.y - 40) / 26) * 0.24).toFixed(3));
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

      {/* Motion Particle Bursts on Egg Collection & Chicken Purchases */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[25] overflow-hidden"
      >
        <AnimatePresence>
          {chickenPurchaseBanner && (
            <motion.div
              key={`hen-banner-${chickenPurchaseBanner.seq}`}
              initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.85 }}
              animate={prefersReducedMotion ? { opacity: 1 } : { opacity: [0, 1, 1, 0], y: -38, scale: [0.85, 1.08, 1] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.3, ease: [0.16, 1, 0.3, 1] }}
              className="absolute left-1/2 top-[48%] -translate-x-1/2 rounded-full bg-gradient-to-r from-amber-400 to-emerald-400 text-stone-950 border border-white/80 px-3.5 py-1 text-xs font-extrabold shadow-xl whitespace-nowrap flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5 shrink-0" />
              <span>+{chickenPurchaseBanner.addedCount} {chickenPurchaseBanner.addedCount === 1 ? 'Hen' : 'Hens'} Joined Coop!</span>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {meadowParticles.map((p) => (
            <motion.div
              key={p.id}
              initial={{
                opacity: 0,
                x: 0,
                y: 0,
                scale: 0.35,
                rotate: 0,
              }}
              animate={{
                opacity: [0, 1, 1, 0],
                x: p.dx,
                y: p.dy,
                scale: [0.35, p.scale * 1.15, p.scale * 0.65],
                rotate: p.rotateDeg,
              }}
              exit={{ opacity: 0 }}
              transition={{
                duration: p.duration,
                delay: p.delay,
                ease: [0.16, 1, 0.3, 1],
              }}
              style={{
                left: `${p.originXPercent}%`,
                top: `${p.originYPercent}%`,
              }}
              className="absolute -translate-x-1/2 -translate-y-1/2 will-change-transform drop-shadow-[0_3px_8px_rgba(245,158,11,0.55)]"
            >
              {p.glyph === 'egg' ? (
                <EggIcon className="w-5 h-5" />
              ) : p.glyph === 'coin' ? (
                <CoinIcon className="w-5 h-5" />
              ) : p.glyph === 'feather' ? (
                <Feather className="w-5 h-5 text-amber-200 fill-amber-100/80" />
              ) : (
                <Star className="w-4 h-4 text-amber-300 fill-amber-300" />
              )}
            </motion.div>
          ))}
        </AnimatePresence>
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
