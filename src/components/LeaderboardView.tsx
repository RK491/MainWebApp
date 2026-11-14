import { useEffect, useState } from 'react';
import { ArrowLeft, Award, Crown, Trophy, Users } from 'lucide-react';
import {
  buildLeaderboardRankings,
  CHICKEN_PACKS,
  createDefaultSeasonConfig,
} from '../game/economy';
import type { LeaderboardEntry, SeasonConfig, UserFarmProfile } from '../types/farm';
import clayTrophyEmblem from '../assets/images/clay_trophy_emblem_1794678826544.jpg';
import { ChickenSprite, CoinIcon, EggIcon, PlayerAvatar } from './GameIcons';

interface LeaderboardViewProps {
  entries: LeaderboardEntry[];
  profile: UserFarmProfile;
  seasonConfig?: SeasonConfig;
  onTabTap?: () => void;
  onBack: () => void;
  onGoBuy: () => void;
}

export function LeaderboardView({
  entries,
  profile,
  seasonConfig,
  onTabTap,
  onBack,
  onGoBuy,
}: LeaderboardViewProps) {
  const [mode, setMode] = useState<'buyers' | 'inviters' | 'eggs'>('buyers');
  const [trophyFailed, setTrophyFailed] = useState(false);
  const activeSeason = seasonConfig ?? createDefaultSeasonConfig();
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const secondsLeft = Math.max(0, Math.floor((activeSeason.endsAtMs - nowMs) / 1000));
  const d = Math.floor(secondsLeft / 86400);
  const h = Math.floor((secondsLeft % 86400) / 3600);
  const m = Math.floor((secondsLeft % 3600) / 60);
  const s = secondsLeft % 60;
  const pad = (n: number) => String(n).padStart(2, '0');

  const { topBuyers, topInviters, topEggs, userBuyerRank, userPercentile, pointsToTop10 } =
    buildLeaderboardRankings(entries, profile);

  const list =
    mode === 'buyers' ? topBuyers : mode === 'inviters' ? topInviters : topEggs;
  const first = list[0];
  const second = list[1];
  const third = list[2];
  const rest = list.slice(3, 10);

  const renderMetric = (entry: LeaderboardEntry) => {
    if (mode === 'buyers') return `${entry.buyerPoints.toLocaleString()} pts`;
    if (mode === 'inviters') return `${entry.inviterCount.toLocaleString()} refs`;
    return `${entry.eggs.toLocaleString()} eggs`;
  };

  return (
    <div className="animate-clay-enter space-y-4 pb-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back from leaderboard"
          className="clay-btn clay-btn-neutral w-10 h-10 rounded-full flex items-center justify-center text-stone-700 dark:text-stone-200"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-xl font-extrabold text-stone-900 dark:text-stone-100">Live Leaderboard</h1>
          <p className="text-xs text-stone-500 dark:text-stone-400">Real-time database rankings · referrals, eggs &amp; points</p>
        </div>
      </div>

      {/* 3-Tab Switch: Top Buyers | Top Inviters | Most Eggs */}
      <div className="clay-inset !rounded-2xl grid grid-cols-3 gap-1.5 p-1.5">
        <button
          type="button"
          onClick={() => {
            onTabTap?.();
            setMode('buyers');
          }}
          className={`clay-btn min-h-[42px] rounded-xl text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 ${
            mode === 'buyers' ? 'clay-btn-emerald' : 'text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-stone-100'
          }`}
        >
          <Trophy className="w-4 h-4 shrink-0" />
          <span>Buyers</span>
        </button>

        <button
          type="button"
          onClick={() => {
            onTabTap?.();
            setMode('inviters');
          }}
          className={`clay-btn min-h-[42px] rounded-xl text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 ${
            mode === 'inviters' ? 'clay-btn-emerald' : 'text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-stone-100'
          }`}
        >
          <Users className="w-4 h-4 shrink-0" />
          <span>Referrals</span>
        </button>

        <button
          type="button"
          onClick={() => {
            onTabTap?.();
            setMode('eggs');
          }}
          className={`clay-btn min-h-[42px] rounded-xl text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 ${
            mode === 'eggs' ? 'clay-btn-emerald' : 'text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-stone-100'
          }`}
        >
          <EggIcon className="w-4 h-4 shrink-0" />
          <span>Eggs</span>
        </button>
      </div>

      {/* Event Prize Banner with Clay Trophy Artifact */}
      <div className="clay-card-warm p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="animate-clay-float w-14 h-14 rounded-2xl clay-icon-well p-1 flex items-center justify-center overflow-hidden shrink-0">
              {!trophyFailed ? (
                <img
                  src={clayTrophyEmblem}
                  alt="Claymorphism championship trophy"
                  referrerPolicy="no-referrer"
                  onError={() => setTrophyFailed(true)}
                  className="w-full h-full object-cover rounded-xl"
                />
              ) : (
                <Trophy className="w-7 h-7 text-amber-500" />
              )}
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-extrabold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                Season #{activeSeason.seasonNumber} · Live Competition
              </div>
              <div className="text-lg sm:text-xl font-extrabold text-amber-950 dark:text-amber-100 truncate">
                {activeSeason.title}
              </div>
              <div className="text-xs font-semibold text-stone-600 dark:text-stone-300 truncate">
                {entries.length} active farmers · Top 3 split pool (50/30/20%)
              </div>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-sm font-extrabold text-emerald-700 dark:text-emerald-400 font-mono-num">
              {activeSeason.prizePoolCoins.toLocaleString()}
            </div>
            <div className="text-[11px] font-bold text-stone-500 dark:text-stone-400">COINS pool</div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-amber-200/80 dark:border-amber-800/60">
          <span className="text-xs font-bold text-stone-600 dark:text-stone-300">
            {secondsLeft > 0 ? 'Ends in' : 'Season finishing — prizes ready'}
          </span>
          <div className="flex items-center gap-1 font-mono-num text-xs font-extrabold">
            <span className="px-2 py-1 rounded-xl bg-amber-950 text-amber-100 shadow-xs">{pad(d)}</span>
            <span className="text-amber-800 dark:text-amber-400">:</span>
            <span className="px-2 py-1 rounded-xl bg-amber-950 text-amber-100 shadow-xs">{pad(h)}</span>
            <span className="text-amber-800 dark:text-amber-400">:</span>
            <span className="px-2 py-1 rounded-xl bg-amber-950 text-amber-100 shadow-xs">{pad(m)}</span>
            <span className="text-amber-800 dark:text-amber-400">:</span>
            <span className="px-2 py-1 rounded-xl bg-amber-950 text-amber-100 shadow-xs">{pad(s)}</span>
          </div>
        </div>
      </div>

      {/* Recent Season Winners Strip */}
      {activeSeason.lastWinners && activeSeason.lastWinners.length > 0 && (
        <div className="clay-card p-3.5 space-y-2">
          <div className="text-xs font-extrabold text-stone-700 dark:text-stone-200 flex items-center gap-1.5">
            <Award className="w-4 h-4 text-amber-500" />
            <span>Recent Season Champions</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {activeSeason.lastWinners.slice(0, 3).map((w) => (
              <div
                key={`${w.uid}-${w.rank}`}
                className="clay-inset !rounded-xl px-2.5 py-2 flex items-center justify-between gap-2 text-xs"
              >
                <span className="font-bold text-stone-800 dark:text-stone-100 truncate">
                  #{w.rank} {w.displayName}
                </span>
                <span className="font-extrabold font-mono-num text-emerald-700 dark:text-emerald-400 shrink-0">
                  +{w.prizeCoins.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Points Per Chicken Legend */}
      <div className="clay-card p-3.5">
        <div className="text-xs font-extrabold text-stone-700 dark:text-stone-200 mb-2">Points per chicken</div>
        <div className="grid grid-cols-4 gap-2 text-center">
          {CHICKEN_PACKS.map((pack) => (
            <div key={pack.id} className="clay-inset p-2">
              <div className="flex justify-center">
                <ChickenSprite breed={pack.id} className="w-9 h-9" />
              </div>
              <div className="text-[10px] font-bold text-stone-700 dark:text-stone-200 truncate mt-1">
                {pack.name.split(' ')[0]}
              </div>
              <div className="text-[11px] font-extrabold text-amber-700 dark:text-amber-400 font-mono-num">
                {pack.leaderboardPoints} pt
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Top Podium (handles 1, 2, or 3+ real players cleanly!) */}
      {list.length > 0 && (
        <div className="grid grid-cols-3 gap-2 items-end pt-3">
          {/* 2nd Place */}
          {second ? (
            <div className="clay-card clay-hover-lift p-3 text-center">
              <PlayerAvatar
                photoUrl={second.photoUrl}
                displayName={second.displayName}
                avatarColor={second.avatarColor}
                className="mx-auto w-12 h-12 text-base border-2 border-slate-300 dark:border-slate-500"
              />
              <div className="mt-1 text-xs font-extrabold text-stone-900 dark:text-stone-100 truncate">
                {second.displayName} {second.isCurrentUser ? '(You)' : ''}
              </div>
              <div className="text-[11px] font-bold text-stone-500 dark:text-stone-400 font-mono-num">{renderMetric(second)}</div>
              <div className="mt-2 clay-inset !rounded-xl py-1 text-xs font-extrabold text-slate-700 dark:text-slate-200 flex items-center justify-center gap-1">
                <CoinIcon className="w-3.5 h-3.5" />
                <span>#2</span>
              </div>
            </div>
          ) : (
            <div className="clay-inset p-3 text-center text-xs text-stone-400 dark:text-stone-500">
              #2 Open
            </div>
          )}

          {/* 1st Place */}
          {first && (
            <div className="clay-card-warm clay-hover-lift p-3.5 text-center -mt-2">
              <div className="flex justify-center mb-1 text-amber-500 animate-clay-float">
                <Crown className="w-5 h-5 fill-amber-400" />
              </div>
              <PlayerAvatar
                photoUrl={first.photoUrl}
                displayName={first.displayName}
                avatarColor={first.avatarColor}
                className="mx-auto w-14 h-14 text-lg border-2 border-amber-400"
              />
              <div className="mt-1.5 text-xs font-extrabold text-stone-900 dark:text-stone-100 truncate">
                {first.displayName} {first.isCurrentUser ? '(You)' : ''}
              </div>
              <div className="text-[11px] font-bold text-amber-700 dark:text-amber-400 font-mono-num">{renderMetric(first)}</div>
              <div className="mt-2 clay-btn-amber rounded-xl py-1 text-xs font-extrabold flex items-center justify-center gap-1">
                <CoinIcon className="w-3.5 h-3.5" />
                <span>#1</span>
              </div>
            </div>
          )}

          {/* 3rd Place */}
          {third ? (
            <div className="clay-card clay-hover-lift p-3 text-center">
              <PlayerAvatar
                photoUrl={third.photoUrl}
                displayName={third.displayName}
                avatarColor={third.avatarColor}
                className="mx-auto w-12 h-12 text-base border-2 border-orange-300 dark:border-orange-500/70"
              />
              <div className="mt-1 text-xs font-extrabold text-stone-900 dark:text-stone-100 truncate">
                {third.displayName} {third.isCurrentUser ? '(You)' : ''}
              </div>
              <div className="text-[11px] font-bold text-stone-500 dark:text-stone-400 font-mono-num">{renderMetric(third)}</div>
              <div className="mt-2 clay-inset !rounded-xl py-1 text-xs font-extrabold text-orange-800 dark:text-orange-300 flex items-center justify-center gap-1">
                <CoinIcon className="w-3.5 h-3.5" />
                <span>#3</span>
              </div>
            </div>
          ) : (
            <div className="clay-inset p-3 text-center text-xs text-stone-400 dark:text-stone-500">
              #3 Open
            </div>
          )}
        </div>
      )}

      {/* Detailed Real-Time Leaderboard Table */}
      <div className="clay-card divide-y divide-stone-100 dark:divide-stone-800 overflow-hidden">
        {list.map((entry, idx) => {
          const rank = idx + 1;
          return (
            <div
              key={entry.uid}
              className={`p-3.5 flex items-center justify-between gap-3 ${
                entry.isCurrentUser ? 'bg-amber-50/75 dark:bg-amber-950/35' : ''
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-5 text-center text-xs font-extrabold text-stone-400 dark:text-stone-500 font-mono-num">
                  {rank}
                </span>
                <PlayerAvatar
                  photoUrl={entry.photoUrl}
                  displayName={entry.displayName}
                  avatarColor={entry.avatarColor}
                  className="w-9 h-9 text-xs"
                />
                <div className="min-w-0">
                  <div className="text-sm font-bold text-stone-900 dark:text-stone-100 truncate">
                    {entry.displayName} {entry.isCurrentUser ? '(You)' : ''}
                  </div>
                  <div className="text-xs text-stone-500 dark:text-stone-400 font-mono-num truncate">
                    {entry.eggs.toLocaleString()} eggs · {entry.inviterCount} refs · {entry.chickensCount} hens
                  </div>
                </div>
              </div>

              <div className="text-xs font-extrabold text-amber-700 dark:text-amber-400 font-mono-num shrink-0">
                {renderMetric(entry)}
              </div>
            </div>
          );
        })}
        {rest.length === 0 && list.length < 4 && (
          <div className="p-3 text-center text-xs text-stone-400 dark:text-stone-500">
            Invite friends or create additional accounts to populate more ranks live!
          </div>
        )}
      </div>

      {/* User Rank Callout */}
      <div className="clay-card-dark text-white p-3.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <PlayerAvatar
            photoUrl={profile.photoUrl}
            displayName={profile.displayName}
            avatarColor={profile.avatarColor}
            className="w-10 h-10 text-sm border-2 border-amber-400"
          />
          <div className="min-w-0">
            <div className="text-sm font-extrabold truncate">
              Rank #{userBuyerRank} · Top {userPercentile}%
            </div>
            <div className="text-xs text-stone-300 truncate">
              {pointsToTop10 > 0
                ? `${pointsToTop10} more points to enter the Top 10`
                : `${profile.eggs.toLocaleString()} eggs · ${profile.referralCount} referrals`}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onGoBuy}
          className="clay-btn clay-btn-emerald min-h-[42px] px-4 rounded-2xl text-xs font-extrabold shrink-0"
        >
          Buy
        </button>
      </div>
    </div>
  );
}
