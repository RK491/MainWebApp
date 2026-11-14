import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Award,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Flame,
  Gift,
  Link2,
  ListPlus,
  Lock,
  LogOut,
  Megaphone,
  PauseCircle,
  PlayCircle,
  Search,
  Send,
  ShieldCheck,
  Ticket,
  Trash2,
  Trophy,
  Users,
  Wallet,
  XCircle,
} from 'lucide-react';
import type {
  AdConfig,
  AdProviderType,
  DynamicPromoCode,
  LeaderboardEntry,
  SeasonConfig,
  TaskDefinition,
  WithdrawRequestRecord,
} from '../types/farm';
import { getWithdrawalStatusMeta } from '../game/economy';

interface AdminPanelViewProps {
  playerId: string;
  withdrawRequests: WithdrawRequestRecord[];
  customTasks: TaskDefinition[];
  adConfig: AdConfig;
  promoCodes: DynamicPromoCode[];
  seasonConfig: SeasonConfig;
  leaderboardEntries: LeaderboardEntry[];
  onBack: () => void;
  onTabTap?: () => void;
  onReviewWithdrawal: (
    request: WithdrawRequestRecord,
    decision: 'approved' | 'rejected',
    adminNote: string,
  ) => Promise<void>;
  onCreateTask: (input: {
    title: string;
    category: TaskDefinition['category'];
    rewardCoins: number;
    icon: string;
    actionUrl: string;
  }) => Promise<void>;
  onToggleTask: (taskId: string, isActive: boolean) => Promise<void>;
  onDeleteTask: (taskId: string) => Promise<void>;
  onSaveAdConfig: (config: Omit<AdConfig, 'updatedAtMs'>) => Promise<void>;
  onCreatePromoCode: (input: {
    code: string;
    label: string;
    coins: number;
    maxUses: number;
    expiresInHours: number;
  }) => Promise<void>;
  onTogglePromoCode: (code: string, isActive: boolean) => Promise<void>;
  onDeletePromoCode: (code: string) => Promise<void>;
  onSaveSeasonConfig: (config: Omit<SeasonConfig, 'updatedAtMs'>) => Promise<void>;
  onDistributeSeasonPrizes: (nextDurationDays: number) => Promise<void>;
}

const ADMIN_SESSION_KEY = 'chickenland_admin_unlocked_v1';

const AD_PROVIDER_CARDS: Array<{
  id: AdProviderType;
  label: string;
  detail: string;
}> = [
  { id: 'countdown', label: 'Built-in Timer', detail: 'Zero-dependency rewarded countdown' },
  { id: 'adsgram', label: 'Adsgram SDK', detail: 'Telegram Mini App native video' },
  { id: 'monetag', label: 'Monetag Zone', detail: 'Rewarded interstitial zone SDK' },
  { id: 'custom_sponsor', label: 'Custom Sponsor', detail: 'Branded partner spotlight modal' },
];

function renderPreviewIcon(icon: string) {
  switch (icon) {
    case 'megaphone':
      return <Megaphone className="w-4 h-4 text-sky-600" />;
    case 'gift':
      return <Gift className="w-4 h-4 text-rose-500" />;
    case 'flame':
      return <Flame className="w-4 h-4 text-orange-500" />;
    case 'users':
      return <Users className="w-4 h-4 text-indigo-600" />;
    case 'send':
      return <Send className="w-4 h-4 text-sky-600" />;
    default:
      return <Link2 className="w-4 h-4 text-emerald-600" />;
  }
}

export function AdminPanelView({
  playerId,
  withdrawRequests,
  customTasks,
  adConfig,
  promoCodes,
  seasonConfig,
  leaderboardEntries,
  onBack,
  onTabTap,
  onReviewWithdrawal,
  onCreateTask,
  onToggleTask,
  onDeleteTask,
  onSaveAdConfig,
  onCreatePromoCode,
  onTogglePromoCode,
  onDeletePromoCode,
  onSaveSeasonConfig,
  onDistributeSeasonPrizes,
}: AdminPanelViewProps) {
  const [unlocked, setUnlocked] = useState(() => {
    try {
      return sessionStorage.getItem(ADMIN_SESSION_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [passcode, setPasscode] = useState('');
  const [showPasscode, setShowPasscode] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(false);

  const [tab, setTab] = useState<'withdrawals' | 'tasks' | 'ads' | 'promos' | 'season'>('withdrawals');
  const [wdFilter, setWdFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [wdSearch, setWdSearch] = useState('');
  const [noteById, setNoteById] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // New task form state
  const [taskTitle, setTaskTitle] = useState('');
  const [taskCategory, setTaskCategory] = useState<TaskDefinition['category']>('partner');
  const [taskCoins, setTaskCoins] = useState('250');
  const [taskIcon, setTaskIcon] = useState('send');
  const [taskUrl, setTaskUrl] = useState('');
  const [savingTask, setSavingTask] = useState(false);

  // Promo code form state
  const [promoCodeInput, setPromoCodeInput] = useState('');
  const [promoLabelInput, setPromoLabelInput] = useState('');
  const [promoCoinsInput, setPromoCoinsInput] = useState('350');
  const [promoMaxUsesInput, setPromoMaxUsesInput] = useState('100');
  const [promoExpiresHoursInput, setPromoExpiresHoursInput] = useState('72');
  const [savingPromo, setSavingPromo] = useState(false);

  // Season draft state
  const [seasonTitleDraft, setSeasonTitleDraft] = useState(seasonConfig.title);
  const [seasonPrizeDraft, setSeasonPrizeDraft] = useState(String(seasonConfig.prizePoolCoins));
  const [seasonDaysDraft, setSeasonDaysDraft] = useState('7');
  const [savingSeason, setSavingSeason] = useState(false);
  const [distributingPrizes, setDistributingPrizes] = useState(false);

  useEffect(() => {
    setSeasonTitleDraft(seasonConfig.title);
    setSeasonPrizeDraft(String(seasonConfig.prizePoolCoins));
  }, [seasonConfig]);

  // Ad config draft state
  const [adDraft, setAdDraft] = useState<Omit<AdConfig, 'updatedAtMs'>>(() => ({
    provider: adConfig.provider,
    adsgramBlockId: adConfig.adsgramBlockId,
    monetagZoneId: adConfig.monetagZoneId,
    customTitle: adConfig.customTitle,
    customDescription: adConfig.customDescription,
    customUrl: adConfig.customUrl,
    watchSeconds: adConfig.watchSeconds,
    bannerEnabled: adConfig.bannerEnabled,
    bannerTitle: adConfig.bannerTitle,
    bannerSubtitle: adConfig.bannerSubtitle,
    bannerCtaText: adConfig.bannerCtaText,
    bannerUrl: adConfig.bannerUrl,
  }));
  const [savingAds, setSavingAds] = useState(false);

  useEffect(() => {
    setAdDraft({
      provider: adConfig.provider,
      adsgramBlockId: adConfig.adsgramBlockId,
      monetagZoneId: adConfig.monetagZoneId,
      customTitle: adConfig.customTitle,
      customDescription: adConfig.customDescription,
      customUrl: adConfig.customUrl,
      watchSeconds: adConfig.watchSeconds,
      bannerEnabled: adConfig.bannerEnabled,
      bannerTitle: adConfig.bannerTitle,
      bannerSubtitle: adConfig.bannerSubtitle,
      bannerCtaText: adConfig.bannerCtaText,
      bannerUrl: adConfig.bannerUrl,
    });
  }, [adConfig]);

  // Allow instant unlock if playerId is in server ADMIN_TELEGRAM_IDS
  useEffect(() => {
    if (unlocked) return;
    fetch('/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId, checkOnly: true }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { ok?: boolean } | null) => {
        if (data?.ok) {
          setUnlocked(true);
          try {
            sessionStorage.setItem(ADMIN_SESSION_KEY, '1');
          } catch {
            // ignore
          }
        }
      })
      .catch(() => {
        // Require passcode
      });
  }, [playerId, unlocked]);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setCheckingAuth(true);
    try {
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode, playerId }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setAuthError(data.error || 'Incorrect admin passcode.');
        return;
      }
      onTabTap?.();
      setUnlocked(true);
      setPasscode('');
      try {
        sessionStorage.setItem(ADMIN_SESSION_KEY, '1');
      } catch {
        // ignore
      }
    } catch {
      setAuthError('Could not verify passcode with server.');
    } finally {
      setCheckingAuth(false);
    }
  };

  const handleLockSession = () => {
    onTabTap?.();
    setUnlocked(false);
    try {
      sessionStorage.removeItem(ADMIN_SESSION_KEY);
    } catch {
      // ignore
    }
  };

  const pendingRequests = useMemo(
    () => withdrawRequests.filter((r) => r.status === 'pending'),
    [withdrawRequests],
  );
  const approvedCount = useMemo(
    () => withdrawRequests.filter((r) => r.status === 'approved').length,
    [withdrawRequests],
  );
  const rejectedCount = useMemo(
    () => withdrawRequests.filter((r) => r.status === 'rejected').length,
    [withdrawRequests],
  );
  const pendingGramVolume = useMemo(
    () => pendingRequests.reduce((sum, r) => sum + (Number(r.gramAmount) || 0), 0),
    [pendingRequests],
  );
  const activeTaskCount = useMemo(
    () => customTasks.filter((t) => t.isActive !== false).length,
    [customTasks],
  );

  const visibleRequests = useMemo(() => {
    const query = wdSearch.trim().toLowerCase();
    return withdrawRequests.filter((r) => {
      if (wdFilter !== 'all' && r.status !== wdFilter) return false;
      if (!query) return true;
      return (
        r.displayName.toLowerCase().includes(query) ||
        r.handle.toLowerCase().includes(query) ||
        r.walletAddress.toLowerCase().includes(query) ||
        r.memo.toLowerCase().includes(query)
      );
    });
  }, [wdFilter, wdSearch, withdrawRequests]);

  const handleCopy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 1500);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleCreateTaskSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (taskTitle.trim().length < 2) return;
    setSavingTask(true);
    try {
      await onCreateTask({
        title: taskTitle.trim(),
        category: taskCategory,
        rewardCoins: Math.max(1, Number(taskCoins) || 50),
        icon: taskIcon,
        actionUrl: taskUrl.trim(),
      });
      setTaskTitle('');
      setTaskUrl('');
    } finally {
      setSavingTask(false);
    }
  };

  const handleSaveAdsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingAds(true);
    try {
      await onSaveAdConfig(adDraft);
    } finally {
      setSavingAds(false);
    }
  };

  const handleCreatePromoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (promoCodeInput.trim().length < 3) return;
    setSavingPromo(true);
    try {
      await onCreatePromoCode({
        code: promoCodeInput.trim().toUpperCase(),
        label: promoLabelInput.trim() || `${promoCodeInput.trim().toUpperCase()} Drop`,
        coins: Math.max(1, Number(promoCoinsInput) || 100),
        maxUses: Math.max(0, Number(promoMaxUsesInput) || 0),
        expiresInHours: Math.max(0, Number(promoExpiresHoursInput) || 0),
      });
      setPromoCodeInput('');
      setPromoLabelInput('');
    } finally {
      setSavingPromo(false);
    }
  };

  const handleSaveSeasonSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSeason(true);
    try {
      const days = Math.max(1, Math.min(90, Number(seasonDaysDraft) || 7));
      await onSaveSeasonConfig({
        seasonNumber: seasonConfig.seasonNumber,
        title: seasonTitleDraft.trim() || `Harvest Cup Season ${seasonConfig.seasonNumber}`,
        prizePoolCoins: Math.max(0, Number(seasonPrizeDraft) || 0),
        endsAtMs: Date.now() + days * 86_400_000,
        lastWinners: seasonConfig.lastWinners ?? [],
      });
    } finally {
      setSavingSeason(false);
    }
  };

  const handleDistributeClick = async () => {
    setDistributingPrizes(true);
    try {
      const days = Math.max(1, Math.min(90, Number(seasonDaysDraft) || 7));
      await onDistributeSeasonPrizes(days);
    } finally {
      setDistributingPrizes(false);
    }
  };

  if (!unlocked) {
    return (
      <div className="animate-clay-enter space-y-6 pb-8">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              onTabTap?.();
              onBack();
            }}
            aria-label="Back from admin panel"
            className="clay-btn clay-btn-neutral w-10 h-10 rounded-full flex items-center justify-center text-slate-700 dark:text-stone-200"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-xl font-extrabold text-slate-900 dark:text-stone-100 tracking-tight">Admin Console</h1>
            <p className="text-xs text-slate-500 dark:text-stone-400">Executive operations · payouts, tasks &amp; ad network</p>
          </div>
        </div>

        <form
          onSubmit={(e) => void handleUnlock(e)}
          className="clay-card overflow-hidden max-w-md mx-auto"
        >
          <div className="bg-slate-900 dark:bg-stone-950 dark:border-b dark:border-stone-800 px-5 py-4 text-white flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center shrink-0">
              <Lock className="w-5 h-5 text-amber-300" />
            </div>
            <div>
              <h2 className="text-base font-extrabold tracking-tight">Owner Verification</h2>
              <p className="text-xs text-slate-300">Server-validated console access</p>
            </div>
          </div>

          <div className="p-5 space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="admin-passcode-input" className="text-xs font-bold text-slate-700 dark:text-stone-300">
                Admin Passcode
              </label>
              <div className="relative">
                <input
                  id="admin-passcode-input"
                  type={showPasscode ? 'text' : 'password'}
                  value={passcode}
                  onChange={(e) => {
                    setPasscode(e.target.value);
                    setAuthError(null);
                  }}
                  placeholder="Enter admin passcode"
                  aria-label="Admin passcode"
                  className="clay-inset w-full min-h-[44px] pl-3.5 pr-11 text-sm font-semibold text-slate-900 dark:text-stone-100 placeholder:text-slate-400 dark:placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
                <button
                  type="button"
                  onClick={() => setShowPasscode((v) => !v)}
                  aria-label={showPasscode ? 'Hide passcode' : 'Show passcode'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-stone-200 cursor-pointer"
                >
                  {showPasscode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {authError && (
              <div
                role="alert"
                className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/70 px-3 py-2.5 text-xs font-semibold text-rose-700 dark:text-rose-300"
              >
                {authError}
              </div>
            )}

            <button
              type="submit"
              disabled={checkingAuth || !passcode.trim()}
              className="clay-btn clay-btn-emerald w-full min-h-[46px] rounded-2xl disabled:opacity-50 font-bold text-sm"
            >
              {checkingAuth ? 'Verifying...' : 'Unlock Admin Panel'}
            </button>
          </div>
        </form>
      </div>
    );
  }

  const activeProviderLabel =
    AD_PROVIDER_CARDS.find((p) => p.id === adConfig.provider)?.label || 'Built-in Timer';

  return (
    <div className="animate-clay-enter space-y-4 pb-8">
      {/* Executive Header */}
      <div className="clay-card-dark text-white px-4 py-3.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => {
              onTabTap?.();
              onBack();
            }}
            aria-label="Back from admin panel"
            className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 flex items-center justify-center text-white shrink-0 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0">
            <h1 className="text-lg font-extrabold tracking-tight truncate">Admin Console</h1>
            <p className="text-[11px] text-slate-300 truncate">
              Approve payouts, publish tasks &amp; manage ad monetization
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="hidden sm:inline-flex items-center gap-1 rounded-lg bg-emerald-500/15 border border-emerald-400/30 px-2.5 py-1 text-[11px] font-bold text-emerald-300">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Verified</span>
          </span>
          <button
            type="button"
            onClick={handleLockSession}
            title="Lock console session"
            aria-label="Lock console session"
            className="h-9 px-2.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-xs font-semibold text-slate-200 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Lock</span>
          </button>
        </div>
      </div>

      {/* 4-Column Executive KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="clay-card !rounded-2xl p-3.5">
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 dark:text-stone-400">
            <span>Pending Payouts</span>
            <Wallet className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="mt-1.5 text-xl font-extrabold text-slate-900 dark:text-stone-100 font-mono-num">
            {pendingRequests.length}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-400 dark:text-stone-500 font-mono-num">
            {withdrawRequests.length} total requests
          </div>
        </div>

        <div className="clay-card !rounded-2xl p-3.5">
          <div className="text-[11px] font-semibold text-slate-500 dark:text-stone-400">Pending Volume</div>
          <div className="mt-1.5 text-xl font-extrabold text-slate-900 dark:text-stone-100 font-mono-num truncate">
            {pendingGramVolume.toFixed(4)}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-400 dark:text-stone-500">GRAM queued</div>
        </div>

        <div className="clay-card !rounded-2xl p-3.5">
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 dark:text-stone-400">
            <span>Custom Tasks</span>
            <ListPlus className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="mt-1.5 text-xl font-extrabold text-slate-900 dark:text-stone-100 font-mono-num">
            {activeTaskCount}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-400 dark:text-stone-500 font-mono-num">
            of {customTasks.length} published
          </div>
        </div>

        <div className="clay-card !rounded-2xl p-3.5">
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 dark:text-stone-400">
            <span>Ad Network</span>
            <Megaphone className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
          </div>
          <div className="mt-1.5 text-sm font-extrabold text-slate-900 dark:text-stone-100 truncate pt-1">
            {activeProviderLabel}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-400 dark:text-stone-500 font-mono-num">
            {adConfig.watchSeconds}s timer · {adConfig.bannerEnabled ? 'Banner On' : 'Banner Off'}
          </div>
        </div>
      </div>

      {/* Section Tabs */}
      <div className="clay-inset !rounded-2xl grid grid-cols-5 gap-1 p-1.5">
        <button
          type="button"
          onClick={() => {
            onTabTap?.();
            setTab('withdrawals');
          }}
          className={`min-h-[40px] rounded-lg text-[11px] sm:text-xs font-bold flex items-center justify-center gap-1 transition-colors cursor-pointer ${
            tab === 'withdrawals'
              ? 'bg-white dark:bg-stone-900 text-slate-900 dark:text-stone-100 shadow-xs'
              : 'text-slate-600 dark:text-stone-300 hover:text-slate-900 dark:hover:text-stone-100'
          }`}
        >
          <span className="truncate">Payouts</span>
          {pendingRequests.length > 0 && (
            <span className="px-1 py-0.5 rounded bg-amber-500 text-white text-[10px] font-mono-num font-bold">
              {pendingRequests.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            onTabTap?.();
            setTab('tasks');
          }}
          className={`min-h-[40px] rounded-lg text-[11px] sm:text-xs font-bold flex items-center justify-center gap-1 transition-colors cursor-pointer ${
            tab === 'tasks'
              ? 'bg-white dark:bg-stone-900 text-slate-900 dark:text-stone-100 shadow-xs'
              : 'text-slate-600 dark:text-stone-300 hover:text-slate-900 dark:hover:text-stone-100'
          }`}
        >
          <ListPlus className="w-3.5 h-3.5 shrink-0 hidden sm:inline" />
          <span className="truncate">Tasks</span>
        </button>

        <button
          type="button"
          onClick={() => {
            onTabTap?.();
            setTab('ads');
          }}
          className={`min-h-[40px] rounded-lg text-[11px] sm:text-xs font-bold flex items-center justify-center gap-1 transition-colors cursor-pointer ${
            tab === 'ads'
              ? 'bg-white dark:bg-stone-900 text-slate-900 dark:text-stone-100 shadow-xs'
              : 'text-slate-600 dark:text-stone-300 hover:text-slate-900 dark:hover:text-stone-100'
          }`}
        >
          <Megaphone className="w-3.5 h-3.5 shrink-0 hidden sm:inline" />
          <span className="truncate">Ads</span>
        </button>

        <button
          type="button"
          onClick={() => {
            onTabTap?.();
            setTab('promos');
          }}
          className={`min-h-[40px] rounded-lg text-[11px] sm:text-xs font-bold flex items-center justify-center gap-1 transition-colors cursor-pointer ${
            tab === 'promos'
              ? 'bg-white dark:bg-stone-900 text-slate-900 dark:text-stone-100 shadow-xs'
              : 'text-slate-600 dark:text-stone-300 hover:text-slate-900 dark:hover:text-stone-100'
          }`}
        >
          <Ticket className="w-3.5 h-3.5 shrink-0 hidden sm:inline" />
          <span className="truncate">Promos ({promoCodes.length})</span>
        </button>

        <button
          type="button"
          onClick={() => {
            onTabTap?.();
            setTab('season');
          }}
          className={`min-h-[40px] rounded-lg text-[11px] sm:text-xs font-bold flex items-center justify-center gap-1 transition-colors cursor-pointer ${
            tab === 'season'
              ? 'bg-white dark:bg-stone-900 text-slate-900 dark:text-stone-100 shadow-xs'
              : 'text-slate-600 dark:text-stone-300 hover:text-slate-900 dark:hover:text-stone-100'
          }`}
        >
          <Trophy className="w-3.5 h-3.5 shrink-0 hidden sm:inline" />
          <span className="truncate">Season</span>
        </button>
      </div>

      {/* WITHDRAWALS TAB */}
      {tab === 'withdrawals' && (
        <div className="space-y-3">
          {/* Search + Status Filter Toolbar */}
          <div className="rounded-2xl bg-white dark:bg-stone-900 border border-slate-200 dark:border-stone-800 p-3 space-y-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-slate-400 dark:text-stone-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={wdSearch}
                  onChange={(e) => setWdSearch(e.target.value)}
                  placeholder="Search farmer, @handle, wallet, or memo..."
                  aria-label="Search withdrawal requests"
                  className="w-full min-h-[38px] rounded-lg bg-slate-50 dark:bg-stone-800 border border-slate-200 dark:border-stone-700 pl-8 pr-3 text-xs text-slate-900 dark:text-stone-100 placeholder:text-slate-400 dark:placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:focus:ring-emerald-500/30"
                />
              </div>

              <div className="flex items-center gap-1 bg-slate-100 dark:bg-stone-800 p-1 rounded-lg shrink-0 overflow-x-auto">
                {(
                  [
                    { id: 'pending', label: 'Pending', count: pendingRequests.length },
                    { id: 'approved', label: 'Approved', count: approvedCount },
                    { id: 'rejected', label: 'Rejected', count: rejectedCount },
                    { id: 'all', label: 'All', count: withdrawRequests.length },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onTabTap?.();
                      setWdFilter(item.id);
                    }}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors whitespace-nowrap cursor-pointer ${
                      wdFilter === item.id
                        ? 'bg-white dark:bg-stone-900 text-slate-900 dark:text-stone-100 shadow-xs'
                        : 'text-slate-600 dark:text-stone-300 hover:text-slate-900 dark:hover:text-stone-100'
                    }`}
                  >
                    {item.label} <span className="font-mono-num text-slate-400 dark:text-stone-500">{item.count}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {visibleRequests.length === 0 ? (
            <div className="rounded-2xl bg-white dark:bg-stone-900 border border-slate-200 dark:border-stone-800 p-8 text-center text-xs text-slate-500 dark:text-stone-400">
              {wdSearch.trim()
                ? 'No withdrawal requests match your search filter.'
                : wdFilter === 'pending'
                  ? 'All caught up — no pending withdrawal requests right now.'
                  : 'No withdrawal requests in this category yet.'}
            </div>
          ) : (
            <div className="space-y-2.5">
              {visibleRequests.map((req) => {
                const statusMeta = getWithdrawalStatusMeta(req.status);
                const badgeClass =
                  statusMeta.tone === 'emerald'
                    ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/70'
                    : statusMeta.tone === 'rose'
                      ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800/70'
                      : 'bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800/70';
                const isBusy = busyId === req.id;
                const tonviewerUrl = `https://tonviewer.com/${encodeURIComponent(req.walletAddress)}`;

                return (
                  <div
                    key={req.id}
                    className="rounded-2xl bg-white dark:bg-stone-900 border border-slate-200 dark:border-stone-800 p-4 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-extrabold text-slate-900 dark:text-stone-100">
                            {req.displayName}
                          </span>
                          <span className="text-xs font-semibold text-slate-500 dark:text-stone-400">{req.handle}</span>
                        </div>
                        <div className="text-[11px] text-slate-400 dark:text-stone-500 font-mono-num mt-0.5">
                          {new Date(req.createdAtMs).toLocaleString()}
                        </div>
                      </div>
                      <span
                        className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold shrink-0 ${badgeClass}`}
                      >
                        {statusMeta.label}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 rounded-xl bg-slate-50 dark:bg-stone-800/70 border border-slate-200/80 dark:border-stone-700 p-3 text-xs">
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-stone-500">
                          Payout Amount
                        </div>
                        <div className="font-mono-num font-extrabold text-slate-900 dark:text-stone-100 mt-0.5">
                          {req.gramAmount} GRAM
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-stone-400 font-mono-num">
                          ${req.usdValue.toFixed(4)} · {req.eggsAmount.toLocaleString()} eggs
                        </div>
                      </div>

                      <div className="sm:col-span-2 min-w-0 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-stone-500">
                            Destination TON Wallet
                          </span>
                          <a
                            href={tonviewerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] font-bold text-sky-600 dark:text-sky-400 hover:underline"
                          >
                            <span>Tonviewer</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono-num text-slate-800 dark:text-stone-200 truncate flex-1 bg-white dark:bg-stone-900 border border-slate-200 dark:border-stone-700 rounded-lg px-2.5 py-1.5">
                            {req.walletAddress}
                          </span>
                          <button
                            type="button"
                            onClick={() => void handleCopy(`w_${req.id}`, req.walletAddress)}
                            aria-label="Copy wallet address"
                            className="h-8 px-2.5 rounded-lg bg-white dark:bg-stone-900 border border-slate-200 dark:border-stone-700 text-slate-600 dark:text-stone-300 hover:text-slate-900 dark:hover:text-stone-100 shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold cursor-pointer"
                          >
                            {copiedKey === `w_${req.id}` ? (
                              <ClipboardCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                            <span>{copiedKey === `w_${req.id}` ? 'Copied' : 'Copy'}</span>
                          </button>
                        </div>

                        {req.memo && (
                          <div className="flex items-center justify-between gap-2 pt-0.5">
                            <span className="text-[11px] text-slate-500 dark:text-stone-400">
                              Memo:{' '}
                              <span className="font-mono-num font-bold text-slate-900 dark:text-stone-100">
                                {req.memo}
                              </span>
                            </span>
                            <button
                              type="button"
                              onClick={() => void handleCopy(`m_${req.id}`, req.memo)}
                              className="text-[11px] font-semibold text-slate-600 dark:text-stone-300 hover:text-slate-900 dark:hover:text-stone-100 cursor-pointer"
                            >
                              {copiedKey === `m_${req.id}` ? 'Memo copied' : 'Copy memo'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {req.adminNote && (
                      <div className="rounded-lg bg-slate-50 dark:bg-stone-800/70 border border-slate-200 dark:border-stone-700 px-3 py-2 text-xs text-slate-700 dark:text-stone-200 flex items-center justify-between gap-2">
                        <span>
                          <span className="font-bold text-slate-500 dark:text-stone-400">Note:</span> {req.adminNote}
                        </span>
                        {req.reviewedAtMs > 0 && (
                          <span className="text-[11px] text-slate-400 dark:text-stone-500 font-mono-num shrink-0">
                            {new Date(req.reviewedAtMs).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    )}

                    {req.status === 'pending' && (
                      <div className="space-y-2 pt-0.5">
                        <input
                          type="text"
                          value={noteById[req.id] || ''}
                          onChange={(e) =>
                            setNoteById((prev) => ({ ...prev, [req.id]: e.target.value }))
                          }
                          placeholder="Optional note or TON Tx hash"
                          aria-label={`Admin note for ${req.displayName}`}
                          className="w-full min-h-[38px] rounded-xl bg-slate-50 dark:bg-stone-800 border border-slate-200 dark:border-stone-700 px-3 text-xs text-slate-900 dark:text-stone-100 placeholder:text-slate-400 dark:placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:focus:ring-emerald-500/30"
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={async () => {
                              setBusyId(req.id);
                              try {
                                await onReviewWithdrawal(req, 'approved', noteById[req.id] || '');
                              } finally {
                                setBusyId(null);
                              }
                            }}
                            className="min-h-[40px] rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            <span>{isBusy ? 'Saving...' : 'Approve Payout'}</span>
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={async () => {
                              setBusyId(req.id);
                              try {
                                await onReviewWithdrawal(req, 'rejected', noteById[req.id] || '');
                              } finally {
                                setBusyId(null);
                              }
                            }}
                            className="min-h-[40px] rounded-xl bg-white dark:bg-rose-950/40 hover:bg-rose-50 dark:hover:bg-rose-950/70 border border-rose-200 dark:border-rose-800/70 disabled:opacity-50 text-rose-700 dark:text-rose-300 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                          >
                            <XCircle className="w-4 h-4" />
                            <span>Reject &amp; Refund</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TASKS TAB */}
      {tab === 'tasks' && (
        <div className="space-y-4">
          <form
            onSubmit={(e) => void handleCreateTaskSubmit(e)}
            className="rounded-2xl bg-white dark:bg-stone-900 border border-slate-200 dark:border-stone-800 p-4 space-y-3.5"
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-extrabold text-slate-900 dark:text-stone-100">Publish New Task</h2>
                <p className="text-[11px] text-slate-500 dark:text-stone-400">
                  Appears immediately inside the player Tasks tab
                </p>
              </div>
              <div className="w-9 h-9 rounded-xl bg-slate-50 dark:bg-stone-800 border border-slate-200 dark:border-stone-700 flex items-center justify-center shrink-0">
                {renderPreviewIcon(taskIcon)}
              </div>
            </div>

            <div className="space-y-1">
              <label htmlFor="admin-task-title" className="text-xs font-bold text-slate-600 dark:text-stone-300">
                Task Title
              </label>
              <input
                id="admin-task-title"
                type="text"
                required
                minLength={2}
                maxLength={80}
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                placeholder="Join @AIRDROP_GALAXYS Telegram"
                className="w-full min-h-[40px] rounded-xl bg-slate-50 dark:bg-stone-800 border border-slate-200 dark:border-stone-700 px-3 text-sm text-slate-900 dark:text-stone-100 placeholder:text-slate-400 dark:placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:focus:ring-emerald-500/30"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <label htmlFor="admin-task-category" className="text-xs font-bold text-slate-600 dark:text-stone-300">
                  Section
                </label>
                <select
                  id="admin-task-category"
                  value={taskCategory}
                  onChange={(e) => setTaskCategory(e.target.value as TaskDefinition['category'])}
                  className="w-full min-h-[40px] rounded-xl bg-slate-50 dark:bg-stone-800 border border-slate-200 dark:border-stone-700 px-2.5 text-xs font-semibold text-slate-900 dark:text-stone-100"
                >
                  <option value="daily">Daily</option>
                  <option value="milestone">Chicken Land</option>
                  <option value="partner">Partners</option>
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor="admin-task-reward" className="text-xs font-bold text-slate-600 dark:text-stone-300">
                  Reward Coins
                </label>
                <input
                  id="admin-task-reward"
                  type="number"
                  min={1}
                  max={1000000}
                  value={taskCoins}
                  onChange={(e) => setTaskCoins(e.target.value)}
                  className="w-full min-h-[40px] rounded-xl bg-slate-50 dark:bg-stone-800 border border-slate-200 dark:border-stone-700 px-3 text-sm font-mono-num font-bold text-slate-900 dark:text-stone-100"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="admin-task-icon" className="text-xs font-bold text-slate-600 dark:text-stone-300">
                  Icon
                </label>
                <select
                  id="admin-task-icon"
                  value={taskIcon}
                  onChange={(e) => setTaskIcon(e.target.value)}
                  className="w-full min-h-[40px] rounded-xl bg-slate-50 dark:bg-stone-800 border border-slate-200 dark:border-stone-700 px-2.5 text-xs font-semibold text-slate-900 dark:text-stone-100"
                >
                  <option value="send">Telegram</option>
                  <option value="megaphone">Channel</option>
                  <option value="gift">Gift</option>
                  <option value="flame">Hot</option>
                  <option value="link">Partner Link</option>
                  <option value="users">Community</option>
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label htmlFor="admin-task-url" className="text-xs font-bold text-slate-600 dark:text-stone-300">
                Action Link (optional)
              </label>
              <input
                id="admin-task-url"
                type="url"
                value={taskUrl}
                onChange={(e) => setTaskUrl(e.target.value)}
                placeholder="https://t.me/..."
                className="w-full min-h-[40px] rounded-xl bg-slate-50 dark:bg-stone-800 border border-slate-200 dark:border-stone-700 px-3 text-sm text-slate-900 dark:text-stone-100 placeholder:text-slate-400 dark:placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:focus:ring-emerald-500/30"
              />
            </div>

            <button
              type="submit"
              disabled={savingTask || taskTitle.trim().length < 2}
              className="w-full min-h-[42px] rounded-xl bg-slate-900 dark:bg-emerald-600 hover:bg-slate-800 dark:hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm transition-colors cursor-pointer"
            >
              {savingTask ? 'Publishing Task...' : 'Publish Task'}
            </button>
          </form>

          <div className="rounded-2xl bg-white dark:bg-stone-900 border border-slate-200 dark:border-stone-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-stone-800 flex items-center justify-between">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 dark:text-stone-400">
                Custom Task Catalog ({customTasks.length})
              </h3>
              <span className="text-[11px] font-mono-num text-slate-400 dark:text-stone-500">
                {activeTaskCount} active
              </span>
            </div>

            {customTasks.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 dark:text-stone-400">
                No custom tasks added yet. Publish one above to show it live in the Tasks tab.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-stone-800">
                {customTasks.map((task) => {
                  const active = task.isActive !== false;
                  return (
                    <div
                      key={task.id}
                      className="p-3.5 flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-xl bg-slate-50 dark:bg-stone-800 border border-slate-200 dark:border-stone-700 flex items-center justify-center shrink-0">
                          {renderPreviewIcon(task.icon)}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-slate-900 dark:text-stone-100 truncate">
                              {task.title}
                            </span>
                            {!active && (
                              <span className="px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800/70 text-[10px] font-bold text-amber-700 dark:text-amber-300 shrink-0">
                                Paused
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-stone-400 font-mono-num truncate">
                            {task.category} · +{task.rewardCoins.toLocaleString()} coins
                            {task.actionUrl ? ` · ${task.actionUrl}` : ''}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => void onToggleTask(task.id, !active)}
                          aria-label={active ? 'Pause task' : 'Resume task'}
                          className="p-2 rounded-lg bg-slate-100 dark:bg-stone-800 hover:bg-slate-200 dark:hover:bg-stone-700 text-slate-700 dark:text-stone-200 cursor-pointer"
                        >
                          {active ? (
                            <PauseCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                          ) : (
                            <PlayCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => void onDeleteTask(task.id)}
                          aria-label="Delete task"
                          className="p-2 rounded-lg bg-rose-50 dark:bg-rose-950/50 hover:bg-rose-100 dark:hover:bg-rose-950/80 text-rose-600 dark:text-rose-400 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ADS SETUP TAB */}
      {tab === 'ads' && (
        <form
          onSubmit={(e) => void handleSaveAdsSubmit(e)}
          className="rounded-2xl bg-white dark:bg-stone-900 border border-slate-200 dark:border-stone-800 p-4 space-y-4"
        >
          <div>
            <h2 className="text-sm font-extrabold text-slate-900 dark:text-stone-100">Rewarded Ad Network</h2>
            <p className="text-xs text-slate-500 dark:text-stone-400">
              Controls how players complete &ldquo;Watch X/10&rdquo; inside the Tasks tab
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="admin-ad-provider" className="text-xs font-bold text-slate-600 dark:text-stone-300">
              Active Ad Provider
            </label>
            <select
              id="admin-ad-provider"
              value={adDraft.provider}
              onChange={(e) =>
                setAdDraft((d) => ({ ...d, provider: e.target.value as AdProviderType }))
              }
              className="w-full min-h-[40px] rounded-xl bg-slate-50 dark:bg-stone-800 border border-slate-200 dark:border-stone-700 px-3 text-sm font-bold text-slate-900 dark:text-stone-100"
            >
              <option value="countdown">Built-in Rewarded Timer (Always Works)</option>
              <option value="adsgram">Adsgram (Telegram Mini App SDK)</option>
              <option value="monetag">Monetag (Rewarded Zone SDK)</option>
              <option value="custom_sponsor">Custom Sponsor Ad Modal</option>
            </select>

            <div className="grid grid-cols-2 gap-2 pt-1">
              {AD_PROVIDER_CARDS.map((card) => {
                const selected = adDraft.provider === card.id;
                return (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => {
                      onTabTap?.();
                      setAdDraft((d) => ({ ...d, provider: card.id }));
                    }}
                    className={`rounded-xl border p-2.5 text-left transition-colors cursor-pointer ${
                      selected
                        ? 'bg-slate-900 dark:bg-emerald-600 border-slate-900 dark:border-emerald-500 text-white'
                        : 'bg-slate-50 dark:bg-stone-800 border-slate-200 dark:border-stone-700 text-slate-700 dark:text-stone-200 hover:bg-slate-100 dark:hover:bg-stone-700'
                    }`}
                  >
                    <div className="text-xs font-extrabold">{card.label}</div>
                    <div
                      className={`text-[10px] mt-0.5 ${
                        selected ? 'text-slate-300 dark:text-emerald-100' : 'text-slate-500 dark:text-stone-400'
                      }`}
                    >
                      {card.detail}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {adDraft.provider === 'adsgram' && (
            <div className="space-y-1">
              <label htmlFor="admin-adsgram-id" className="text-xs font-bold text-slate-600 dark:text-stone-300">
                Adsgram Block ID
              </label>
              <input
                id="admin-adsgram-id"
                type="text"
                value={adDraft.adsgramBlockId}
                onChange={(e) => setAdDraft((d) => ({ ...d, adsgramBlockId: e.target.value }))}
                placeholder="e.g. 1234"
                className="w-full min-h-[40px] rounded-xl bg-slate-50 dark:bg-stone-800 border border-slate-200 dark:border-stone-700 px-3 text-sm font-mono-num text-slate-900 dark:text-stone-100"
              />
            </div>
          )}

          {adDraft.provider === 'monetag' && (
            <div className="space-y-1">
              <label htmlFor="admin-monetag-id" className="text-xs font-bold text-slate-600 dark:text-stone-300">
                Monetag Zone ID
              </label>
              <input
                id="admin-monetag-id"
                type="text"
                value={adDraft.monetagZoneId}
                onChange={(e) => setAdDraft((d) => ({ ...d, monetagZoneId: e.target.value }))}
                placeholder="e.g. 9012345"
                className="w-full min-h-[40px] rounded-xl bg-slate-50 dark:bg-stone-800 border border-slate-200 dark:border-stone-700 px-3 text-sm font-mono-num text-slate-900 dark:text-stone-100"
              />
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="space-y-1">
              <label htmlFor="admin-ad-title" className="text-xs font-bold text-slate-600 dark:text-stone-300">
                Sponsor / Fallback Ad Title
              </label>
              <input
                id="admin-ad-title"
                type="text"
                value={adDraft.customTitle}
                onChange={(e) => setAdDraft((d) => ({ ...d, customTitle: e.target.value }))}
                className="w-full min-h-[40px] rounded-xl bg-slate-50 dark:bg-stone-800 border border-slate-200 dark:border-stone-700 px-3 text-xs font-bold text-slate-900 dark:text-stone-100"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="admin-ad-seconds" className="text-xs font-bold text-slate-600 dark:text-stone-300">
                Watch Timer (seconds)
              </label>
              <input
                id="admin-ad-seconds"
                type="number"
                min={3}
                max={60}
                value={adDraft.watchSeconds}
                onChange={(e) =>
                  setAdDraft((d) => ({ ...d, watchSeconds: Number(e.target.value) || 5 }))
                }
                className="w-full min-h-[40px] rounded-xl bg-slate-50 dark:bg-stone-800 border border-slate-200 dark:border-stone-700 px-3 text-xs font-mono-num font-bold text-slate-900 dark:text-stone-100"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="admin-ad-desc" className="text-xs font-bold text-slate-600 dark:text-stone-300">
              Sponsor Message
            </label>
            <input
              id="admin-ad-desc"
              type="text"
              value={adDraft.customDescription}
              onChange={(e) => setAdDraft((d) => ({ ...d, customDescription: e.target.value }))}
              className="w-full min-h-[40px] rounded-xl bg-slate-50 dark:bg-stone-800 border border-slate-200 dark:border-stone-700 px-3 text-xs text-slate-900 dark:text-stone-100"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="admin-ad-url" className="text-xs font-bold text-slate-600 dark:text-stone-300">
              Sponsor Link URL
            </label>
            <input
              id="admin-ad-url"
              type="url"
              value={adDraft.customUrl}
              onChange={(e) => setAdDraft((d) => ({ ...d, customUrl: e.target.value }))}
              placeholder="https://t.me/AIRDROP_GALAXYS"
              className="w-full min-h-[40px] rounded-xl bg-slate-50 dark:bg-stone-800 border border-slate-200 dark:border-stone-700 px-3 text-xs text-slate-900 dark:text-stone-100 placeholder:text-slate-400 dark:placeholder:text-stone-500"
            />
          </div>

          <div className="pt-3 border-t border-slate-200 dark:border-stone-800 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-extrabold text-slate-900 dark:text-stone-100">Tasks Banner Ad</div>
                <div className="text-[11px] text-slate-500 dark:text-stone-400">Show a sponsor card inside Tasks tab</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={adDraft.bannerEnabled}
                aria-label="Toggle sponsor banner ad"
                onClick={() => setAdDraft((d) => ({ ...d, bannerEnabled: !d.bannerEnabled }))}
                className={`w-12 h-7 rounded-full p-1 transition-colors cursor-pointer ${
                  adDraft.bannerEnabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-stone-700'
                }`}
              >
                <span
                  className={`block w-5 h-5 rounded-full bg-white shadow transition-transform ${
                    adDraft.bannerEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {adDraft.bannerEnabled && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <input
                    type="text"
                    value={adDraft.bannerTitle}
                    onChange={(e) => setAdDraft((d) => ({ ...d, bannerTitle: e.target.value }))}
                    placeholder="Banner title"
                    aria-label="Banner title"
                    className="min-h-[40px] rounded-xl bg-slate-50 dark:bg-stone-800 border border-slate-200 dark:border-stone-700 px-3 text-xs font-bold text-slate-900 dark:text-stone-100"
                  />
                  <input
                    type="text"
                    value={adDraft.bannerCtaText}
                    onChange={(e) => setAdDraft((d) => ({ ...d, bannerCtaText: e.target.value }))}
                    placeholder="Button text (e.g. Open)"
                    aria-label="Banner button text"
                    className="min-h-[40px] rounded-xl bg-slate-50 dark:bg-stone-800 border border-slate-200 dark:border-stone-700 px-3 text-xs font-bold text-slate-900 dark:text-stone-100"
                  />
                  <input
                    type="text"
                    value={adDraft.bannerSubtitle}
                    onChange={(e) => setAdDraft((d) => ({ ...d, bannerSubtitle: e.target.value }))}
                    placeholder="Banner subtitle"
                    aria-label="Banner subtitle"
                    className="sm:col-span-2 min-h-[40px] rounded-xl bg-slate-50 dark:bg-stone-800 border border-slate-200 dark:border-stone-700 px-3 text-xs text-slate-900 dark:text-stone-100"
                  />
                  <input
                    type="url"
                    value={adDraft.bannerUrl}
                    onChange={(e) => setAdDraft((d) => ({ ...d, bannerUrl: e.target.value }))}
                    placeholder="https://t.me/..."
                    aria-label="Banner URL"
                    className="sm:col-span-2 min-h-[40px] rounded-xl bg-slate-50 dark:bg-stone-800 border border-slate-200 dark:border-stone-700 px-3 text-xs text-slate-900 dark:text-stone-100"
                  />
                </div>

                {/* Live Banner Preview */}
                <div className="rounded-xl bg-slate-50 dark:bg-stone-800/70 border border-slate-200 dark:border-stone-700 p-3 space-y-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-stone-500">
                    Live Banner Preview
                  </div>
                  <div className="rounded-2xl bg-gradient-to-r from-sky-50 via-white to-amber-50 dark:from-sky-950/60 dark:via-stone-900 dark:to-amber-950/50 border border-sky-200 dark:border-sky-800/70 p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[10px] font-extrabold uppercase tracking-wider text-sky-700 dark:text-sky-400">
                        Sponsored Ad
                      </div>
                      <div className="text-xs font-extrabold text-slate-900 dark:text-stone-100 truncate">
                        {adDraft.bannerTitle || 'Sponsor Title'}
                      </div>
                      {adDraft.bannerSubtitle && (
                        <div className="text-[11px] text-slate-500 dark:text-stone-400 truncate">
                          {adDraft.bannerSubtitle}
                        </div>
                      )}
                    </div>
                    <span className="min-h-[32px] px-3 rounded-lg bg-sky-500 text-white text-[11px] font-extrabold inline-flex items-center gap-1 shrink-0">
                      <span>{adDraft.bannerCtaText || 'Open'}</span>
                      <ExternalLink className="w-3 h-3" />
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={savingAds}
            className="w-full min-h-[44px] rounded-xl bg-slate-900 dark:bg-emerald-600 hover:bg-slate-800 dark:hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm transition-colors cursor-pointer"
          >
            {savingAds ? 'Saving Ad Settings...' : 'Save Ad Settings'}
          </button>
        </form>
      )}

      {/* PROMOS TAB */}
      {tab === 'promos' && (
        <div className="space-y-4">
          <form
            onSubmit={(e) => void handleCreatePromoSubmit(e)}
            className="rounded-2xl bg-white dark:bg-stone-900 border border-slate-200 dark:border-stone-800 p-4 space-y-3.5"
          >
            <div>
              <h2 className="text-sm font-extrabold text-slate-900 dark:text-stone-100">Create Promo Code</h2>
              <p className="text-[11px] text-slate-500 dark:text-stone-400">
                Players redeem dynamic codes live in the Tasks tab with max-use &amp; expiry enforcement
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <label htmlFor="admin-promo-code" className="text-xs font-bold text-slate-600 dark:text-stone-300">
                  Promo Code (A-Z, 0-9)
                </label>
                <input
                  id="admin-promo-code"
                  type="text"
                  required
                  minLength={3}
                  maxLength={32}
                  value={promoCodeInput}
                  onChange={(e) => setPromoCodeInput(e.target.value.toUpperCase())}
                  placeholder="SPRING500"
                  className="w-full min-h-[40px] rounded-xl bg-slate-50 dark:bg-stone-800 border border-slate-200 dark:border-stone-700 px-3 text-sm font-mono-num font-bold uppercase text-slate-900 dark:text-stone-100"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="admin-promo-label" className="text-xs font-bold text-slate-600 dark:text-stone-300">
                  Campaign Label
                </label>
                <input
                  id="admin-promo-label"
                  type="text"
                  maxLength={60}
                  value={promoLabelInput}
                  onChange={(e) => setPromoLabelInput(e.target.value)}
                  placeholder="Spring Community Drop"
                  className="w-full min-h-[40px] rounded-xl bg-slate-50 dark:bg-stone-800 border border-slate-200 dark:border-stone-700 px-3 text-sm text-slate-900 dark:text-stone-100"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <label htmlFor="admin-promo-coins" className="text-xs font-bold text-slate-600 dark:text-stone-300">
                  Coins
                </label>
                <input
                  id="admin-promo-coins"
                  type="number"
                  min={1}
                  max={1000000}
                  value={promoCoinsInput}
                  onChange={(e) => setPromoCoinsInput(e.target.value)}
                  className="w-full min-h-[40px] rounded-xl bg-slate-50 dark:bg-stone-800 border border-slate-200 dark:border-stone-700 px-3 text-sm font-mono-num font-bold text-slate-900 dark:text-stone-100"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="admin-promo-uses" className="text-xs font-bold text-slate-600 dark:text-stone-300">
                  Max Uses (0=∞)
                </label>
                <input
                  id="admin-promo-uses"
                  type="number"
                  min={0}
                  max={1000000}
                  value={promoMaxUsesInput}
                  onChange={(e) => setPromoMaxUsesInput(e.target.value)}
                  className="w-full min-h-[40px] rounded-xl bg-slate-50 dark:bg-stone-800 border border-slate-200 dark:border-stone-700 px-3 text-sm font-mono-num font-bold text-slate-900 dark:text-stone-100"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="admin-promo-hours" className="text-xs font-bold text-slate-600 dark:text-stone-300">
                  Expires (hrs)
                </label>
                <input
                  id="admin-promo-hours"
                  type="number"
                  min={0}
                  max={8760}
                  value={promoExpiresHoursInput}
                  onChange={(e) => setPromoExpiresHoursInput(e.target.value)}
                  className="w-full min-h-[40px] rounded-xl bg-slate-50 dark:bg-stone-800 border border-slate-200 dark:border-stone-700 px-3 text-sm font-mono-num font-bold text-slate-900 dark:text-stone-100"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={savingPromo || promoCodeInput.trim().length < 3}
              className="w-full min-h-[42px] rounded-xl bg-slate-900 dark:bg-emerald-600 hover:bg-slate-800 dark:hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm transition-colors cursor-pointer"
            >
              {savingPromo ? 'Publishing Promo...' : 'Publish Promo Code'}
            </button>
          </form>

          <div className="rounded-2xl bg-white dark:bg-stone-900 border border-slate-200 dark:border-stone-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-stone-800 flex items-center justify-between">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 dark:text-stone-400">
                Active &amp; Past Promos ({promoCodes.length})
              </h3>
            </div>
            {promoCodes.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 dark:text-stone-400">
                No dynamic promo codes created yet. Built-in codes (CHICKEN2026, EGGS100, WELCOME50, GRAMTON) remain active.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-stone-800">
                {promoCodes.map((p) => {
                  const expired = p.expiresAtMs > 0 && Date.now() > p.expiresAtMs;
                  const maxed = p.maxUses > 0 && p.usedCount >= p.maxUses;
                  return (
                    <div key={p.code} className="p-3.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono-num text-sm font-extrabold text-slate-900 dark:text-stone-100">
                            {p.code}
                          </span>
                          {!p.isActive && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800/70 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                              Paused
                            </span>
                          )}
                          {expired && (
                            <span className="px-1.5 py-0.5 rounded bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800/70 text-[10px] font-bold text-rose-700 dark:text-rose-300">
                              Expired
                            </span>
                          )}
                          {maxed && (
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-stone-800 text-[10px] font-bold text-slate-600 dark:text-stone-300">
                              Maxed
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-stone-400 font-mono-num truncate">
                          {p.label} · +{p.coins.toLocaleString()} coins · {p.usedCount}/{p.maxUses === 0 ? '∞' : p.maxUses} used
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => void onTogglePromoCode(p.code, !p.isActive)}
                          aria-label={p.isActive ? 'Pause promo code' : 'Resume promo code'}
                          className="p-2 rounded-lg bg-slate-100 dark:bg-stone-800 hover:bg-slate-200 dark:hover:bg-stone-700 cursor-pointer"
                        >
                          {p.isActive ? (
                            <PauseCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                          ) : (
                            <PlayCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => void onDeletePromoCode(p.code)}
                          aria-label="Delete promo code"
                          className="p-2 rounded-lg bg-rose-50 dark:bg-rose-950/50 hover:bg-rose-100 dark:hover:bg-rose-950/80 text-rose-600 dark:text-rose-400 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* SEASON TAB */}
      {tab === 'season' && (
        <div className="space-y-4">
          <form
            onSubmit={(e) => void handleSaveSeasonSubmit(e)}
            className="rounded-2xl bg-white dark:bg-stone-900 border border-slate-200 dark:border-stone-800 p-4 space-y-3.5"
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-extrabold text-slate-900 dark:text-stone-100">
                  Season #{seasonConfig.seasonNumber} Settings
                </h2>
                <p className="text-[11px] text-slate-500 dark:text-stone-400">
                  Controls live leaderboard countdown &amp; prize pool split (50% / 30% / 20% to Top 3 Buyers)
                </p>
              </div>
              <Award className="w-5 h-5 text-amber-500 shrink-0" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div className="sm:col-span-2 space-y-1">
                <label htmlFor="admin-season-title" className="text-xs font-bold text-slate-600 dark:text-stone-300">
                  Season Title
                </label>
                <input
                  id="admin-season-title"
                  type="text"
                  required
                  minLength={2}
                  maxLength={80}
                  value={seasonTitleDraft}
                  onChange={(e) => setSeasonTitleDraft(e.target.value)}
                  className="w-full min-h-[40px] rounded-xl bg-slate-50 dark:bg-stone-800 border border-slate-200 dark:border-stone-700 px-3 text-sm font-bold text-slate-900 dark:text-stone-100"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="admin-season-days" className="text-xs font-bold text-slate-600 dark:text-stone-300">
                  Reset Duration (days)
                </label>
                <input
                  id="admin-season-days"
                  type="number"
                  min={1}
                  max={90}
                  value={seasonDaysDraft}
                  onChange={(e) => setSeasonDaysDraft(e.target.value)}
                  className="w-full min-h-[40px] rounded-xl bg-slate-50 dark:bg-stone-800 border border-slate-200 dark:border-stone-700 px-3 text-sm font-mono-num font-bold text-slate-900 dark:text-stone-100"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label htmlFor="admin-season-pool" className="text-xs font-bold text-slate-600 dark:text-stone-300">
                Total Prize Pool (Coins)
              </label>
              <input
                id="admin-season-pool"
                type="number"
                min={0}
                max={10000000}
                value={seasonPrizeDraft}
                onChange={(e) => setSeasonPrizeDraft(e.target.value)}
                className="w-full min-h-[40px] rounded-xl bg-slate-50 dark:bg-stone-800 border border-slate-200 dark:border-stone-700 px-3 text-sm font-mono-num font-bold text-slate-900 dark:text-stone-100"
              />
            </div>

            <button
              type="submit"
              disabled={savingSeason}
              className="w-full min-h-[42px] rounded-xl bg-slate-900 dark:bg-emerald-600 hover:bg-slate-800 dark:hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm transition-colors cursor-pointer"
            >
              {savingSeason ? 'Saving Season...' : 'Save Season Settings'}
            </button>
          </form>

          {/* Top 3 Preview + Distribute Action */}
          <div className="rounded-2xl bg-white dark:bg-stone-900 border border-slate-200 dark:border-stone-800 p-4 space-y-3">
            <div>
              <h3 className="text-sm font-extrabold text-slate-900 dark:text-stone-100">
                Current Top 3 Leaders Preview
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-stone-400">
                Ends {new Date(seasonConfig.endsAtMs).toLocaleString()}
              </p>
            </div>

            <div className="space-y-2">
              {[...leaderboardEntries]
                .sort((a, b) => b.buyerPoints - a.buyerPoints || b.eggs - a.eggs)
                .slice(0, 3)
                .map((entry, idx) => {
                  const shares = [0.5, 0.3, 0.2];
                  const prize = Math.round(seasonConfig.prizePoolCoins * (shares[idx] ?? 0));
                  return (
                    <div
                      key={entry.uid}
                      className="rounded-xl bg-slate-50 dark:bg-stone-800/70 border border-slate-200 dark:border-stone-700 px-3 py-2 flex items-center justify-between text-xs"
                    >
                      <span className="font-bold text-slate-900 dark:text-stone-100 truncate">
                        #{idx + 1} {entry.displayName} ({entry.buyerPoints.toLocaleString()} pts)
                      </span>
                      <span className="font-mono-num font-extrabold text-emerald-700 dark:text-emerald-400 shrink-0">
                        +{prize.toLocaleString()} coins
                      </span>
                    </div>
                  );
                })}
            </div>

            <button
              type="button"
              disabled={distributingPrizes || leaderboardEntries.length === 0}
              onClick={() => void handleDistributeClick()}
              className="w-full min-h-[44px] rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-amber-950 font-extrabold text-sm transition-colors cursor-pointer"
            >
              {distributingPrizes
                ? 'Distributing Prizes...'
                : `Distribute Season #${seasonConfig.seasonNumber} Prizes & Advance to #${seasonConfig.seasonNumber + 1}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
