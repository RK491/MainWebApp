import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUpDown,
  Check,
  ChevronRight,
  Clock,
  Crown,
  ExternalLink,
  Flame,
  Gift,
  Heart,
  Link2,
  Loader2,
  Megaphone,
  Play,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Ticket,
  Tv,
  Users,
  Wallet,
  X,
  Zap,
} from 'lucide-react';
import {
  AD_NETWORK_TASKS,
  calculatePaidTaskCost,
  calculateProductionRate,
  CHICKEN_PACKS,
  DAILY_STREAK_REWARDS,
  getAdNetworkClaimCountToday,
  getTaskRemainingSlots,
  mergeTaskDefinitions,
  sortTasks,
  USER_TASK_MAX_REWARD_COINS,
  USER_TASK_MAX_SLOTS,
  USER_TASK_MIN_FEE_COINS,
  USER_TASK_MIN_REWARD_COINS,
  USER_TASK_MIN_SLOTS,
  USER_TASK_MIN_TOTAL_COST_COINS,
} from '../game/economy';
import type {
  AdConfig,
  AdNetworkId,
  ChannelVerificationResult,
  TaskCategory,
  TaskDefinition,
  TaskSortOption,
  UserFarmProfile,
} from '../types/farm';
import { getTelegramChannelUrl, notifyTelegramOpenLink } from '../utils/telegram';
import { hasConfiguredAdNetworkSdk } from '../utils/ads';
import { ChannelCheckCard } from './ChannelCheckPanel';
import { ChickenSprite, CoinIcon } from './GameIcons';

type FilterTab = 'social' | 'daily' | 'exclusive' | 'partner';
type TaskCheckStage = 'idle' | 'checking' | 'ready';

interface TasksViewProps {
  profile: UserFarmProfile;
  todayStr: string;
  customTasks: TaskDefinition[];
  adConfig: AdConfig;
  payoutChannelUrl?: string;
  watchingAd?: boolean;
  activeAdNetwork?: AdNetworkId | null;
  channelVerification?: ChannelVerificationResult | null;
  checkingChannels?: boolean;
  onCheckChannels?: () => Promise<ChannelVerificationResult | null> | void;
  onTabTap?: () => void;
  onClaimPromo: (code: string) => void;
  onClaimDaily: () => void;
  onCompleteTask: (taskId: string) => void;
  onTriggerWatchAd: () => void;
  onTriggerAdNetwork: (network: AdNetworkId) => void;
  onOpenDeposit?: () => void;
  onRefreshTasks?: (silent?: boolean) => Promise<boolean>;
  onCreateTask: (input: {
    title: string;
    subtitle?: string;
    category: TaskCategory;
    rewardCoins: number;
    icon: string;
    actionUrl: string;
    totalSlots: number;
  }) => Promise<boolean>;
}

const DEFAULT_PAYOUT_CHANNEL_URL = getTelegramChannelUrl('@AG_PAYOUTS');
const TASK_VERIFY_DELAY_MS = 2200;
const TASKS_AUTO_REFRESH_MS = 60_000;
const PULL_REFRESH_THRESHOLD_PX = 56;

export function TasksView({
  profile,
  todayStr,
  customTasks,
  adConfig,
  payoutChannelUrl = DEFAULT_PAYOUT_CHANNEL_URL,
  watchingAd = false,
  activeAdNetwork = null,
  channelVerification = null,
  checkingChannels = false,
  onCheckChannels,
  onTabTap,
  onClaimPromo,
  onClaimDaily,
  onCompleteTask,
  onTriggerWatchAd,
  onTriggerAdNetwork,
  onOpenDeposit,
  onRefreshTasks,
  onCreateTask,
}: TasksViewProps) {
  const [filterTab, setFilterTab] = useState<FilterTab>('daily');
  const [sortBy, setSortBy] = useState<TaskSortOption>('most_reward');
  const [promoInput, setPromoInput] = useState('');
  const [openPreviewId, setOpenPreviewId] = useState<string | null>(null);
  const [taskStages, setTaskStages] = useState<Record<string, TaskCheckStage>>({});
  const checkTimersRef = useRef<Record<string, number>>({});

  // Pull-to-refresh & 60s auto-refresh state
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const pullStartYRef = useRef<number | null>(null);
  const lastRefreshAtRef = useRef<number>(Date.now());
  const refreshingRef = useRef(false);

  // + Add paid task modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newSubtitle, setNewSubtitle] = useState('');
  const [newCategory, setNewCategory] = useState<FilterTab>('partner');
  const [newRewardCoins, setNewRewardCoins] = useState(String(USER_TASK_MIN_REWARD_COINS));
  const [newTotalSlots, setNewTotalSlots] = useState(String(USER_TASK_MIN_SLOTS));
  const [newIcon, setNewIcon] = useState('send');
  const [newActionUrl, setNewActionUrl] = useState('');
  const [creatingTask, setCreatingTask] = useState(false);

  const triggerRefresh = useCallback(
    async (silent = false) => {
      if (!onRefreshTasks || refreshingRef.current) return;
      refreshingRef.current = true;
      setIsRefreshing(true);
      try {
        await onRefreshTasks(silent);
        lastRefreshAtRef.current = Date.now();
      } finally {
        refreshingRef.current = false;
        setIsRefreshing(false);
      }
    },
    [onRefreshTasks],
  );

  useEffect(() => {
    const timers = checkTimersRef.current;
    return () => {
      Object.values(timers).forEach((id) => window.clearTimeout(id));
    };
  }, []);

  // Subtle 60-second auto-refresh + foreground catch-up for accurate slot counts
  useEffect(() => {
    if (!onRefreshTasks) return;
    const intervalId = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void triggerRefresh(true);
    }, TASKS_AUTO_REFRESH_MS);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (Date.now() - lastRefreshAtRef.current >= TASKS_AUTO_REFRESH_MS) {
          void triggerRefresh(true);
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [onRefreshTasks, triggerRefresh]);

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!onRefreshTasks || showAddModal || refreshingRef.current) return;
    if (typeof window !== 'undefined' && window.scrollY > 2) return;
    const touch = e.touches[0];
    if (touch) {
      pullStartYRef.current = touch.clientY;
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (pullStartYRef.current === null || refreshingRef.current) return;
    if (typeof window !== 'undefined' && window.scrollY > 2) {
      pullStartYRef.current = null;
      setPullDistance(0);
      return;
    }
    const touch = e.touches[0];
    if (!touch) return;
    const delta = touch.clientY - pullStartYRef.current;
    if (delta > 6) {
      setPullDistance(Math.min(84, Math.round(delta * 0.45)));
    } else {
      setPullDistance(0);
    }
  };

  const handleTouchEnd = () => {
    if (pullStartYRef.current === null) return;
    pullStartYRef.current = null;
    if (pullDistance >= PULL_REFRESH_THRESHOLD_PX) {
      setPullDistance(0);
      void triggerRefresh(false);
    } else {
      setPullDistance(0);
    }
  };

  const dailyClaimedToday = profile.lastDailyClaimDate === todayStr;
  const nextDailyReward = DAILY_STREAK_REWARDS[profile.dailyStreak >= 7 ? 0 : profile.dailyStreak];
  const leghornPack = CHICKEN_PACKS[0];
  const currentProductionRate = calculateProductionRate(profile);

  const allTasks = mergeTaskDefinitions(customTasks);
  const socialTasks = sortTasks(
    allTasks.filter((t) => t.category === 'social' || t.category === 'milestone'),
    sortBy,
    profile.completedTaskIds,
  );
  const dailyTasks = sortTasks(
    allTasks.filter((t) => t.category === 'daily'),
    sortBy,
    profile.completedTaskIds,
  );
  const exclusiveTasks = sortTasks(
    allTasks.filter((t) => t.category === 'exclusive'),
    sortBy,
    profile.completedTaskIds,
  );
  const partnerTasks = sortTasks(
    allTasks.filter((t) => t.category === 'partner'),
    sortBy,
    profile.completedTaskIds,
  );

  const countAvailableTasks = (list: TaskDefinition[]) =>
    list.filter((task) => {
      if (task.creatorUid && task.creatorUid === profile.uid) return false;
      const done = profile.completedTaskIds.includes(task.id);
      if (done) return false;
      const left = getTaskRemainingSlots(task, false);
      return left === null || left > 0;
    }).length;

  const adNetworksRemainingToday = AD_NETWORK_TASKS.reduce((sum, net) => {
    const watched = getAdNetworkClaimCountToday(profile.completedTaskIds, net.id, todayStr);
    return sum + Math.max(0, net.dailyLimit - watched);
  }, 0);

  const tabCounts: Record<FilterTab, number> = {
    social: countAvailableTasks(socialTasks),
    daily:
      (dailyClaimedToday ? 0 : 1) +
      (adNetworksRemainingToday > 0 ? AD_NETWORK_TASKS.filter((n) => getAdNetworkClaimCountToday(profile.completedTaskIds, n.id, todayStr) < n.dailyLimit).length : 0) +
      countAvailableTasks(dailyTasks),
    exclusive: countAvailableTasks(exclusiveTasks),
    partner: countAvailableTasks(partnerTasks),
  };

  const renderTaskIcon = (icon: string) => {
    switch (icon) {
      case 'megaphone':
        return <Megaphone className="w-5 h-5 text-sky-600 dark:text-sky-400" />;
      case 'wallet':
        return <Wallet className="w-5 h-5 text-amber-600 dark:text-amber-400" />;
      case 'ticket':
        return <Ticket className="w-5 h-5 text-amber-500 dark:text-amber-400" />;
      case 'gift':
        return <Gift className="w-5 h-5 text-rose-500 dark:text-rose-400" />;
      case 'refresh':
        return <RefreshCw className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />;
      case 'heart':
        return <Heart className="w-5 h-5 text-rose-500 dark:text-rose-400" />;
      case 'send':
        return <Send className="w-5 h-5 text-sky-500 dark:text-sky-400" />;
      case 'shield':
        return <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />;
      case 'users':
        return <Users className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />;
      case 'flame':
        return <Flame className="w-5 h-5 text-orange-500 dark:text-orange-400" />;
      case 'crown':
        return <Crown className="w-5 h-5 text-amber-500 dark:text-amber-400" />;
      default:
        return <Link2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />;
    }
  };

  const renderAdNetworkIcon = (networkId: AdNetworkId) => {
    if (networkId === 'adsgram') {
      return <Tv className="w-5 h-5 text-sky-600 dark:text-sky-400" />;
    }
    if (networkId === 'gigapub') {
      return <Zap className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />;
    }
    return <Sparkles className="w-5 h-5 text-amber-600 dark:text-amber-400" />;
  };

  const startCheckingFlow = (task: TaskDefinition) => {
    if (profile.completedTaskIds.includes(task.id)) return;
    const remainingSlots = getTaskRemainingSlots(task, false);
    if (remainingSlots !== null && remainingSlots <= 0) return;

    const currentStage = taskStages[task.id] ?? 'idle';
    if (currentStage !== 'idle') return;

    onTabTap?.();

    if (task.actionUrl) {
      const handledByTg = notifyTelegramOpenLink(task.actionUrl);
      if (!handledByTg && typeof window !== 'undefined') {
        window.open(task.actionUrl, '_blank', 'noopener,noreferrer');
      }
    }

    setTaskStages((prev) => ({ ...prev, [task.id]: 'checking' }));
    if (checkTimersRef.current[task.id]) {
      window.clearTimeout(checkTimersRef.current[task.id]);
    }
    checkTimersRef.current[task.id] = window.setTimeout(() => {
      setTaskStages((prev) => ({ ...prev, [task.id]: 'ready' }));
      delete checkTimersRef.current[task.id];
    }, TASK_VERIFY_DELAY_MS);
  };

  const handleClaimCheckedTask = async (task: TaskDefinition) => {
    if (profile.completedTaskIds.includes(task.id)) return;
    if (
      task.actionUrl &&
      onCheckChannels &&
      channelVerification?.verificationMode === 'telegram_bot'
    ) {
      const normalizedUrl = task.actionUrl.toLowerCase();
      const targetHandle = normalizedUrl.includes('airdrop_galaxys')
        ? '@AIRDROP_GALAXYS'
        : normalizedUrl.includes('ag_payouts')
          ? '@AG_PAYOUTS'
          : null;
      if (targetHandle) {
        const fresh = (await onCheckChannels()) || channelVerification;
        if (fresh?.verificationMode === 'telegram_bot') {
          const matched = fresh.channels.find(
            (ch) => ch.handle.toUpperCase() === targetHandle,
          );
          if (matched && !matched.joined) {
            setTaskStages((prev) => {
              const next = { ...prev };
              delete next[task.id];
              return next;
            });
            return;
          }
        }
      }
    }
    onCompleteTask(task.id);
    setTaskStages((prev) => {
      const next = { ...prev };
      delete next[task.id];
      return next;
    });
  };

  const renderTaskActionButton = (task: TaskDefinition) => {
    const isOwnTask = Boolean(task.creatorUid && task.creatorUid === profile.uid);
    const done = profile.completedTaskIds.includes(task.id);
    const remainingSlots = getTaskRemainingSlots(task, done);
    const soldOut = !done && remainingSlots !== null && remainingSlots <= 0;
    const stage = taskStages[task.id] ?? 'idle';

    if (isOwnTask) {
      return (
        <span className="clay-inset min-h-[42px] min-w-[78px] px-3.5 rounded-2xl text-xs font-extrabold text-indigo-700 dark:text-indigo-300 inline-flex items-center justify-center shrink-0">
          Posted
        </span>
      );
    }

    if (done) {
      return (
        <span className="clay-inset min-h-[42px] min-w-[78px] px-3.5 rounded-2xl text-xs font-extrabold text-emerald-700 dark:text-emerald-300 inline-flex items-center justify-center gap-1 shrink-0">
          <Check className="w-3.5 h-3.5" />
          <span>Done</span>
        </span>
      );
    }

    if (soldOut) {
      return (
        <span className="clay-inset min-h-[42px] min-w-[78px] px-3 rounded-2xl text-xs font-extrabold text-stone-400 dark:text-stone-500 inline-flex items-center justify-center shrink-0">
          Full
        </span>
      );
    }

    if (stage === 'checking') {
      return (
        <button
          type="button"
          disabled
          className="clay-btn clay-btn-neutral min-h-[42px] min-w-[96px] px-3 rounded-2xl text-xs font-extrabold text-amber-700 dark:text-amber-300 inline-flex items-center justify-center gap-1.5 shrink-0 cursor-wait opacity-90"
        >
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span>Checking</span>
        </button>
      );
    }

    if (stage === 'ready') {
      return (
        <button
          type="button"
          onClick={() => void handleClaimCheckedTask(task)}
          className="clay-btn clay-btn-emerald min-h-[42px] min-w-[84px] px-4 rounded-2xl text-xs font-extrabold inline-flex items-center justify-center gap-1 shrink-0 animate-pulse"
        >
          <Check className="w-3.5 h-3.5" />
          <span>Claim</span>
        </button>
      );
    }

    return (
      <button
        type="button"
        onClick={() => startCheckingFlow(task)}
        className="clay-btn clay-btn-amber min-h-[42px] min-w-[78px] px-4 rounded-2xl text-xs font-extrabold inline-flex items-center justify-center gap-1 shrink-0"
      >
        <span>{task.actionUrl ? 'Go' : 'Start'}</span>
        {task.actionUrl && <ExternalLink className="w-3 h-3" />}
      </button>
    );
  };

  const renderPreviewReward = (params: {
    id: string;
    rewardCoins?: number;
    eggBoostPerHour?: number;
    claimed?: boolean;
  }) => {
    const isOpen = openPreviewId === params.id;
    const coins = params.rewardCoins ?? 0;
    const eggBoost = params.eggBoostPerHour ?? 0;
    const equivalentEggRate = Number(
      ((coins / leghornPack.coinCost) * leghornPack.eggsPerHour).toFixed(1),
    );
    const shortBoostLabel =
      eggBoost > 0
        ? `+${eggBoost} eggs/h`
        : `+${coins.toLocaleString()} coins`;

    return (
      <div className="relative inline-flex items-center group">
        <button
          type="button"
          onClick={() => setOpenPreviewId((prev) => (prev === params.id ? null : params.id))}
          aria-expanded={isOpen}
          aria-label={`Preview Reward ${shortBoostLabel}`}
          className={`inline-flex items-center gap-1 rounded-xl px-2 py-0.5 text-[11px] font-bold border transition-colors cursor-pointer ${
            params.claimed
              ? 'bg-stone-100 dark:bg-stone-800 border-stone-200 dark:border-stone-700 text-stone-500 dark:text-stone-400'
              : 'bg-amber-50 dark:bg-amber-950/50 hover:bg-amber-100 dark:hover:bg-amber-900/60 border-amber-200 dark:border-amber-800/60 text-amber-800 dark:text-amber-300'
          }`}
        >
          <Sparkles className="w-3 h-3 shrink-0 text-amber-500 dark:text-amber-400" />
          <span>{shortBoostLabel}</span>
        </button>

        <div
          role="tooltip"
          className={`clay-card-dark absolute left-0 bottom-full mb-1.5 z-30 w-56 !rounded-2xl text-white p-2.5 text-[11px] leading-snug pointer-events-none transition-opacity ${
            isOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
          }`}
        >
          {eggBoost > 0 ? (
            <div className="space-y-1">
              <div className="font-extrabold text-amber-300">
                Reward: +1 {leghornPack.name}
              </div>
              <div className="font-mono-num text-emerald-300 font-bold">
                Egg Boost: +{eggBoost} eggs/h ({currentProductionRate} → {currentProductionRate + eggBoost} eggs/h)
              </div>
              <div className="text-stone-300">
                Value: {leghornPack.coinCost.toLocaleString()} coins
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="font-extrabold text-amber-300">
                Coin Boost: +{coins.toLocaleString()} coins
              </div>
              <div className="font-mono-num text-emerald-300 font-bold">
                Egg Power: ~+{equivalentEggRate} eggs/h toward {leghornPack.name}
              </div>
              {!params.claimed && (
                <div className="text-stone-300 font-mono-num">
                  Balance: {profile.coins.toLocaleString()} → {(profile.coins + coins).toLocaleString()}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderTaskCard = (task: TaskDefinition, extraWellClass = '') => {
    const isOwnTask = Boolean(task.creatorUid && task.creatorUid === profile.uid);
    const done = profile.completedTaskIds.includes(task.id);
    const remainingSlots = getTaskRemainingSlots(task, done);
    const hasSlotCounter = remainingSlots !== null;
    const totalSlots = Number(task.totalSlots ?? 0);
    const slotPct =
      hasSlotCounter && totalSlots > 0
        ? Math.max(0, Math.min(100, Math.round((remainingSlots / totalSlots) * 100)))
        : 0;
    const isLowSlots = hasSlotCounter && remainingSlots > 0 && slotPct <= 25;
    const isPaidTask = Boolean(task.creatorUid || (task.paidCoins ?? 0) > 0);
    const spotsLeftLabel = `${remainingSlots?.toLocaleString() ?? 0}/${totalSlots.toLocaleString()} spots left`;
    const stage = taskStages[task.id] ?? 'idle';

    return (
      <div
        key={task.id}
        className="clay-card clay-hover-lift !rounded-2xl p-3.5 space-y-2.5"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-11 h-11 rounded-2xl clay-icon-well flex items-center justify-center shrink-0 ${extraWellClass}`}>
              {renderTaskIcon(task.icon)}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold text-stone-900 dark:text-stone-100 truncate">
                  {task.title}
                </span>
                {isOwnTask && (
                  <span className="rounded-md bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800/60 px-1.5 py-0.5 text-[10px] font-extrabold text-indigo-700 dark:text-indigo-300 shrink-0">
                    Yours
                  </span>
                )}
                {!isOwnTask && isPaidTask && (
                  <span className="rounded-md bg-amber-100/80 dark:bg-amber-950/60 border border-amber-300/70 dark:border-amber-800/60 px-1.5 py-0.5 text-[10px] font-extrabold text-amber-800 dark:text-amber-300 shrink-0">
                    Paid
                  </span>
                )}
              </div>
              {task.subtitle && (
                <div className="text-[11px] text-stone-500 dark:text-stone-400 truncate mt-0.5">
                  {task.subtitle}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                <span className="inline-flex items-center gap-1 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200/80 dark:border-amber-800/60 px-2 py-0.5 text-xs font-extrabold text-amber-700 dark:text-amber-300">
                  <CoinIcon className="w-3.5 h-3.5" />
                  <span className="font-mono-num">+{task.rewardCoins.toLocaleString()}</span>
                </span>

                {hasSlotCounter && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-extrabold font-mono-num ${
                      remainingSlots === 0
                        ? 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800/60 text-rose-700 dark:text-rose-300'
                        : isLowSlots
                          ? 'bg-orange-50 dark:bg-orange-950/50 border-orange-200 dark:border-orange-800/60 text-orange-700 dark:text-orange-300'
                          : 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300'
                    }`}
                  >
                    <Clock className="w-3 h-3 shrink-0" />
                    <span>{spotsLeftLabel}</span>
                  </span>
                )}

                {!hasSlotCounter &&
                  renderPreviewReward({
                    id: `task_${task.id}`,
                    rewardCoins: task.rewardCoins,
                    claimed: done,
                  })}
              </div>
            </div>
          </div>

          {renderTaskActionButton(task)}
        </div>

        {(hasSlotCounter || stage !== 'idle') && (
          <div className="space-y-1.5">
            {hasSlotCounter && totalSlots > 0 && (
              <div className="space-y-1 pt-0.5">
                <div className="flex items-center justify-between text-[10px] font-bold px-0.5">
                  <span className="text-stone-500 dark:text-stone-400">
                    Remaining slots
                  </span>
                  <span
                    className={`font-mono-num font-extrabold ${
                      remainingSlots === 0
                        ? 'text-rose-600 dark:text-rose-400'
                        : isLowSlots
                          ? 'text-orange-600 dark:text-orange-400'
                          : 'text-emerald-700 dark:text-emerald-400'
                    }`}
                  >
                    {spotsLeftLabel}
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-label={spotsLeftLabel}
                  aria-valuenow={remainingSlots}
                  aria-valuemin={0}
                  aria-valuemax={totalSlots}
                  className="h-2 w-full rounded-lg clay-inset overflow-hidden"
                >
                  <div
                    className={`h-full rounded-lg transition-all duration-300 ${
                      remainingSlots === 0
                        ? 'bg-rose-400'
                        : isLowSlots
                          ? 'bg-gradient-to-r from-orange-400 to-amber-500'
                          : 'bg-gradient-to-r from-emerald-400 to-emerald-500'
                    }`}
                    style={{ width: `${slotPct}%` }}
                  />
                </div>
              </div>
            )}

            {stage === 'checking' && (
              <div className="text-[11px] font-bold text-amber-700 dark:text-amber-300 flex items-center gap-1.5 px-0.5">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Checking completion... claim unlocks in a moment</span>
              </div>
            )}
            {stage === 'ready' && !done && (
              <div className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5 px-0.5">
                <Check className="w-3 h-3" />
                <span>Verified! Tap Claim to receive +{task.rewardCoins.toLocaleString()} coins</span>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const parsedRewardCoins = Math.floor(Number(newRewardCoins) || 0);
  const parsedTotalSlots = Math.floor(Number(newTotalSlots) || 0);
  const taskCost = calculatePaidTaskCost(parsedRewardCoins, parsedTotalSlots);
  const hasValidPaidInputs =
    parsedRewardCoins >= USER_TASK_MIN_REWARD_COINS &&
    parsedRewardCoins <= USER_TASK_MAX_REWARD_COINS &&
    parsedTotalSlots >= USER_TASK_MIN_SLOTS &&
    parsedTotalSlots <= USER_TASK_MAX_SLOTS;
  const canAffordTask =
    profile.coins >= USER_TASK_MIN_TOTAL_COST_COINS && profile.coins >= taskCost.totalCostCoins;
  const requiredCoins = Math.max(USER_TASK_MIN_TOTAL_COST_COINS, taskCost.totalCostCoins);
  const coinsShort = Math.max(0, requiredCoins - profile.coins);

  const handleCreateTaskSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newTitle.trim().length < 2 || creatingTask || !hasValidPaidInputs || !canAffordTask) return;
    setCreatingTask(true);
    try {
      const ok = await onCreateTask({
        title: newTitle.trim(),
        subtitle: newSubtitle.trim() || undefined,
        category: newCategory,
        rewardCoins: taskCost.rewardCoins,
        icon: newIcon,
        actionUrl: newActionUrl.trim(),
        totalSlots: taskCost.totalSlots,
      });
      if (ok) {
        setFilterTab(newCategory);
        setNewTitle('');
        setNewSubtitle('');
        setNewActionUrl('');
        setShowAddModal(false);
      }
    } finally {
      setCreatingTask(false);
    }
  };

  const FILTER_TABS: Array<{ id: FilterTab; label: string }> = [
    { id: 'social', label: 'Social' },
    { id: 'daily', label: 'Daily' },
    { id: 'exclusive', label: 'Exclusive' },
    { id: 'partner', label: 'Partner' },
  ];

  return (
    <div
      className="animate-clay-enter space-y-4"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      {/* Pull-to-Refresh & Auto-Refresh Indicator */}
      {(pullDistance > 0 || isRefreshing) && (
        <div
          style={pullDistance > 0 ? { transform: `translateY(${Math.min(18, Math.round(pullDistance * 0.25))}px)` } : undefined}
          className="clay-card-warm !rounded-2xl px-3.5 py-2 flex items-center justify-center gap-2 text-xs font-extrabold text-amber-800 dark:text-amber-300 transition-transform"
        >
          {isRefreshing ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Refreshing task slots...</span>
            </>
          ) : (
            <>
              <ArrowDown
                className={`w-3.5 h-3.5 transition-transform duration-150 ${
                  pullDistance >= PULL_REFRESH_THRESHOLD_PX ? 'rotate-180 text-emerald-600 dark:text-emerald-400' : ''
                }`}
              />
              <span>
                {pullDistance >= PULL_REFRESH_THRESHOLD_PX
                  ? 'Release to refresh slots'
                  : 'Pull down to refresh slots'}
              </span>
            </>
          )}
        </div>
      )}

      {/* Header + Refresh & Add Task Buttons */}
      <div className="flex items-start justify-between gap-2.5">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold text-stone-900 dark:text-stone-100">Tasks</h1>
          <p className="text-sm text-stone-500 dark:text-stone-400">
            Complete tasks, watch ads &amp; claim coin rewards
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {onRefreshTasks && (
            <button
              type="button"
              onClick={() => {
                onTabTap?.();
                void triggerRefresh(false);
              }}
              disabled={isRefreshing}
              aria-label="Refresh task slots"
              title="Refresh task slots (auto-updates every 60s)"
              className="clay-btn clay-btn-neutral w-10 h-10 rounded-2xl flex items-center justify-center text-stone-700 dark:text-stone-200 disabled:opacity-60"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-amber-600 dark:text-amber-400' : ''}`} />
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              onTabTap?.();
              setNewCategory(filterTab);
              setShowAddModal(true);
            }}
            className="clay-btn clay-btn-amber min-h-[40px] px-3.5 rounded-2xl text-xs font-extrabold inline-flex items-center gap-1.5 shrink-0"
          >
            <Plus className="w-4 h-4 stroke-[2.6]" />
            <span>Add task</span>
          </button>
        </div>
      </div>

      {adConfig.bannerEnabled && adConfig.bannerTitle && (
        <div className="clay-card-warm p-3.5 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-extrabold uppercase tracking-wider text-sky-700 dark:text-sky-400">
              Sponsored Ad
            </div>
            <div className="text-sm font-extrabold text-stone-900 dark:text-stone-100 truncate">
              {adConfig.bannerTitle}
            </div>
            {adConfig.bannerSubtitle && (
              <div className="text-xs text-stone-500 dark:text-stone-400 truncate">{adConfig.bannerSubtitle}</div>
            )}
          </div>
          {adConfig.bannerUrl && (
            <a
              href={adConfig.bannerUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                if (notifyTelegramOpenLink(adConfig.bannerUrl)) {
                  e.preventDefault();
                }
              }}
              className="clay-btn clay-btn-sky min-h-[40px] px-3.5 rounded-2xl text-xs font-extrabold inline-flex items-center gap-1 shrink-0"
            >
              <span>{adConfig.bannerCtaText || 'Open'}</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      )}

      {onCheckChannels && (
        <ChannelCheckCard
          verification={channelVerification}
          checking={checkingChannels}
          onCheckChannels={() => {
            onTabTap?.();
            void onCheckChannels();
          }}
        />
      )}

      {/* Promo Code Card */}
      <div className="clay-card p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl clay-icon-well flex items-center justify-center text-amber-600 dark:text-amber-400">
              <Ticket className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-extrabold text-stone-900 dark:text-stone-100">Gift &amp; Promo Code</div>
              <div className="text-xs text-stone-500 dark:text-stone-400">
                Redeem coins, eggs &amp; free hens · Watch 1 short ad to unlock claim
              </div>
            </div>
          </div>
          <a
            href={payoutChannelUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              onTabTap?.();
              if (notifyTelegramOpenLink(payoutChannelUrl)) {
                e.preventDefault();
              }
            }}
            className="clay-btn clay-btn-neutral inline-flex items-center gap-1 min-h-[36px] px-3 py-1.5 rounded-xl text-xs font-extrabold text-indigo-700 dark:text-indigo-300 shrink-0"
          >
            <span>Get codes</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </a>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onClaimPromo(promoInput);
            setPromoInput('');
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={promoInput}
            onChange={(e) => setPromoInput(e.target.value)}
            placeholder="Enter gift or promo code"
            aria-label="Promo code"
            className="clay-inset flex-1 min-h-[44px] px-3.5 text-sm font-semibold text-stone-900 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
          <button
            type="submit"
            className="clay-btn clay-btn-emerald min-h-[44px] px-5 rounded-2xl text-sm font-extrabold"
          >
            Claim
          </button>
        </form>
      </div>

      {/* 4 Filter Categories: Social | Daily | Exclusive | Partner */}
      <div
        role="tablist"
        aria-label="Task categories"
        className="clay-inset !rounded-2xl grid grid-cols-4 gap-1 p-1.5"
      >
        {FILTER_TABS.map((tab) => {
          const isActive = filterTab === tab.id;
          const count = tabCounts[tab.id];
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => {
                onTabTap?.();
                setFilterTab(tab.id);
              }}
              className={`clay-btn min-h-[42px] px-1.5 rounded-xl text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1 ${
                isActive
                  ? 'clay-btn-amber'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-200'
              }`}
            >
              <span className="truncate">{tab.label}</span>
              {count > 0 && (
                <span
                  className={`text-[10px] font-mono-num px-1.5 py-0.5 rounded-md font-extrabold ${
                    isActive
                      ? 'bg-amber-950/20 text-amber-950'
                      : 'bg-rose-500 text-white'
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Task Sort Dropdown */}
      <div className="flex items-center justify-between gap-2 px-1">
        <label
          htmlFor="tasks-sort-select"
          className="inline-flex items-center gap-1.5 text-xs font-extrabold text-stone-600 dark:text-stone-400"
        >
          <ArrowUpDown className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
          <span>Sort tasks</span>
        </label>
        <select
          id="tasks-sort-select"
          aria-label="Sort tasks"
          value={sortBy}
          onChange={(e) => {
            onTabTap?.();
            setSortBy(e.target.value as TaskSortOption);
          }}
          className="clay-inset !rounded-xl min-h-[36px] px-3 py-1 text-xs font-extrabold text-stone-800 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-400 cursor-pointer"
        >
          <option value="most_reward">Most Reward</option>
          <option value="newest">Newest</option>
          <option value="ending_soon">Ending Soon</option>
        </select>
      </div>

      {/* SOCIAL TAB */}
      {filterTab === 'social' && (
        <div key="tasks-tab-social" className="animate-clay-enter space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-sm font-extrabold text-stone-700 dark:text-stone-300">
              Social &amp; Community Tasks
            </h3>
            <span className="text-[11px] font-bold text-stone-500 dark:text-stone-400">
              Checking → Claim
            </span>
          </div>
          {socialTasks.length === 0 ? (
            <div className="clay-card p-6 text-center text-xs text-stone-500 dark:text-stone-400">
              No social tasks yet. Tap + Add task above to create one.
            </div>
          ) : (
            <div className="space-y-2.5">
              {socialTasks.map((task) => renderTaskCard(task))}
            </div>
          )}
        </div>
      )}

      {/* DAILY TAB */}
      {filterTab === 'daily' && (
        <div key="tasks-tab-daily" className="animate-clay-enter space-y-4">
          {/* 7-Day Daily Login */}
          <div className="clay-card p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-extrabold text-stone-900 dark:text-stone-100">Daily Login</h2>
                <p className="text-xs text-stone-500 dark:text-stone-400">
                  {dailyClaimedToday ? 'Claimed today · come back tomorrow' : 'Claim your daily coin streak bonus'}
                </p>
                <div className="mt-1.5">
                  {renderPreviewReward({
                    id: 'daily_streak',
                    rewardCoins: nextDailyReward,
                    claimed: dailyClaimedToday,
                  })}
                </div>
              </div>
              <button
                type="button"
                onClick={onClaimDaily}
                disabled={dailyClaimedToday}
                className={`clay-btn min-h-[42px] px-4 rounded-2xl text-xs font-extrabold flex items-center gap-1.5 ${
                  dailyClaimedToday
                    ? 'clay-inset text-emerald-700 dark:text-emerald-300 cursor-default shadow-none'
                    : 'clay-btn-emerald'
                }`}
              >
                {dailyClaimedToday ? (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Claimed</span>
                  </>
                ) : (
                  <span>Claim +{nextDailyReward}</span>
                )}
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1.5">
              {DAILY_STREAK_REWARDS.map((reward, idx) => {
                const dayNum = idx + 1;
                const claimed = dayNum <= profile.dailyStreak;
                const isNext = dayNum === (profile.dailyStreak >= 7 ? 1 : profile.dailyStreak + 1) && !dailyClaimedToday;
                return (
                  <div
                    key={dayNum}
                    className={`rounded-2xl p-1.5 text-center transition-transform ${
                      claimed
                        ? 'clay-card-mint !rounded-2xl text-emerald-900 dark:text-emerald-200'
                        : isNext
                          ? 'clay-card-warm !rounded-2xl text-amber-950 dark:text-amber-200 scale-[1.03]'
                          : 'clay-inset !rounded-2xl text-stone-600 dark:text-stone-400'
                    }`}
                  >
                    <div className="text-[10px] font-bold">Day {dayNum}</div>
                    <div className="flex justify-center my-1">
                      <CoinIcon className="w-5 h-5" />
                    </div>
                    <div className="text-[11px] font-extrabold font-mono-num">{reward}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Ad-Network Tasks (Daily): AdsGram, Gigapub, Monetag (+80 to +100 coins per ad) */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-sm font-extrabold text-stone-700 dark:text-stone-300">
                Ad-Network Tasks (Daily)
              </h3>
              <span className="rounded-lg bg-amber-100 dark:bg-amber-950/60 border border-amber-300/70 dark:border-amber-800/60 px-2 py-0.5 text-[11px] font-extrabold text-amber-800 dark:text-amber-300 font-mono-num">
                +80 to +100 / ad
              </span>
            </div>

            {AD_NETWORK_TASKS.map((network) => {
              const watchedToday = getAdNetworkClaimCountToday(
                profile.completedTaskIds,
                network.id,
                todayStr,
              );
              const leftToday = Math.max(0, network.dailyLimit - watchedToday);
              const isBusy = watchingAd && activeAdNetwork === network.id;
              const maxedOut = leftToday === 0;
              const sdkConfigured = hasConfiguredAdNetworkSdk(network.id, adConfig);

              return (
                <div
                  key={network.id}
                  className="clay-card clay-hover-lift !rounded-2xl p-3.5 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 rounded-2xl clay-icon-well flex items-center justify-center shrink-0">
                      {renderAdNetworkIcon(network.id)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-extrabold text-stone-900 dark:text-stone-100">
                          {network.name}
                        </span>
                        <span className="rounded-md bg-stone-100 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 px-1.5 py-0.5 text-[10px] font-bold text-stone-600 dark:text-stone-300">
                          {network.badge}
                        </span>
                        <span
                          className={`rounded-md border px-1.5 py-0.5 text-[10px] font-extrabold ${
                            sdkConfigured
                              ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300'
                              : 'bg-sky-50 dark:bg-sky-950/60 border-sky-200 dark:border-sky-800/60 text-sky-700 dark:text-sky-300'
                          }`}
                        >
                          {sdkConfigured ? 'SDK Live' : 'Timer Ad'}
                        </span>
                      </div>
                      <div className="text-[11px] text-stone-500 dark:text-stone-400 truncate mt-0.5">
                        {network.subtitle}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        <span className="inline-flex items-center gap-1 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200/80 dark:border-amber-800/60 px-2 py-0.5 text-xs font-extrabold text-amber-700 dark:text-amber-300">
                          <CoinIcon className="w-3.5 h-3.5" />
                          <span className="font-mono-num">+{network.rewardCoins} / ad</span>
                        </span>
                        <span
                          className={`rounded-lg border px-2 py-0.5 text-[11px] font-extrabold font-mono-num ${
                            maxedOut
                              ? 'bg-stone-100 dark:bg-stone-800 border-stone-200 dark:border-stone-700 text-stone-500 dark:text-stone-400'
                              : 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300'
                          }`}
                        >
                          {leftToday}/{network.dailyLimit} left today
                        </span>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={watchingAd || maxedOut}
                    onClick={() => {
                      onTabTap?.();
                      onTriggerAdNetwork(network.id);
                    }}
                    className={`clay-btn min-h-[42px] min-w-[82px] px-3.5 rounded-2xl text-xs font-extrabold flex items-center justify-center gap-1.5 shrink-0 ${
                      maxedOut
                        ? 'clay-inset text-emerald-700 dark:text-emerald-300 cursor-default shadow-none'
                        : 'clay-btn-emerald'
                    }`}
                  >
                    {maxedOut ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Done</span>
                      </>
                    ) : isBusy ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Loading</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Watch</span>
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Interactive Watch 10 Ads Card */}
          <div className="clay-card clay-hover-lift !rounded-2xl p-3.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-2xl clay-icon-well flex items-center justify-center shrink-0">
                <ChickenSprite breed="leghorn" className="w-8 h-8" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-bold text-stone-900 dark:text-stone-100">
                  Watch 10 ads, get a free chicken
                </div>
                <div className="text-xs font-semibold text-stone-500 dark:text-stone-400 mt-0.5">
                  +1 White Leghorn · Progress{' '}
                  <span className="font-mono-num text-emerald-700 dark:text-emerald-400 font-bold">
                    {profile.watchedAdsCount}/10
                  </span>
                </div>
                <div className="mt-1">
                  {renderPreviewReward({
                    id: 'watch_10_ads',
                    eggBoostPerHour: leghornPack.eggsPerHour,
                  })}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={onTriggerWatchAd}
              disabled={watchingAd}
              className="clay-btn clay-btn-amber min-h-[42px] px-3.5 rounded-2xl text-xs font-extrabold flex items-center gap-1.5 shrink-0"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>{watchingAd && !activeAdNetwork ? 'Loading...' : `Watch ${profile.watchedAdsCount}/10`}</span>
            </button>
          </div>

          {/* Every day tasks */}
          <div className="space-y-2.5">
            <h3 className="text-sm font-extrabold text-stone-700 dark:text-stone-300 px-1">Every day</h3>
            {dailyTasks.map((task) => renderTaskCard(task))}
          </div>
        </div>
      )}

      {/* EXCLUSIVE TAB */}
      {filterTab === 'exclusive' && (
        <div key="tasks-tab-exclusive" className="animate-clay-enter space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-sm font-extrabold text-stone-700 dark:text-stone-300">
              Exclusive Limited-Slot Quests
            </h3>
            <span className="text-[11px] font-bold text-stone-500 dark:text-stone-400">
              Checking → Claim
            </span>
          </div>
          {exclusiveTasks.length === 0 ? (
            <div className="clay-card p-6 text-center text-xs text-stone-500 dark:text-stone-400">
              No exclusive tasks yet. Tap + Add task above to create one.
            </div>
          ) : (
            <div className="space-y-2.5">
              {exclusiveTasks.map((task) => renderTaskCard(task))}
            </div>
          )}
        </div>
      )}

      {/* PARTNER TAB */}
      {filterTab === 'partner' && (
        <div key="tasks-tab-partner" className="animate-clay-enter space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-sm font-extrabold text-stone-700 dark:text-stone-300">
              Partner Quests
            </h3>
            <span className="text-[11px] font-bold text-stone-500 dark:text-stone-400">
              Checking → Claim
            </span>
          </div>
          {partnerTasks.length === 0 ? (
            <div className="clay-card p-6 text-center text-xs text-stone-500 dark:text-stone-400">
              No partner tasks yet. Tap + Add task above to create one.
            </div>
          ) : (
            <div className="space-y-2.5">
              {partnerTasks.map((task) => renderTaskCard(task))}
            </div>
          )}
        </div>
      )}

      {/* + Add Paid Task Modal */}
      {showAddModal && (
        <div
          className="animate-clay-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-task-modal-title"
        >
          <form
            onSubmit={(e) => void handleCreateTaskSubmit(e)}
            className="animate-clay-modal clay-card w-full max-w-md p-5 space-y-3.5 my-auto"
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 id="add-task-modal-title" className="text-base font-extrabold text-stone-900 dark:text-stone-100">
                  Post a Paid Task
                </h2>
                <p className="text-xs text-stone-500 dark:text-stone-400">
                  Min {USER_TASK_MIN_TOTAL_COST_COINS.toLocaleString()} coins · {USER_TASK_MIN_SLOTS}+ joins · {USER_TASK_MIN_REWARD_COINS}+ coins/join · 10% fee
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                aria-label="Close add task modal"
                className="clay-btn clay-btn-neutral w-9 h-9 rounded-xl flex items-center justify-center text-stone-600 dark:text-stone-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="clay-inset !rounded-xl px-3 py-2 flex items-center justify-between text-xs">
              <span className="font-bold text-stone-600 dark:text-stone-400">Your Coin Balance</span>
              <span className="inline-flex items-center gap-1 font-mono-num font-extrabold text-amber-700 dark:text-amber-300">
                <CoinIcon className="w-4 h-4" />
                <span>{profile.coins.toLocaleString()}</span>
              </span>
            </div>

            <div className="space-y-1">
              <label htmlFor="new-task-title" className="text-xs font-bold text-stone-700 dark:text-stone-300">
                Task Title
              </label>
              <input
                id="new-task-title"
                type="text"
                required
                minLength={2}
                maxLength={80}
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Join Partner TON Channel"
                className="clay-inset w-full min-h-[42px] px-3 text-sm font-semibold text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="new-task-subtitle" className="text-xs font-bold text-stone-700 dark:text-stone-300">
                Short Description (optional)
              </label>
              <input
                id="new-task-subtitle"
                type="text"
                maxLength={120}
                value={newSubtitle}
                onChange={(e) => setNewSubtitle(e.target.value)}
                placeholder="Complete check to unlock instant coin reward"
                className="clay-inset w-full min-h-[40px] px-3 text-xs font-medium text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <label htmlFor="new-task-category" className="text-xs font-bold text-stone-700 dark:text-stone-300">
                  Category
                </label>
                <select
                  id="new-task-category"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as FilterTab)}
                  className="clay-inset w-full min-h-[42px] px-2.5 text-xs font-bold text-stone-900 dark:text-stone-100"
                >
                  <option value="social">Social</option>
                  <option value="daily">Daily</option>
                  <option value="exclusive">Exclusive</option>
                  <option value="partner">Partner</option>
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor="new-task-icon" className="text-xs font-bold text-stone-700 dark:text-stone-300">
                  Icon
                </label>
                <select
                  id="new-task-icon"
                  value={newIcon}
                  onChange={(e) => setNewIcon(e.target.value)}
                  className="clay-inset w-full min-h-[42px] px-2.5 text-xs font-bold text-stone-900 dark:text-stone-100"
                >
                  <option value="send">Telegram</option>
                  <option value="megaphone">Channel</option>
                  <option value="gift">Exclusive Gift</option>
                  <option value="flame">Hot Quest</option>
                  <option value="link">Partner Link</option>
                  <option value="users">Social / Community</option>
                  <option value="shield">Verified</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <label htmlFor="new-task-reward" className="text-xs font-bold text-stone-700 dark:text-stone-300">
                  Reward / User (min {USER_TASK_MIN_REWARD_COINS})
                </label>
                <input
                  id="new-task-reward"
                  type="number"
                  min={USER_TASK_MIN_REWARD_COINS}
                  max={USER_TASK_MAX_REWARD_COINS}
                  required
                  value={newRewardCoins}
                  onChange={(e) => setNewRewardCoins(e.target.value)}
                  className="clay-inset w-full min-h-[42px] px-3 text-sm font-mono-num font-bold text-stone-900 dark:text-stone-100"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="new-task-slots" className="text-xs font-bold text-stone-700 dark:text-stone-300">
                  Slots (min {USER_TASK_MIN_SLOTS})
                </label>
                <input
                  id="new-task-slots"
                  type="number"
                  min={USER_TASK_MIN_SLOTS}
                  max={USER_TASK_MAX_SLOTS}
                  required
                  value={newTotalSlots}
                  onChange={(e) => setNewTotalSlots(e.target.value)}
                  className="clay-inset w-full min-h-[42px] px-3 text-sm font-mono-num font-bold text-stone-900 dark:text-stone-100"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label htmlFor="new-task-url" className="text-xs font-bold text-stone-700 dark:text-stone-300">
                Action URL (optional)
              </label>
              <input
                id="new-task-url"
                type="url"
                maxLength={256}
                value={newActionUrl}
                onChange={(e) => setNewActionUrl(e.target.value)}
                placeholder="https://t.me/..."
                className="clay-inset w-full min-h-[42px] px-3 text-xs font-medium text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>

            {/* Live Cost Breakdown */}
            <div className="clay-card-warm !rounded-2xl p-3 space-y-1.5 text-xs">
              <div className="flex items-center justify-between text-stone-600 dark:text-stone-300">
                <span>
                  Reward Pool ({taskCost.rewardCoins.toLocaleString()} × {taskCost.totalSlots.toLocaleString()})
                </span>
                <span className="font-mono-num font-bold">{taskCost.rewardPoolCoins.toLocaleString()} coins</span>
              </div>
              <div className="flex items-center justify-between text-stone-600 dark:text-stone-300">
                <span>Posting Fee (10%, min {USER_TASK_MIN_FEE_COINS.toLocaleString()})</span>
                <span className="font-mono-num font-bold">+{taskCost.platformFeeCoins.toLocaleString()} coins</span>
              </div>
              <div className="border-t border-amber-300/60 dark:border-amber-800/50 pt-1.5 flex items-center justify-between font-extrabold text-stone-900 dark:text-stone-100">
                <span>Total Cost</span>
                <span className="inline-flex items-center gap-1 font-mono-num text-amber-800 dark:text-amber-300">
                  <CoinIcon className="w-4 h-4" />
                  <span>{taskCost.totalCostCoins.toLocaleString()} coins</span>
                </span>
              </div>
            </div>

            {!canAffordTask && (
              <div className="rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 px-3 py-2 flex items-center justify-between gap-2 text-xs font-bold text-rose-700 dark:text-rose-300">
                <span>
                  {profile.coins < USER_TASK_MIN_TOTAL_COST_COINS
                    ? `Minimum ${USER_TASK_MIN_TOTAL_COST_COINS.toLocaleString()} coins required (${coinsShort.toLocaleString()} short).`
                    : `Need ${coinsShort.toLocaleString()} more coins to publish.`}
                </span>
                {onOpenDeposit && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddModal(false);
                      onOpenDeposit();
                    }}
                    className="clay-btn clay-btn-amber px-2.5 py-1 rounded-lg text-[11px] font-extrabold shrink-0"
                  >
                    Deposit
                  </button>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="clay-btn clay-btn-neutral min-h-[44px] rounded-2xl text-xs font-extrabold text-stone-700 dark:text-stone-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creatingTask || newTitle.trim().length < 2 || !hasValidPaidInputs || !canAffordTask}
                className="clay-btn clay-btn-emerald min-h-[44px] rounded-2xl text-xs font-extrabold inline-flex items-center justify-center gap-1 disabled:opacity-50"
              >
                {creatingTask ? (
                  <span>Publishing...</span>
                ) : (
                  <>
                    <CoinIcon className="w-3.5 h-3.5" />
                    <span>Pay {taskCost.totalCostCoins.toLocaleString()}</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
