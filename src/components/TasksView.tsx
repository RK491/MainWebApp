import { useState } from 'react';
import {
  Check,
  ChevronRight,
  ExternalLink,
  Flame,
  Gift,
  Heart,
  Link2,
  Megaphone,
  Play,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Ticket,
  Users,
  Wallet,
} from 'lucide-react';
import {
  calculateProductionRate,
  CHICKEN_PACKS,
  DAILY_STREAK_REWARDS,
  mergeTaskDefinitions,
} from '../game/economy';
import type { AdConfig, TaskDefinition, UserFarmProfile } from '../types/farm';
import { getTelegramChannelUrl, notifyTelegramOpenLink } from '../utils/telegram';
import { ChickenSprite, CoinIcon } from './GameIcons';

interface TasksViewProps {
  profile: UserFarmProfile;
  todayStr: string;
  customTasks: TaskDefinition[];
  adConfig: AdConfig;
  payoutChannelUrl?: string;
  watchingAd?: boolean;
  onTabTap?: () => void;
  onClaimPromo: (code: string) => void;
  onClaimDaily: () => void;
  onCompleteTask: (taskId: string) => void;
  onTriggerWatchAd: () => void;
}

const DEFAULT_PAYOUT_CHANNEL_URL = getTelegramChannelUrl('@AG_PAYOUTS');

export function TasksView({
  profile,
  todayStr,
  customTasks,
  adConfig,
  payoutChannelUrl = DEFAULT_PAYOUT_CHANNEL_URL,
  watchingAd = false,
  onTabTap,
  onClaimPromo,
  onClaimDaily,
  onCompleteTask,
  onTriggerWatchAd,
}: TasksViewProps) {
  const [subTab, setSubTab] = useState<'daily' | 'tasks'>('daily');
  const [promoInput, setPromoInput] = useState('');
  const [openPreviewId, setOpenPreviewId] = useState<string | null>(null);

  const dailyClaimedToday = profile.lastDailyClaimDate === todayStr;
  const nextDailyReward = DAILY_STREAK_REWARDS[profile.dailyStreak >= 7 ? 0 : profile.dailyStreak];
  const leghornPack = CHICKEN_PACKS[0];
  const currentProductionRate = calculateProductionRate(profile);

  const allTasks = mergeTaskDefinitions(customTasks);
  const dailyTasks = allTasks.filter((t) => t.category === 'daily');
  const milestoneTasks = allTasks.filter((t) => t.category === 'milestone');
  const partnerTasks = allTasks.filter((t) => t.category === 'partner');

  const remainingDailyCount =
    (dailyClaimedToday ? 0 : 1) +
    dailyTasks.filter((t) => !profile.completedTaskIds.includes(t.id)).length;
  const remainingMilestoneCount =
    milestoneTasks.filter((t) => !profile.completedTaskIds.includes(t.id)).length +
    partnerTasks.filter((t) => !profile.completedTaskIds.includes(t.id)).length;

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
      default:
        return <Link2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />;
    }
  };

  const renderTaskActionButton = (task: TaskDefinition) => {
    const done = profile.completedTaskIds.includes(task.id);
    if (!done && task.actionUrl) {
      return (
        <a
          href={task.actionUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            if (notifyTelegramOpenLink(task.actionUrl!)) {
              e.preventDefault();
            }
            onCompleteTask(task.id);
          }}
          className="clay-btn clay-btn-emerald min-h-[42px] min-w-[68px] px-4 rounded-2xl text-xs font-extrabold shrink-0 inline-flex items-center justify-center gap-1"
        >
          <span>Go</span>
          <ExternalLink className="w-3 h-3" />
        </a>
      );
    }

    return (
      <button
        type="button"
        disabled={done}
        onClick={() => onCompleteTask(task.id)}
        className={`clay-btn min-h-[42px] min-w-[68px] px-4 rounded-2xl text-xs font-extrabold shrink-0 ${
          done
            ? 'clay-inset text-emerald-700 dark:text-emerald-300 cursor-default shadow-none'
            : 'clay-btn-emerald'
        }`}
      >
        {done ? 'Done' : 'Go'}
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
          <span>Preview Reward: {shortBoostLabel}</span>
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
    const done = profile.completedTaskIds.includes(task.id);
    return (
      <div
        key={task.id}
        className="clay-card clay-hover-lift !rounded-2xl p-3.5 flex items-center justify-between gap-3"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-11 h-11 rounded-2xl clay-icon-well flex items-center justify-center shrink-0 ${extraWellClass}`}>
            {renderTaskIcon(task.icon)}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold text-stone-900 dark:text-stone-100 truncate">{task.title}</div>
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              <span className="inline-flex items-center gap-1 text-xs font-extrabold text-amber-700 dark:text-amber-400">
                <CoinIcon className="w-3.5 h-3.5" />
                <span className="font-mono-num">+{task.rewardCoins}</span>
              </span>
              {renderPreviewReward({
                id: `task_${task.id}`,
                rewardCoins: task.rewardCoins,
                claimed: done,
              })}
            </div>
          </div>
        </div>

        {renderTaskActionButton(task)}
      </div>
    );
  };

  return (
    <div className="animate-clay-enter space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold text-stone-900 dark:text-stone-100">Daily Tasks</h1>
        <p className="text-sm text-stone-500 dark:text-stone-400">Complete tasks and earn coin rewards</p>
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

      {/* Promo Code Card */}
      <div className="clay-card p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl clay-icon-well flex items-center justify-center text-amber-600 dark:text-amber-400">
              <Ticket className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-extrabold text-stone-900 dark:text-stone-100">Promo code</div>
              <div className="text-xs text-stone-500 dark:text-stone-400">New codes drop every day</div>
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
            placeholder="Enter your code"
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

      {/* Sub Tabs: Daily | Tasks */}
      <div className="clay-inset !rounded-2xl grid grid-cols-2 gap-1.5 p-1.5">
        <button
          type="button"
          onClick={() => {
            onTabTap?.();
            setSubTab('daily');
          }}
          className={`clay-btn min-h-[44px] rounded-xl text-sm font-extrabold flex items-center justify-center gap-2 ${
            subTab === 'daily'
              ? 'clay-btn-amber'
              : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-200'
          }`}
        >
          <span>Daily</span>
          <span className="text-xs font-mono-num px-1.5 py-0.5 rounded-lg bg-rose-500 text-white">
            {remainingDailyCount}
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            onTabTap?.();
            setSubTab('tasks');
          }}
          className={`clay-btn min-h-[44px] rounded-xl text-sm font-extrabold flex items-center justify-center gap-2 ${
            subTab === 'tasks'
              ? 'clay-btn-amber'
              : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-200'
          }`}
        >
          <span>Tasks</span>
          <span className="text-xs font-mono-num px-1.5 py-0.5 rounded-lg bg-rose-500 text-white">
            {remainingMilestoneCount}
          </span>
        </button>
      </div>

      {subTab === 'daily' ? (
        <div key="tasks-subtab-daily" className="animate-clay-enter space-y-4">
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

          {/* Every day tasks */}
          <div className="space-y-2.5">
            <h3 className="text-sm font-extrabold text-stone-700 dark:text-stone-300 px-1">Every day</h3>
            {dailyTasks.map((task) => renderTaskCard(task))}
          </div>
        </div>
      ) : (
        <div key="tasks-subtab-tasks" className="animate-clay-enter space-y-4">
          <div className="space-y-2.5">
            <h3 className="text-sm font-extrabold text-stone-700 dark:text-stone-300 px-1">Chicken Land</h3>

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
                className="clay-btn clay-btn-emerald min-h-[42px] px-3.5 rounded-2xl text-xs font-extrabold flex items-center gap-1.5 shrink-0"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>{watchingAd ? 'Loading...' : `Watch ${profile.watchedAdsCount}/10`}</span>
              </button>
            </div>

            {milestoneTasks.map((task) => renderTaskCard(task))}
          </div>

          <div className="space-y-2.5">
            <h3 className="text-sm font-extrabold text-stone-700 dark:text-stone-300 px-1">Partners</h3>
            {partnerTasks.map((task) => renderTaskCard(task))}
          </div>
        </div>
      )}
    </div>
  );
}
