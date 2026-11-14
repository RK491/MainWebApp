import { Globe, Plus, Trophy, Volume2, VolumeX } from 'lucide-react';
import type { UserFarmProfile } from '../types/farm';
import { CoinIcon, EggIcon, PlayerAvatar } from './GameIcons';
import { PWAInstallButton } from './PWAControls';

interface TopBarProps {
  profile: UserFarmProfile;
  coinsLabel: string;
  eggsLabel: string;
  isAllMuted: boolean;
  muteAllLabel: string;
  unmuteAllLabel: string;
  onOpenProfile: () => void;
  onOpenLeaderboard: () => void;
  onToggleMuteAll: () => void;
  onOpenSettings: () => void;
  onOpenDeposit: () => void;
}

export function TopBar({
  profile,
  coinsLabel,
  eggsLabel,
  isAllMuted,
  muteAllLabel,
  unmuteAllLabel,
  onOpenProfile,
  onOpenLeaderboard,
  onToggleMuteAll,
  onOpenSettings,
  onOpenDeposit,
}: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 clay-header px-3 sm:px-5 py-2.5 transition-colors">
      <div className="max-w-6xl mx-auto flex flex-col gap-2">
        {/* Row 1: User Profile Trigger + Utility Action Icons */}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onOpenProfile}
            aria-label={`Open profile for ${profile.displayName}`}
            className="clay-btn flex items-center gap-2.5 min-w-0 min-h-[44px] pr-3 pl-1 py-1 rounded-2xl hover:bg-white/60 dark:hover:bg-stone-800/60 transition-colors text-left"
          >
            <div className="relative shrink-0">
              <PlayerAvatar
                photoUrl={profile.photoUrl}
                displayName={profile.displayName}
                avatarColor={profile.avatarColor}
                className="w-10 h-10 text-base border-2 border-white dark:border-stone-800"
              />
              <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full clay-btn-amber border-2 border-white dark:border-stone-900 text-[10px] font-extrabold flex items-center justify-center">
                {profile.level}
              </span>
            </div>
            <div className="min-w-0">
              <div className="text-sm font-extrabold text-stone-900 dark:text-stone-100 truncate leading-tight">
                {profile.displayName}
              </div>
              <div className="text-xs font-medium text-stone-500 dark:text-stone-400 truncate">
                {profile.handle}
              </div>
            </div>
          </button>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <PWAInstallButton compact />

            <button
              type="button"
              onClick={onOpenLeaderboard}
              aria-label="Open Top 10 Leaderboard"
              className="clay-btn clay-btn-neutral w-10 h-10 rounded-2xl flex items-center justify-center text-amber-600 dark:text-amber-400"
            >
              <Trophy className="w-5 h-5" />
            </button>

            <button
              type="button"
              onClick={onToggleMuteAll}
              aria-pressed={isAllMuted}
              aria-label={
                isAllMuted
                  ? 'Unmute all music and sound effects'
                  : 'Mute all music and sound effects'
              }
              className={`clay-btn h-10 px-3 rounded-2xl flex items-center justify-center gap-1.5 text-xs font-extrabold whitespace-nowrap ${
                isAllMuted
                  ? 'bg-gradient-to-b from-rose-100 to-rose-200 dark:from-rose-950/90 dark:to-rose-900/80 border border-rose-300 dark:border-rose-700/70 text-rose-800 dark:text-rose-200 shadow-[0_6px_14px_-5px_rgba(225,29,72,0.28),0_2px_0_0_rgba(225,29,72,0.35),inset_0_2px_4px_rgba(255,255,255,0.6)]'
                  : 'clay-btn-neutral text-stone-700 dark:text-stone-200'
              }`}
            >
              {isAllMuted ? (
                <VolumeX className="w-4 h-4 shrink-0" />
              ) : (
                <Volume2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              )}
              <span>{isAllMuted ? unmuteAllLabel : muteAllLabel}</span>
            </button>

            <button
              type="button"
              onClick={onOpenSettings}
              aria-label="Open language and sound settings"
              className="clay-btn clay-btn-neutral w-10 h-10 rounded-2xl flex items-center justify-center text-stone-700 dark:text-stone-200"
            >
              <Globe className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Row 2: Coins & Eggs Clay Resource Wells */}
        <div className="grid grid-cols-2 gap-2.5">
          <div className="clay-card !rounded-2xl flex items-center justify-between gap-2 px-3 py-1.5">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-xl clay-icon-well flex items-center justify-center shrink-0">
                <CoinIcon className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="text-sm sm:text-base font-extrabold text-stone-900 dark:text-stone-100 font-mono-num leading-none truncate">
                  {profile.coins.toLocaleString()}
                </div>
                <div className="text-[10px] font-bold tracking-wide text-stone-500 dark:text-stone-400 mt-0.5">
                  {coinsLabel}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onOpenDeposit}
              aria-label="Top up coins"
              className="clay-btn clay-btn-emerald w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
            >
              <Plus className="w-4 h-4 stroke-[2.75]" />
            </button>
          </div>

          <div className="clay-card !rounded-2xl flex items-center gap-2 px-3 py-1.5">
            <div className="w-8 h-8 rounded-xl clay-icon-well flex items-center justify-center shrink-0">
              <EggIcon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="text-sm sm:text-base font-extrabold text-stone-900 dark:text-stone-100 font-mono-num leading-none truncate">
                {profile.eggs.toLocaleString()}
              </div>
              <div className="text-[10px] font-bold tracking-wide text-stone-500 dark:text-stone-400 mt-0.5">
                {eggsLabel}
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
