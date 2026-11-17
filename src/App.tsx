import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Ban,
  Check,
  CheckCircle2,
  Copy,
  Package,
  Sparkles,
  Users,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { testFirestoreConnection } from './firebase';
import {
  activateCoopFever,
  activateFeedBooster,
  AD_NETWORK_TASKS,
  ADSGRAM_BOT_JOIN_TASK,
  applyAutoHarvestIfDue,
  buyChickens,
  calculatePendingEggs,
  calculateProductionRate,
  CHICKEN_PACKS,
  claimAchievement,
  claimAdNetworkReward,
  claimAdsgramBotJoinReward,
  claimDailyStreak,
  claimGoldenEggDrop,
  claimPromoCode,
  claimReferralMilestone,
  collectEggs,
  completeTask,
  COOP_FEVER_REQUIRED_ADS,
  createDefaultProfile,
  createDefaultSeasonConfig,
  createPaidTaskOrder,
  createRefundPaidTaskOrder,
  createTopUpPaidTaskOrder,
  DEFAULT_AD_CONFIG,
  DEFAULT_ADMINS_CONFIG,
  DEFAULT_CHANNELS_CONFIG,
  DEFAULT_GET_CODE_CHANNEL_URL,
  DEFAULT_GRAM_DEPOSIT_ADDRESS,
  DEFAULT_GRAM_JETTON_MASTER,
  DEFAULT_WITHDRAW_APPROVE_TEMPLATE,
  eggsToUsd,
  executeDeposit,
  executeWithdrawal,
  extractTelegramNumericUserId,
  formatAwayDuration,
  formatChannelsHandleSummary,
  formatPromoRewardSummary,
  getActiveRequiredChannels,
  getCoopFeverProgress,
  getEffectiveAdminIds,
  isAdminPlayerId,
  isAutoHarvestDroneActive,
  purchaseAutoHarvestDrone,
  recordCompletedGateAd,
  recordCoopFeverAd,
  REFERRAL_DEPOSIT_COMMISSION_RATE,
  REFERRER_SIGNUP_BONUS_COINS,
  reinvestEggs,
  upgradeBasket,
  watchAdStep,
} from './game/economy';
import {
  getPrimaryDepositMemo,
  normalizeTxHash,
  type DetectedGramTransfer,
} from './game/tonGram';
import {
  addAdminInFirestore,
  adjustPlayerCoinsInFirestore,
  adjustPlayerReferralCountInFirestore,
  adminAddReferralRelationInFirestore,
  adminRemoveReferralRelationInFirestore,
  applyReferralCodeInFirestore,
  banPlayerInFirestore,
  commitPlayerMutation,
  createCustomTaskInFirestore,
  createPaidCustomTaskInFirestore,
  createPromoCodeInFirestore,
  deleteCustomTaskInFirestore,
  deletePromoCodeInFirestore,
  ensurePlayerInFirestore,
  fetchCustomTasksFromFirestore,
  fetchPlayerReferralsFromFirestore,
  getStoredPlayerId,
  incrementPromoCodeUseInFirestore,
  incrementTaskClaimCountInFirestore,
  loadCachedBanRecord,
  loadCachedPlayerProfile,
  refundPaidCustomTaskInFirestore,
  removeAdminInFirestore,
  resolveActivePlayerIdentity,
  reviewWithdrawalInFirestore,
  saveAdConfigInFirestore,
  saveChannelsConfigInFirestore,
  saveWithdrawApproveTemplateInFirestore,
  searchUsersInFirestore,
  subscribeToAdConfig,
  subscribeToAdminsConfig,
  subscribeToAllWithdrawRequests,
  subscribeToBannedUsers,
  subscribeToChannelsConfig,
  subscribeToCustomTasks,
  subscribeToLeaderboard,
  subscribeToPlayer,
  subscribeToPlayerBanStatus,
  subscribeToPromoCodes,
  subscribeToRecentPlayers,
  subscribeToSeasonConfig,
  subscribeToWithdrawApproveTemplate,
  toggleCustomTaskInFirestore,
  togglePromoCodeInFirestore,
  topUpPaidCustomTaskInFirestore,
  unbanPlayerInFirestore,
} from './services/farmStore';
import type {
  AdConfig,
  AdminsConfig,
  AdNetworkId,
  AutoHarvestCurrency,
  AutoHarvestDurationId,
  BannedUserRecord,
  ChannelsConfig,
  ChannelVerificationResult,
  ChickenBreedId,
  DepositOrder,
  DynamicPromoCode,
  LanguageCode,
  LeaderboardEntry,
  NavTab,
  PromoRewardType,
  ReferralRecord,
  SeasonConfig,
  SubView,
  TaskCategory,
  TaskDefinition,
  TransactionEntry,
  UserFarmProfile,
  WithdrawApproveMessageTemplate,
  WithdrawalOrder,
  WithdrawRequestRecord,
} from './types/farm';
import {
  tryRunAdNetwork,
  tryRunAdsgramTaskAd,
  tryRunExternalRewardedAd,
} from './utils/ads';
import { getStoredLanguage, setStoredLanguage, t } from './utils/i18n';
import {
  calculateMsUntilBasketFull,
  dispatchBasketFullNotification,
  getBrowserNotificationPermission,
  getStoredLastNotifiedCycle,
  isDocumentBackgrounded,
  requestBrowserNotificationPermission,
  setStoredLastNotifiedCycle,
  shouldTriggerBasketFullNotification,
} from './utils/notifications';
import {
  triggerCollectConfetti,
  triggerDepositConfetti,
  triggerGoldenEggConfetti,
  triggerRewardConfetti,
  triggerWithdrawalConfetti,
} from './utils/celebration';
import {
  type AudioSettings,
  computeMuteAllToggle,
  getStoredAudioSettings,
  isAllAudioMuted,
  playChickenCluckSound,
  playClaimSound,
  playCoinChimeSound,
  playGoldenEggSound,
  playPurchaseSuccessSound,
  playSoftTapSound,
  playTabTapSound,
  setStoredAudioSettings,
  stopAmbientMusic,
  syncAmbientMusic,
} from './utils/sound';
import {
  cacheDetectedTelegramBotConfig,
  detectBrowserTelegramBotConfig,
  getTelegramChannelUrl,
  getTelegramInitData,
  safeFetchJson,
  type TelegramBotConfig,
  triggerHapticFeedback,
} from './utils/telegram';
import { applyThemeToDocument, getStoredTheme, setStoredTheme, type ThemeMode } from './utils/theme';
import { AdminPanelView } from './components/AdminPanelView';
import { BottomNav } from './components/BottomNav';
import { ChannelCheckModal } from './components/ChannelCheckPanel';
import { DepositView } from './components/DepositView';
import { FarmMeadow } from './components/FarmMeadow';
import { FriendsView } from './components/FriendsView';
import { CoinIcon, EggIcon } from './components/GameIcons';
import { LeaderboardView } from './components/LeaderboardView';
import { PacksView } from './components/PacksView';
import { ProfileView, SettingsModal, YourFarmView } from './components/ProfileAndFarmViews';
import { OfflineIndicator } from './components/PWAControls';
import { type ModalAdActionKind, RewardedAdModal } from './components/RewardedAdModal';
import { SignUpBonusModal } from './components/SignUpBonusModal';
import { SplashScreen } from './components/SplashScreen';
import { TasksView } from './components/TasksView';
import { TopBar } from './components/TopBar';
import { WalletView } from './components/WalletView';
import { WelcomeBackModal } from './components/WelcomeBackModal';
import { WithdrawView } from './components/WithdrawView';

function getTodayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function App() {
  const [detectedIdentity, setDetectedIdentity] = useState(() => resolveActivePlayerIdentity());
  const activePlayerId = detectedIdentity.playerId || getStoredPlayerId();
  const initialSeed = useMemo(() => {
    const cached = loadCachedPlayerProfile(activePlayerId);
    if (cached) {
      return {
        profile: { ...cached, language: cached.language || getStoredLanguage(activePlayerId) },
        transactions: [] as TransactionEntry[],
      };
    }
    const seed = createDefaultProfile(
      activePlayerId,
      detectedIdentity.displayName,
      detectedIdentity.handle,
      Date.now(),
      detectedIdentity.photoUrl,
    );
    seed.profile.language = getStoredLanguage(activePlayerId);
    return seed;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [profile, setProfile] = useState<UserFarmProfile>(initialSeed.profile);
  const latestProfileRef = useRef<UserFarmProfile>(initialSeed.profile);
  const [depositAddress, setDepositAddress] = useState<string>(DEFAULT_GRAM_DEPOSIT_ADDRESS);
  const [gramJettonMaster, setGramJettonMaster] = useState<string>(DEFAULT_GRAM_JETTON_MASTER);
  const [payoutChannel, setPayoutChannel] = useState<string>('@AG_PAYOUTS');
  const [telegramBotConfig, setTelegramBotConfig] = useState<TelegramBotConfig>(() =>
    detectBrowserTelegramBotConfig(),
  );
  const [transactions, setTransactions] = useState<TransactionEntry[]>(initialSeed.transactions);
  const [referralTransactions, setReferralTransactions] = useState<TransactionEntry[]>([]);
  const [deposits, setDeposits] = useState<DepositOrder[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalOrder[]>([]);
  const [referrals, setReferrals] = useState<ReferralRecord[]>([]);
  const [customTasks, setCustomTasks] = useState<TaskDefinition[]>([]);
  const [adConfig, setAdConfig] = useState<AdConfig>(DEFAULT_AD_CONFIG);
  const [channelsConfig, setChannelsConfig] = useState<ChannelsConfig>(DEFAULT_CHANNELS_CONFIG);
  const [allWithdrawRequests, setAllWithdrawRequests] = useState<WithdrawRequestRecord[]>([]);
  const [withdrawApproveTemplate, setWithdrawApproveTemplate] =
    useState<WithdrawApproveMessageTemplate>(DEFAULT_WITHDRAW_APPROVE_TEMPLATE);
  const [promoCodes, setPromoCodes] = useState<DynamicPromoCode[]>([]);
  const [recentPlayers, setRecentPlayers] = useState<UserFarmProfile[]>([]);
  const [leaderboardEntries, setLeaderboardEntries] = useState<LeaderboardEntry[]>([]);
  const [seasonConfig, setSeasonConfig] = useState<SeasonConfig>(() => createDefaultSeasonConfig());
  const [bannedUsers, setBannedUsers] = useState<BannedUserRecord[]>([]);
  const [adminsConfig, setAdminsConfig] = useState<AdminsConfig>(DEFAULT_ADMINS_CONFIG);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [adminSessionToken, setAdminSessionToken] = useState<string>('');
  const [playerSessionToken, setPlayerSessionToken] = useState<string>('');
  const playerSessionTokenRef = useRef<string>('');
  const [adminPasscodeSource, setAdminPasscodeSource] = useState<
    'database' | 'server_file' | 'env' | 'default'
  >('default');
  const [adminPasscodeUpdatedAtMs, setAdminPasscodeUpdatedAtMs] = useState<number>(0);
  const [serverBotConfigured, setServerBotConfigured] = useState<boolean | undefined>(undefined);
  const [banRecord, setBanRecord] = useState<BannedUserRecord | null>(() =>
    loadCachedBanRecord(activePlayerId),
  );
  const [banIdCopied, setBanIdCopied] = useState(false);

  const extraAdminIds = useMemo(() => getEffectiveAdminIds(adminsConfig), [adminsConfig]);
  const isAuthorizedAdmin = isAdminPlayerId(profile.uid, extraAdminIds);
  const isBanned = Boolean(banRecord) && !isAuthorizedAdmin;
  const isBannedRef = useRef(isBanned);
  isBannedRef.current = isBanned;

  const activeRequiredChannels = useMemo(
    () => getActiveRequiredChannels(channelsConfig),
    [channelsConfig],
  );
  const channelsGateEnabled = channelsConfig.enabled && activeRequiredChannels.length > 0;
  const activeChannelsSignature = useMemo(
    () =>
      activeRequiredChannels
        .map((c) => c.handle.trim().toLowerCase())
        .sort()
        .join(','),
    [activeRequiredChannels],
  );

  const [activeTab, setActiveTab] = useState<NavTab>('farm');
  const [subView, setSubView] = useState<SubView>(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('admin') === '1') {
      return 'admin';
    }
    return 'none';
  });
  const [showSettings, setShowSettings] = useState(false);
  const [watchingAdLoading, setWatchingAdLoading] = useState(false);
  const [activeAdNetwork, setActiveAdNetwork] = useState<AdNetworkId | null>(null);
  const [activeAdAction, setActiveAdAction] = useState<
    'watch_ad' | 'ad_network' | 'adsgram_task' | null
  >(null);
  const [adModalState, setAdModalState] = useState<{
    open: boolean;
    kind: ModalAdActionKind;
    notice?: string | null;
    network?: AdNetworkId | null;
    pendingEggs?: number | null;
    promoCode?: string | null;
    promoRewardSummary?: string | null;
    chickenBreed?: ChickenBreedId | null;
    chickenQty?: number | null;
    minerCostCoins?: number | null;
    mandatory?: boolean;
  }>({
    open: false,
    kind: 'watch_ad',
    notice: null,
    network: null,
  });
  const startupAdTriggeredRef = useRef(false);
  const [audioSettings, setAudioSettings] = useState<AudioSettings>(() => getStoredAudioSettings());
  const musicEnabled = audioSettings.musicEnabled;
  const soundsEnabled = audioSettings.soundsEnabled;
  const allAudioMuted = isAllAudioMuted(audioSettings);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getStoredTheme());
  const [notificationPermission, setNotificationPermission] = useState(() =>
    getBrowserNotificationPermission(),
  );
  // Basket Full Alerts are mandatory & always enabled
  const notificationsEnabled = true;
  const lastNotifiedCollectedAtRef = useRef<number | null>(getStoredLastNotifiedCycle());
  const [toastText, setToastText] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const [showSignUpBonusModal, setShowSignUpBonusModal] = useState(false);

  const [channelVerification, setChannelVerification] = useState<ChannelVerificationResult | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem(`chickenland_channels_verified_v1_${activePlayerId}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as ChannelVerificationResult;
      if (parsed?.allJoined && Date.now() - Number(parsed.checkedAtMs || 0) < 6 * 60 * 60 * 1000) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  });
  const [checkingChannels, setCheckingChannels] = useState(false);
  const [showChannelGateModal, setShowChannelGateModal] = useState(false);
  const [pendingPromoClaimCode, setPendingPromoClaimCode] = useState<string | null>(null);
  const pendingPromoClaimCodeRef = useRef<string | null>(null);
  const lastAutoChannelCheckAtRef = useRef<number>(0);

  const skipWelcome = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('autostart') === '1';
  }, []);

  const [showSplash, setShowSplash] = useState(() => !skipWelcome);
  const handleSplashComplete = useCallback(() => {
    setShowSplash(false);
  }, []);

  const pendingRefCodeRef = useRef<string | null>(
    (() => {
      if (detectedIdentity.startParam) {
        return detectedIdentity.startParam.trim();
      }
      if (typeof window !== 'undefined') {
        const search = new URLSearchParams(window.location.search);
        const param =
          search.get('tgWebAppStartParam') ||
          search.get('startapp') ||
          search.get('start_param') ||
          search.get('ref') ||
          '';
        return param.trim() || null;
      }
      return null;
    })(),
  );
  const welcomeCheckedForPlayerRef = useRef<string | null>(null);
  const ensurePromiseRef = useRef<Promise<UserFarmProfile | void>>(Promise.resolve());
  const [isPlayerSynced, setIsPlayerSynced] = useState(false);
  const prevWithdrawalStatusRef = useRef<Map<string, string> | null>(null);
  const userSelectedLangRef = useRef<LanguageCode | null>(null);

  const toastTimerRef = useRef<number | null>(null);
  const showToast = useCallback((msg: string) => {
    setToastText(msg);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastText(null);
    }, 3400);
  }, []);

  // Tick live egg production clock every 10 seconds
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 10000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    latestProfileRef.current = profile;
  }, [profile]);

  useEffect(() => {
    applyThemeToDocument(themeMode);
  }, [themeMode]);

  const handleToggleTheme = useCallback(() => {
    playTabTapSound(soundsEnabled);
    setThemeMode((prev) => {
      const next: ThemeMode = prev === 'dark' ? 'light' : 'dark';
      setStoredTheme(next);
      return next;
    });
  }, [soundsEnabled]);

  useEffect(() => {
    if (isBanned) {
      stopAmbientMusic();
      setAdModalState({ open: false, kind: 'watch_ad', notice: null, network: null });
      setShowSettings(false);
      setShowWelcomeModal(false);
      setShowSignUpBonusModal(false);
      setShowChannelGateModal(false);
      return () => stopAmbientMusic();
    }

    syncAmbientMusic(musicEnabled);
    if (!musicEnabled) {
      return () => stopAmbientMusic();
    }

    const handleFirstGesture = () => {
      if (!isBannedRef.current && document.visibilityState !== 'hidden') {
        syncAmbientMusic(true);
      }
    };
    const handleBackgroundPause = () => {
      stopAmbientMusic();
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden' || isBannedRef.current) {
        stopAmbientMusic();
      } else {
        syncAmbientMusic(true);
      }
    };

    window.addEventListener('pointerdown', handleFirstGesture, { passive: true });
    window.addEventListener('touchend', handleFirstGesture, { passive: true });
    window.addEventListener('click', handleFirstGesture, { passive: true });
    window.addEventListener('keydown', handleFirstGesture, { passive: true });
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handleBackgroundPause);
    window.addEventListener('blur', handleBackgroundPause);
    window.addEventListener('pageshow', handleVisibility);
    window.addEventListener('focus', handleVisibility);

    return () => {
      window.removeEventListener('pointerdown', handleFirstGesture);
      window.removeEventListener('touchend', handleFirstGesture);
      window.removeEventListener('click', handleFirstGesture);
      window.removeEventListener('keydown', handleFirstGesture);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', handleBackgroundPause);
      window.removeEventListener('blur', handleBackgroundPause);
      window.removeEventListener('pageshow', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
      stopAmbientMusic();
    };
  }, [isBanned, musicEnabled]);

  useEffect(() => {
    // Re-check Telegram WebApp hydration shortly after mount in case SDK populates asynchronously
    if (detectedIdentity.isTelegramDetected) return;
    const timers = [150, 500, 1200].map((delay) =>
      window.setTimeout(() => {
        const next = resolveActivePlayerIdentity();
        if (next.startParam && !pendingRefCodeRef.current) {
          pendingRefCodeRef.current = next.startParam.trim();
        }
        if (next.isTelegramDetected && next.playerId && next.playerId !== activePlayerId) {
          setDetectedIdentity(next);
          const cached = loadCachedPlayerProfile(next.playerId);
          if (cached) {
            latestProfileRef.current = cached;
            setProfile(cached);
          }
        }
      }, delay),
    );
    return () => {
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [activePlayerId, detectedIdentity.isTelegramDetected]);

  useEffect(() => {
    if (playerSessionTokenRef.current) return;
    const initData = getTelegramInitData();
    if (!initData) return;
    void safeFetchJson<{ ok?: boolean; verified?: boolean; sessionToken?: string }>(
      '/api/auth/verify-telegram',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData }),
      },
    ).then((res) => {
      if (res?.ok && res.verified && res.sessionToken) {
        playerSessionTokenRef.current = res.sessionToken;
        setPlayerSessionToken(res.sessionToken);
      }
    });
  }, [activePlayerId, detectedIdentity.isTelegramDetected]);

  const handleToggleMuteAll = useCallback(() => {
    const next = computeMuteAllToggle(audioSettings);
    setAudioSettings(next);
    setStoredAudioSettings(next);
    syncAmbientMusic(next.musicEnabled);
    const nowMuted = isAllAudioMuted(next);
    if (!nowMuted && next.soundsEnabled) {
      playTabTapSound(true);
    }
    triggerHapticFeedback('selection');
    showToast(nowMuted ? 'All music & sound effects muted.' : 'Audio settings restored.');
  }, [audioSettings, showToast]);

  const handleToggleMusic = useCallback(() => {
    const nextMusic = !audioSettings.musicEnabled;
    syncAmbientMusic(nextMusic);
    triggerHapticFeedback('selection');
    const next: AudioSettings = {
      ...audioSettings,
      musicEnabled: nextMusic,
      preMuteMusicEnabled: nextMusic,
      preMuteSoundsEnabled: audioSettings.soundsEnabled,
    };
    setAudioSettings(next);
    setStoredAudioSettings(next);
  }, [audioSettings]);

  const handleToggleSounds = useCallback(() => {
    const nextSounds = !audioSettings.soundsEnabled;
    if (nextSounds) {
      playTabTapSound(true);
    }
    const next: AudioSettings = {
      ...audioSettings,
      soundsEnabled: nextSounds,
      preMuteMusicEnabled: audioSettings.musicEnabled,
      preMuteSoundsEnabled: nextSounds,
    };
    setAudioSettings(next);
    setStoredAudioSettings(next);
  }, [audioSettings]);

  const checkAndNotifyBasketFull = useCallback(() => {
    if (isBannedRef.current) return;
    const current = latestProfileRef.current;
    const now = Date.now();
    const pending = calculatePendingEggs(current, now);
    const perm = getBrowserNotificationPermission();
    setNotificationPermission(perm);

    const shouldNotify = shouldTriggerBasketFullNotification({
      pendingEggs: pending,
      basketCapacity: current.basketCapacity,
      lastCollectedAt: current.lastCollectedAt,
      lastNotifiedCollectedAt: lastNotifiedCollectedAtRef.current,
      isBackgrounded: isDocumentBackgrounded(),
      notificationsEnabled,
      permission: perm,
    });

    if (shouldNotify) {
      lastNotifiedCollectedAtRef.current = current.lastCollectedAt;
      setStoredLastNotifiedCycle(current.lastCollectedAt);
      dispatchBasketFullNotification({
        pendingEggs: pending,
        basketCapacity: current.basketCapacity,
        onClick: () => {
          setSubView('none');
          setActiveTab('farm');
        },
      });
    }
  }, []);

  useEffect(() => {
    checkAndNotifyBasketFull();
  }, [checkAndNotifyBasketFull, nowMs, profile]);

  useEffect(() => {
    const handleVisibilityOrFocusChange = () => {
      setNowMs(Date.now());
      checkAndNotifyBasketFull();
    };

    document.addEventListener('visibilitychange', handleVisibilityOrFocusChange);
    window.addEventListener('blur', handleVisibilityOrFocusChange);
    window.addEventListener('focus', handleVisibilityOrFocusChange);

    const ratePerHour = calculateProductionRate(profile);
    const msLeft = calculateMsUntilBasketFull({
      productionRatePerHour: ratePerHour,
      basketCapacity: profile.basketCapacity,
      lastCollectedAt: profile.lastCollectedAt,
      nowMs: Date.now(),
    });

    let timerId: number | null = null;
    if (msLeft !== null && msLeft > 0 && msLeft <= 2_147_483_647) {
      timerId = window.setTimeout(() => {
        setNowMs(Date.now());
        checkAndNotifyBasketFull();
      }, msLeft + 250);
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityOrFocusChange);
      window.removeEventListener('blur', handleVisibilityOrFocusChange);
      window.removeEventListener('focus', handleVisibilityOrFocusChange);
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, [checkAndNotifyBasketFull, profile]);

  // Mandatory basket full browser alert: request notification permission on first interaction when needed
  useEffect(() => {
    if (notificationPermission !== 'default') return;
    let asked = false;
    const askOnce = () => {
      if (asked) return;
      asked = true;
      window.removeEventListener('pointerdown', askOnce);
      void requestBrowserNotificationPermission().then(setNotificationPermission);
    };
    window.addEventListener('pointerdown', askOnce, { passive: true, once: true });
    return () => {
      window.removeEventListener('pointerdown', askOnce);
    };
  }, [notificationPermission]);

  // Verify Firestore connection, fetch server GRAM config & subscribe to live config collections
  useEffect(() => {
    testFirestoreConnection();
    void safeFetchJson<{
      gramDepositAddress?: string;
      gramJettonMaster?: string;
      payoutChannel?: string;
      telegramBotConfigured?: boolean;
      telegramBotUsername?: string;
      telegramAppShortName?: string;
      adminPasscodeSource?: 'database' | 'server_file' | 'env' | 'default';
      adminPasscodeUpdatedAtMs?: number;
    }>('/api/config').then((cfg) => {
      if (!cfg) return;
      if (cfg.gramDepositAddress) {
        setDepositAddress(cfg.gramDepositAddress);
      }
      if (cfg.gramJettonMaster) {
        setGramJettonMaster(cfg.gramJettonMaster);
      }
      if (cfg.payoutChannel) {
        setPayoutChannel(cfg.payoutChannel);
      }
      if (typeof cfg.telegramBotConfigured === 'boolean') {
        setServerBotConfigured(cfg.telegramBotConfigured);
      }
      if (cfg.adminPasscodeSource) {
        setAdminPasscodeSource(cfg.adminPasscodeSource);
      }
      if (typeof cfg.adminPasscodeUpdatedAtMs === 'number') {
        setAdminPasscodeUpdatedAtMs(cfg.adminPasscodeUpdatedAtMs);
      }
      if (cfg.telegramBotUsername || cfg.telegramAppShortName) {
        cacheDetectedTelegramBotConfig(cfg.telegramBotUsername, cfg.telegramAppShortName);
        setTelegramBotConfig(
          detectBrowserTelegramBotConfig({
            serverBotUsername: cfg.telegramBotUsername,
            serverAppShortName: cfg.telegramAppShortName,
          }),
        );
      }
    });
    const unsubTasks = subscribeToCustomTasks((items) => {
      setCustomTasks(items);
    });
    const unsubAds = subscribeToAdConfig((cfg) => {
      setAdConfig(cfg);
    });
    const unsubChannels = subscribeToChannelsConfig((cfg) => {
      setChannelsConfig(cfg);
    });
    const unsubPromos = subscribeToPromoCodes((codes) => {
      setPromoCodes(codes);
    });
    const unsubAdmins = subscribeToAdminsConfig((cfg) => {
      setAdminsConfig(cfg);
    });
    const unsubLeaderboard = subscribeToLeaderboard((entries) => {
      setLeaderboardEntries(entries);
    });
    const unsubSeason = subscribeToSeasonConfig((cfg) => {
      setSeasonConfig(cfg);
    });
    const unsubPayoutTemplate = subscribeToWithdrawApproveTemplate((tpl) => {
      setWithdrawApproveTemplate(tpl);
    });
    return () => {
      unsubTasks();
      unsubAds();
      unsubChannels();
      unsubPromos();
      unsubAdmins();
      unsubLeaderboard();
      unsubSeason();
      unsubPayoutTemplate();
    };
  }, []);

  // Always require Admin Passcode again on every fresh webapp open/resume
  useEffect(() => {
    const resetAdminLock = () => {
      setAdminUnlocked(false);
      setAdminSessionToken('');
    };
    window.addEventListener('pagehide', resetAdminLock);
    return () => window.removeEventListener('pagehide', resetAdminLock);
  }, []);

  useEffect(() => {
    setBanRecord(loadCachedBanRecord(activePlayerId));
    const unsubBan = subscribeToPlayerBanStatus(activePlayerId, (ban) => {
      setBanRecord(ban);
    });
    return () => unsubBan();
  }, [activePlayerId]);

  useEffect(() => {
    if (subView !== 'admin' || !adminUnlocked || !isAdminPlayerId(profile.uid, extraAdminIds)) {
      return;
    }
    const unsubWdReqs = subscribeToAllWithdrawRequests((items) => {
      setAllWithdrawRequests(items);
    });
    const unsubRecentPlayers = subscribeToRecentPlayers((players) => {
      setRecentPlayers(players);
    }, 50);
    const unsubBannedUsers = subscribeToBannedUsers((items) => {
      setBannedUsers(items);
    });
    return () => {
      unsubWdReqs();
      unsubRecentPlayers();
      unsubBannedUsers();
    };
  }, [adminUnlocked, extraAdminIds, profile.uid, subView]);

  // Ensure active player exists in Firestore and subscribe live to all subcollections
  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | null = null;
    let syncedSuccess = false;

    const handlePlayerCallbacks = {
      onProfile: (p: UserFarmProfile) => {
        setStoredLanguage(p.language, p.uid);
        latestProfileRef.current = p;
        setProfile(p);
        setIsPlayerSynced(true);
      },
      onTransactions: (txs: TransactionEntry[]) => setTransactions(txs),
      onReferralTransactions: (refTxs: TransactionEntry[]) => setReferralTransactions(refTxs),
      onDeposits: (deps: DepositOrder[]) => setDeposits(deps),
      onWithdrawals: (wds: WithdrawalOrder[]) => {
        const prevMap = prevWithdrawalStatusRef.current;
        const nextMap = new Map<string, string>();
        let newlyApproved = false;
        for (const w of wds) {
          nextMap.set(w.id, w.status);
          if (prevMap) {
            const prevStatus = prevMap.get(w.id);
            if (
              (prevStatus === 'pending' || prevStatus === 'processing') &&
              w.status === 'approved'
            ) {
              newlyApproved = true;
            }
          }
        }
        prevWithdrawalStatusRef.current = nextMap;
        if (newlyApproved) {
          triggerWithdrawalConfetti();
          showToast('Withdrawal approved & completed!');
        }
        setWithdrawals(wds);
      },
      onReferrals: (refs: ReferralRecord[]) => setReferrals(refs),
    };

    // Always attach live Firestore snapshot listener right away so cached & queued writes stay reactive
    const unsubPlayer = subscribeToPlayer(activePlayerId, handlePlayerCallbacks);

    const init = async (attempt = 0): Promise<void> => {
      try {
        const { profile: ensured, isNewPlayer, fromCache } = await ensurePlayerInFirestore(activePlayerId, {
          displayName: detectedIdentity.displayName,
          handle: detectedIdentity.handle,
          photoUrl: detectedIdentity.photoUrl,
          isTelegramDetected: detectedIdentity.isTelegramDetected,
        });
        if (cancelled) return;

        syncedSuccess = !fromCache;
        const resolvedProfile: UserFarmProfile =
          userSelectedLangRef.current && userSelectedLangRef.current !== ensured.language
            ? { ...ensured, language: userSelectedLangRef.current }
            : ensured;
        setStoredLanguage(resolvedProfile.language, activePlayerId);
        latestProfileRef.current = resolvedProfile;
        setProfile(resolvedProfile);
        setIsPlayerSynced(!fromCache);

        if (!skipWelcome && isNewPlayer) {
          const seenKey = `chickenland_signup_bonus_seen_${activePlayerId}`;
          let alreadySeen = false;
          try {
            alreadySeen = localStorage.getItem(seenKey) === '1';
          } catch {
            alreadySeen = false;
          }
          if (!alreadySeen) {
            setShowSignUpBonusModal(true);
          }
        }

        if (!skipWelcome && welcomeCheckedForPlayerRef.current !== activePlayerId) {
          welcomeCheckedForPlayerRef.current = activePlayerId;
          const pending = calculatePendingEggs(ensured, Date.now());
          if (pending >= 10) {
            setShowWelcomeModal(true);
          }
        }

        // Auto-link ?startapp= / ?ref= / start_param immediately, award +150 coins to referrer, and notify bot
        const refCode = pendingRefCodeRef.current;
        if (refCode && !ensured.referredBy) {
          pendingRefCodeRef.current = null;
          const refRes = await applyReferralCodeInFirestore(ensured, refCode);
          if (!cancelled && !('error' in refRes)) {
            latestProfileRef.current = refRes.profile;
            setProfile(refRes.profile);
            showToast(`+100 welcome coins! Joined via ${refRes.referrerName}'s referral!`);
            void safeFetchJson('/api/referrals/notify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                event: 'referral_joined',
                referrerUid: refRes.referrerUid,
                referredUid: refRes.profile.uid,
                referredName: refRes.profile.displayName,
                referredHandle: refRes.profile.handle,
                rewardCoins: refRes.coinsRewarded,
                initData: getTelegramInitData(),
                token: playerSessionTokenRef.current,
              }),
            });
            if (typeof window !== 'undefined') {
              const url = new URL(window.location.href);
              url.searchParams.delete('ref');
              url.searchParams.delete('startapp');
              url.searchParams.delete('tgWebAppStartParam');
              window.history.replaceState({}, '', url.toString());
            }
          }
        }

        if (fromCache && attempt < 3 && !cancelled) {
          retryTimer = window.setTimeout(() => {
            if (!cancelled) {
              ensurePromiseRef.current = init(attempt + 1);
            }
          }, 1500 * Math.pow(2, attempt));
        }
      } catch {
        if (cancelled) return;
        const cached = loadCachedPlayerProfile(activePlayerId);
        if (cached) {
          latestProfileRef.current = cached;
          setProfile(cached);
        }
        if (attempt < 3) {
          retryTimer = window.setTimeout(() => {
            if (!cancelled) {
              ensurePromiseRef.current = init(attempt + 1);
            }
          }, 1200 * Math.pow(2, attempt));
        } else {
          showToast('Using saved local farm data while reconnecting to cloud.');
        }
      }
    };

    const handleOnlineRetry = () => {
      if (!cancelled && !syncedSuccess) {
        ensurePromiseRef.current = init(0);
      }
    };
    window.addEventListener('online', handleOnlineRetry);

    ensurePromiseRef.current = init(0);

    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      window.removeEventListener('online', handleOnlineRetry);
      unsubPlayer();
    };
  }, [
    activePlayerId,
    detectedIdentity.displayName,
    detectedIdentity.handle,
    detectedIdentity.isTelegramDetected,
    detectedIdentity.photoUrl,
    showToast,
    skipWelcome,
  ]);

  const persistMutation = useCallback(
    async (params: {
      nextProfile: UserFarmProfile;
      transaction?: TransactionEntry;
      deposit?: DepositOrder;
      withdrawal?: WithdrawalOrder;
      referrerCommissionCoins?: number;
      referralEggCommission?: number;
      activateReferral?: boolean;
    }): Promise<boolean> => {
      if (isBannedRef.current) {
        showToast('Account blocked — actions are disabled.');
        return false;
      }
      if (!params.deposit) {
        latestProfileRef.current = params.nextProfile;
        setProfile(params.nextProfile);
        if (params.transaction) {
          setTransactions((prev) => [params.transaction!, ...prev].slice(0, 60));
        }
        if (params.withdrawal) {
          setWithdrawals((prev) => [params.withdrawal!, ...prev].slice(0, 40));
        }
      }

      try {
        await ensurePromiseRef.current;
        const applied = await commitPlayerMutation({
          profile: params.nextProfile,
          transaction: params.transaction,
          deposit: params.deposit,
          withdrawal: params.withdrawal,
          referrerCommissionCoins: params.referrerCommissionCoins,
          referralEggCommission: params.referralEggCommission,
          activateReferral: params.activateReferral,
        });
        if (params.deposit && applied) {
          latestProfileRef.current = params.nextProfile;
          setProfile(params.nextProfile);
          if (params.transaction) {
            setTransactions((prev) => [params.transaction!, ...prev].slice(0, 60));
          }
          setDeposits((prev) => [params.deposit!, ...prev].slice(0, 40));
        }
        return applied;
      } catch {
        showToast('Database sync failed — please check connection');
        return false;
      }
    },
    [showToast],
  );

  const executeClaimPromo = useCallback(
    (code: string, countCompletedAd = false) => {
      const now = Date.now();
      const current = latestProfileRef.current;
      const res = claimPromoCode(current, code, now, promoCodes);
      if ('error' in res) {
        showToast(res.error);
        return;
      }
      const nextProfile = countCompletedAd ? recordCompletedGateAd(res.profile) : res.profile;
      playClaimSound(soundsEnabled);
      triggerHapticFeedback('success');
      triggerRewardConfetti();
      void persistMutation({
        nextProfile,
        transaction: res.transaction,
      });
      if (res.dynamicPromoCode) {
        void incrementPromoCodeUseInFirestore(res.dynamicPromoCode).catch(() => {});
      }
      showToast(`Gift claimed: ${res.rewardSummary} (${res.label})!`);
    },
    [persistMutation, promoCodes, showToast, soundsEnabled],
  );

  const handleCheckChannels = useCallback(
    async (opts?: { silent?: boolean }): Promise<ChannelVerificationResult | null> => {
      if (!channelsGateEnabled) {
        const disabledResult: ChannelVerificationResult = {
          ok: true,
          allJoined: true,
          verificationMode: 'disabled',
          telegramUserId: null,
          channels: [],
          checkedAtMs: Date.now(),
        };
        setChannelVerification(disabledResult);
        setShowChannelGateModal(false);
        const pendingCode = pendingPromoClaimCodeRef.current;
        if (pendingCode) {
          pendingPromoClaimCodeRef.current = null;
          setPendingPromoClaimCode(null);
          executeClaimPromo(pendingCode, false);
        }
        return disabledResult;
      }

      setCheckingChannels(true);
      try {
        const res = await fetch('/api/telegram/check-channels', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            playerId: latestProfileRef.current.uid,
            initData: getTelegramInitData(),
            token: playerSessionTokenRef.current,
            requiredChannels: activeRequiredChannels,
          }),
        });
        const rawPayload = (await res.json().catch(() => null)) as
          | (ChannelVerificationResult & { error?: string })
          | null;

        if (!res.ok || !rawPayload) {
          if (!opts?.silent) {
            showToast(rawPayload?.error || 'Could not verify channels right now. Please retry.');
          }
          return null;
        }
        const data: ChannelVerificationResult = rawPayload;
        setChannelVerification(data);

        if (data.verificationMode === 'disabled') {
          setShowChannelGateModal(false);
          const pendingCode = pendingPromoClaimCodeRef.current;
          if (pendingCode) {
            pendingPromoClaimCodeRef.current = null;
            setPendingPromoClaimCode(null);
            executeClaimPromo(pendingCode, false);
          }
          return data;
        }

        if (data.verificationMode === 'telegram_bot') {
          if (data.allJoined) {
            try {
              localStorage.setItem(
                `chickenland_channels_verified_v1_${latestProfileRef.current.uid}`,
                JSON.stringify(data),
              );
            } catch {
              // ignore storage errors
            }
            setShowChannelGateModal(false);
            const pendingCode = pendingPromoClaimCodeRef.current;
            if (pendingCode) {
              pendingPromoClaimCodeRef.current = null;
              setPendingPromoClaimCode(null);
              executeClaimPromo(pendingCode, false);
            } else if (!opts?.silent) {
              playClaimSound(soundsEnabled);
              triggerHapticFeedback('success');
              showToast(`Verified! Joined ${formatChannelsHandleSummary(activeRequiredChannels)}.`);
            }
          } else {
            try {
              localStorage.removeItem(
                `chickenland_channels_verified_v1_${latestProfileRef.current.uid}`,
              );
            } catch {
              // ignore storage errors
            }
            const apiErrorCh = data.channels.find(
              (c) => !c.joined && (c.status === 'api_error' || c.status === 'network_error') && c.error,
            );
            const missing = data.channels
              .filter((c) => !c.joined)
              .map((c) => c.handle)
              .join(' & ');
            if (!opts?.silent) {
              triggerHapticFeedback('warning');
              if (apiErrorCh) {
                showToast(`${apiErrorCh.handle}: ${apiErrorCh.error}`);
              } else {
                showToast(`Join required: ${missing || formatChannelsHandleSummary(activeRequiredChannels)}`);
              }
            }
          }
        } else if (!opts?.silent) {
          if (data.verificationMode === 'guest_browser') {
            triggerHapticFeedback('warning');
            showToast('Open this Mini App inside your Telegram Bot to verify your membership.');
          } else {
            showToast('Bot verification pending TELEGRAM_BOT_TOKEN on server.');
          }
        }

        return data;
      } catch {
        if (!opts?.silent) {
          showToast('Network error while checking Telegram channels.');
        }
        return null;
      } finally {
        setCheckingChannels(false);
      }
    },
    [activeRequiredChannels, channelsGateEnabled, executeClaimPromo, showToast, soundsEnabled],
  );

  const handleVerifyTaskChannel = useCallback(
    async (actionUrl: string): Promise<{ joined: boolean; handle?: string }> => {
      if (!actionUrl || !extractTelegramNumericUserId(latestProfileRef.current.uid)) {
        return { joined: true };
      }
      try {
        const res = await fetch('/api/telegram/check-task-channel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            playerId: latestProfileRef.current.uid,
            initData: getTelegramInitData(),
            token: playerSessionTokenRef.current,
            actionUrl,
          }),
        });
        const data = (await res.json().catch(() => null)) as {
          ok?: boolean;
          enforced?: boolean;
          joined?: boolean;
          handle?: string;
        } | null;
        if (res.ok && data?.ok && data.enforced && !data.joined) {
          triggerHapticFeedback('warning');
          showToast(`Join ${data.handle || 'the channel'} first to claim this task!`);
          return { joined: false, handle: data.handle };
        }
      } catch {
        // Non-blocking on transient network issues
      }
      return { joined: true };
    },
    [showToast],
  );

  useEffect(() => {
    if (!channelsGateEnabled) {
      setShowChannelGateModal(false);
      const pendingCode = pendingPromoClaimCodeRef.current;
      if (pendingCode) {
        pendingPromoClaimCodeRef.current = null;
        setPendingPromoClaimCode(null);
        executeClaimPromo(pendingCode, false);
      }
      return;
    }

    // Invalidate stale cached verification if required channels changed
    setChannelVerification((prev) => {
      if (!prev || prev.verificationMode !== 'telegram_bot') return prev;
      const prevSig = (prev.channels || [])
        .map((c) => c.handle.trim().toLowerCase())
        .sort()
        .join(',');
      if (prevSig !== activeChannelsSignature) {
        return null;
      }
      return prev;
    });
  }, [activeChannelsSignature, channelsGateEnabled, executeClaimPromo]);

  // Automatically check membership on startup, when opening Tasks/Withdraw, and on foreground return
  useEffect(() => {
    if (!channelsGateEnabled) return;
    const numericId = extractTelegramNumericUserId(profile.uid);
    if (!numericId) return;

    const shouldAutoVerify =
      activeTab === 'tasks' || subView === 'withdraw' || showChannelGateModal || !channelVerification;
    if (!shouldAutoVerify) return;

    const currentSig = (channelVerification?.channels || [])
      .map((c) => c.handle.trim().toLowerCase())
      .sort()
      .join(',');
    const freshVerifiedForCurrent =
      channelVerification?.verificationMode === 'telegram_bot' &&
      channelVerification.allJoined &&
      currentSig === activeChannelsSignature &&
      Date.now() - Number(channelVerification.checkedAtMs || 0) < 60_000;

    if (!freshVerifiedForCurrent && Date.now() - lastAutoChannelCheckAtRef.current >= 4000) {
      lastAutoChannelCheckAtRef.current = Date.now();
      void handleCheckChannels({ silent: true });
    }

    const handleReturnRefresh = () => {
      if (document.visibilityState !== 'visible') return;
      if (activeTab !== 'tasks' && subView !== 'withdraw' && !showChannelGateModal) return;
      if (Date.now() - lastAutoChannelCheckAtRef.current >= 3000) {
        lastAutoChannelCheckAtRef.current = Date.now();
        void handleCheckChannels({ silent: true });
      }
    };
    document.addEventListener('visibilitychange', handleReturnRefresh);
    window.addEventListener('focus', handleReturnRefresh);
    return () => {
      document.removeEventListener('visibilitychange', handleReturnRefresh);
      window.removeEventListener('focus', handleReturnRefresh);
    };
  }, [
    activeChannelsSignature,
    activeTab,
    channelVerification,
    channelsGateEnabled,
    handleCheckChannels,
    profile.uid,
    showChannelGateModal,
    subView,
  ]);

  const pendingEggs = useMemo(
    () => calculatePendingEggs(profile, nowMs),
    [profile, nowMs],
  );

  const mergedReferralTransactions = useMemo(() => {
    const byId = new Map<string, TransactionEntry>();
    for (const tx of transactions) {
      byId.set(tx.id, tx);
    }
    for (const tx of referralTransactions) {
      byId.set(tx.id, tx);
    }
    return Array.from(byId.values());
  }, [referralTransactions, transactions]);

  const todayStr = getTodayDateString();
  const hasClaimableTasks = profile.lastDailyClaimDate !== todayStr;
  const strings = t(profile.language);

  const executeCollectEggs = useCallback(
    (countCompletedAd = false) => {
      const now = Date.now();
      const current = latestProfileRef.current;
      const pending = calculatePendingEggs(current, now);
      const res = collectEggs(current, now, pending);
      if ('error' in res) {
        showToast(res.error);
        return;
      }
      const nextProfile = countCompletedAd ? recordCompletedGateAd(res.profile) : res.profile;
      playClaimSound(soundsEnabled);
      triggerHapticFeedback('success');
      triggerCollectConfetti();
      setShowWelcomeModal(false);
      setNowMs(now);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('alphagram:coin-arrival'));
      }
      void persistMutation({
        nextProfile,
        transaction: res.transaction,
        referralEggCommission: res.referralEggCommission,
      });
      showToast(`+${res.collected.toLocaleString()} eggs collected`);
    },
    [persistMutation, showToast, soundsEnabled],
  );

  const handleCollectEggs = () => {
    if (watchingAdLoading) return;
    const now = Date.now();
    const current = latestProfileRef.current;
    const pending = calculatePendingEggs(current, now);
    const precheck = collectEggs(current, now, pending);
    if ('error' in precheck) {
      showToast(precheck.error);
      return;
    }

    void (async () => {
      setWatchingAdLoading(true);
      setActiveAdNetwork(null);
      try {
        const external = await tryRunExternalRewardedAd(adConfig);
        if (external.handled) {
          if (external.rewarded) {
            executeCollectEggs(true);
          } else {
            showToast('Complete the ad to collect your eggs.');
          }
          return;
        }
        setAdModalState({
          open: true,
          kind: 'collect_eggs',
          pendingEggs: pending,
          notice: external.message ?? null,
          network: null,
          mandatory: false,
        });
      } finally {
        setWatchingAdLoading(false);
      }
    })();
  };

  const executeBuyChickens = useCallback(
    async (breed: ChickenBreedId, qty: number, countCompletedAd = false) => {
      const current = latestProfileRef.current;
      const now = Date.now();
      const res = buyChickens(current, breed, qty, now);
      if ('error' in res) {
        showToast(res.error);
        return;
      }
      const nextProfile = countCompletedAd ? recordCompletedGateAd(res.profile) : res.profile;
      playCoinChimeSound(soundsEnabled);
      triggerHapticFeedback('medium');
      triggerRewardConfetti();
      await persistMutation({
        nextProfile,
        transaction: res.transaction,
        activateReferral: res.shouldActivateReferral,
      });
      if (res.shouldActivateReferral) {
        showToast(`Purchased ${qty} chicken${qty > 1 ? 's' : ''} & activated referral reward!`);
      } else {
        showToast(`Purchased ${qty} chicken${qty > 1 ? 's' : ''}!`);
      }
    },
    [persistMutation, showToast, soundsEnabled],
  );

  const handleBuyChickens = async (breed: ChickenBreedId, qty: number) => {
    if (watchingAdLoading) return;
    await ensurePromiseRef.current;
    const current = latestProfileRef.current;
    const now = Date.now();
    const precheck = buyChickens(current, breed, qty, now);
    if ('error' in precheck) {
      showToast(precheck.error);
      return;
    }

    const pack = CHICKEN_PACKS.find((p) => p.id === breed);
    const costCoins = (pack?.coinCost ?? 0) * qty;

    setWatchingAdLoading(true);
    setActiveAdNetwork(null);
    try {
      const external = await tryRunExternalRewardedAd(adConfig);
      if (external.handled) {
        if (external.rewarded) {
          await executeBuyChickens(breed, qty, true);
        } else {
          showToast('Complete the ad to buy this miner.');
        }
        return;
      }
      setAdModalState({
        open: true,
        kind: 'buy_chicken',
        chickenBreed: breed,
        chickenQty: qty,
        minerCostCoins: costCoins,
        notice: external.message ?? null,
        network: null,
        mandatory: false,
      });
    } finally {
      setWatchingAdLoading(false);
    }
  };

  const handleAutoCreditGramDeposit = useCallback(
    async (transfer: DetectedGramTransfer): Promise<boolean> => {
      const targetNorm = normalizeTxHash(transfer.txHash);
      const alreadyExists = deposits.some((d) => {
        if (!d.txHash) return false;
        return (
          d.txHash.toLowerCase() === transfer.txHash.toLowerCase() ||
          (Boolean(targetNorm) && normalizeTxHash(d.txHash) === targetNorm)
        );
      });
      if (alreadyExists) return false;

      const current = latestProfileRef.current;
      const res = executeDeposit(
        current,
        transfer.coinsToCredit,
        'GRAM_TON',
        transfer.timestampMs || Date.now(),
        transfer.txHash,
        transfer.gramAmount,
        depositAddress,
      );
      if ('error' in res) {
        showToast(res.error);
        return false;
      }
      const applied = await persistMutation({
        nextProfile: res.profile,
        deposit: res.deposit,
        transaction: res.transaction,
        referrerCommissionCoins: res.referrerCommissionCoins,
      });
      if (!applied) return false;
      if (res.referrerCommissionCoins > 0 && current.referredBy) {
        void safeFetchJson('/api/referrals/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'deposit_commission',
            referrerUid: current.referredBy,
            referredUid: current.uid,
            referredName: current.displayName,
            referredHandle: current.handle,
            rewardCoins: res.referrerCommissionCoins,
            depositGram: res.deposit.cryptoAmount,
            depositUsd: res.deposit.usdAmount,
            initData: getTelegramInitData(),
            token: playerSessionTokenRef.current,
          }),
        });
      }
      playCoinChimeSound(soundsEnabled);
      triggerHapticFeedback('success');
      triggerDepositConfetti();
      showToast(`+${res.deposit.coinsAmount.toLocaleString()} coins credited from ${res.deposit.cryptoAmount}!`);
      return true;
    },
    [depositAddress, deposits, persistMutation, showToast, soundsEnabled],
  );

  const handleReinvest = (eggsAmount: number) => {
    const now = Date.now();
    const res = reinvestEggs(profile, eggsAmount, now);
    if ('error' in res) {
      showToast(res.error);
      return;
    }
    playCoinChimeSound(soundsEnabled);
    triggerHapticFeedback('medium');
    void persistMutation({
      nextProfile: res.profile,
      transaction: res.transaction,
    });
    showToast(`Reinvested into +${res.coinsReceived.toLocaleString()} coins (+20%)!`);
  };

  const handleConfirmWithdraw = async (eggsAmount: number, walletAddress: string, memo: string) => {
    const now = Date.now();
    const res = executeWithdrawal(profile, eggsAmount, walletAddress, memo, now);
    if ('error' in res) {
      showToast(res.error);
      return;
    }
    playCoinChimeSound(soundsEnabled);
    triggerHapticFeedback('success');
    await persistMutation({
      nextProfile: res.profile,
      withdrawal: res.withdrawal,
      transaction: res.transaction,
    });
    triggerWithdrawalConfetti();

    await safeFetchJson('/api/withdraw/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        withdrawalId: res.withdrawal.id.replace(/[^a-zA-Z0-9_-]/g, '_'),
        initData: getTelegramInitData(),
        token: playerSessionTokenRef.current,
        displayName: profile.displayName,
        handle: profile.handle,
        playerId: profile.uid,
        eggsAmount: res.withdrawal.eggsAmount,
        gramAmount: res.withdrawal.gramAmount,
        usdValue: res.withdrawal.usdValue,
        walletAddress: res.withdrawal.walletAddress,
        memo: res.withdrawal.memo,
        status: 'pending',
      }),
    });
    showToast(`Withdrawal submitted (${res.withdrawal.gramAmount} GRAM) — Pending Admin approval`);
  };

  const handleReviewWithdrawal = async (
    request: WithdrawRequestRecord,
    decision: 'approved' | 'rejected',
    adminNote: string,
  ) => {
    try {
      await reviewWithdrawalInFirestore({ request, decision, adminNote });
      const notifyRes = await safeFetchJson<{
        ok?: boolean;
        sent?: boolean;
        userDmSent?: boolean;
        userDmReason?: string;
      }>('/api/withdraw/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          withdrawalId: request.id,
          initData: getTelegramInitData(),
          token: adminSessionToken,
          displayName: request.displayName,
          handle: request.handle,
          playerId: request.userId,
          eggsAmount: request.eggsAmount,
          gramAmount: request.gramAmount,
          usdValue: request.usdValue,
          walletAddress: request.walletAddress,
          memo: request.memo,
          status: decision,
          adminNote,
        }),
      });
      if (decision === 'approved') {
        showToast(
          notifyRes?.userDmSent
            ? `Approved ${request.gramAmount} GRAM & sent DM to ${request.displayName}!`
            : `Approved ${request.gramAmount} GRAM for ${request.displayName}!`,
        );
      } else {
        showToast(
          notifyRes?.userDmSent
            ? `Rejected, refunded ${request.eggsAmount.toLocaleString()} eggs & notified user!`
            : `Rejected request & refunded ${request.eggsAmount.toLocaleString()} eggs.`,
        );
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to review withdrawal.');
    }
  };

  const handleCreateCustomTask = async (input: {
    title: string;
    subtitle?: string;
    category: TaskCategory;
    rewardCoins: number;
    icon: string;
    actionUrl: string;
    totalSlots?: number;
  }) => {
    try {
      await createCustomTaskInFirestore(input);
      showToast(`Added task "${input.title}"!`);
    } catch {
      showToast('Failed to add custom task.');
    }
  };

  const handleCreatePaidUserTask = async (input: {
    title: string;
    subtitle?: string;
    category: TaskCategory;
    rewardCoins: number;
    icon: string;
    actionUrl: string;
    totalSlots: number;
  }): Promise<boolean> => {
    await ensurePromiseRef.current;
    const current = latestProfileRef.current;
    const now = Date.now();
    const order = createPaidTaskOrder(current, input, now);
    if ('error' in order) {
      showToast(order.error);
      return false;
    }

    try {
      const committed = await createPaidCustomTaskInFirestore({
        profile: order.profile,
        transaction: order.transaction,
        paidCoins: order.cost.totalCostCoins,
        taskInput: {
          title: input.title,
          subtitle: input.subtitle,
          category: input.category,
          rewardCoins: order.cost.rewardCoins,
          icon: input.icon,
          actionUrl: input.actionUrl,
          totalSlots: order.cost.totalSlots,
        },
      });
      if ('error' in committed) {
        showToast(committed.error);
        return false;
      }

      latestProfileRef.current = committed.profile;
      setProfile(committed.profile);
      setCustomTasks((prev) => [committed.task, ...prev.filter((t) => t.id !== committed.task.id)]);
      setTransactions((prev) => [order.transaction, ...prev].slice(0, 60));
      playCoinChimeSound(soundsEnabled);
      triggerHapticFeedback('success');
      showToast(`Task live in Sponsors! -${order.cost.totalCostCoins.toLocaleString()} coins`);
      return true;
    } catch {
      showToast('Failed to publish paid task.');
      return false;
    }
  };

  const handleRefreshTasks = useCallback(
    async (silent = false): Promise<boolean> => {
      try {
        const items = await fetchCustomTasksFromFirestore();
        setCustomTasks(items);
        if (!silent) {
          playSoftTapSound(soundsEnabled);
          triggerHapticFeedback('light');
          showToast('Task slots refreshed');
        }
        return true;
      } catch {
        if (!silent) {
          showToast('Could not refresh tasks — please retry');
        }
        return false;
      }
    },
    [showToast, soundsEnabled],
  );

  const handleTopUpTask = async (taskId: string, budgetCoins: number): Promise<boolean> => {
    await ensurePromiseRef.current;
    const current = latestProfileRef.current;
    const task = customTasks.find((t) => t.id === taskId);
    if (!task) {
      showToast('Campaign task not found.');
      return false;
    }
    const order = createTopUpPaidTaskOrder(current, task, budgetCoins, Date.now());
    if ('error' in order) {
      showToast(order.error);
      return false;
    }
    try {
      const committed = await topUpPaidCustomTaskInFirestore({
        profile: order.profile,
        taskId,
        addedSlots: order.preview.additionalSlots,
        addedPaidCoins: order.preview.totalCostCoins,
        transaction: order.transaction,
      });
      if ('error' in committed) {
        showToast(committed.error);
        return false;
      }
      latestProfileRef.current = committed.profile;
      setProfile(committed.profile);
      setCustomTasks((prev) => prev.map((t) => (t.id === taskId ? committed.task : t)));
      setTransactions((prev) => [order.transaction, ...prev].slice(0, 60));
      playCoinChimeSound(soundsEnabled);
      triggerHapticFeedback('success');
      showToast(
        `+${order.preview.additionalSlots} slots added (-${order.preview.totalCostCoins.toLocaleString()} coins)`,
      );
      return true;
    } catch {
      showToast('Failed to top up campaign.');
      return false;
    }
  };

  const handleRefundTask = async (taskId: string): Promise<boolean> => {
    await ensurePromiseRef.current;
    const current = latestProfileRef.current;
    const task = customTasks.find((t) => t.id === taskId);
    if (!task) {
      showToast('Campaign task not found.');
      return false;
    }
    const order = createRefundPaidTaskOrder(current, task, Date.now());
    if ('error' in order) {
      showToast(order.error);
      return false;
    }
    try {
      const committed = await refundPaidCustomTaskInFirestore({
        profile: order.profile,
        taskId,
        transaction: order.transaction,
      });
      if ('error' in committed) {
        showToast(committed.error);
        return false;
      }
      latestProfileRef.current = committed.profile;
      setProfile(committed.profile);
      setCustomTasks((prev) => prev.map((t) => (t.id === taskId ? committed.task : t)));
      setTransactions((prev) => [order.transaction, ...prev].slice(0, 60));
      playClaimSound(soundsEnabled);
      triggerHapticFeedback('success');
      showToast(`Refunded +${committed.refundCoins.toLocaleString()} unused coins!`);
      return true;
    } catch {
      showToast('Failed to refund unused campaign slots.');
      return false;
    }
  };

  const handleToggleCustomTask = async (taskId: string, isActive: boolean) => {
    try {
      await toggleCustomTaskInFirestore(taskId, isActive);
      showToast(isActive ? 'Task activated!' : 'Task paused.');
    } catch {
      showToast('Failed to update task.');
    }
  };

  const handleDeleteCustomTask = async (taskId: string) => {
    try {
      await deleteCustomTaskInFirestore(taskId);
      showToast('Task deleted.');
    } catch {
      showToast('Failed to delete task.');
    }
  };

  const scheduleAppReload = useCallback(() => {
    window.setTimeout(() => {
      window.location.reload();
    }, 900);
  }, []);

  const handleSaveAdConfig = async (cfg: Omit<AdConfig, 'updatedAtMs'>): Promise<boolean> => {
    try {
      const saved = await saveAdConfigInFirestore(cfg);
      setAdConfig(saved);
      playClaimSound(soundsEnabled);
      triggerHapticFeedback('success');
      showToast('Ad settings saved to database! Reloading...');
      scheduleAppReload();
      return true;
    } catch {
      showToast('Failed to save ad settings to database.');
      return false;
    }
  };

  const handleSaveChannelsConfig = async (
    cfg: Omit<ChannelsConfig, 'updatedAtMs'>,
  ): Promise<boolean> => {
    try {
      const saved = await saveChannelsConfigInFirestore(cfg);
      setChannelsConfig(saved);
      playClaimSound(soundsEnabled);
      triggerHapticFeedback('success');
      showToast('Channel settings saved to database! Reloading...');
      scheduleAppReload();
      return true;
    } catch {
      showToast('Failed to save channel settings to database.');
      return false;
    }
  };

  const handleCreatePromoCode = async (input: {
    code: string;
    label: string;
    coins: number;
    rewardType?: PromoRewardType;
    eggs?: number;
    chickenBreed?: ChickenBreedId;
    chickenQty?: number;
    maxUses: number;
    expiresInHours: number;
  }): Promise<DynamicPromoCode | null> => {
    try {
      const created = await createPromoCodeInFirestore(input);
      showToast(`Gift code ${created.code} ready (${formatPromoRewardSummary(created)})!`);
      return created;
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create gift code.');
      return null;
    }
  };

  const handleTogglePromoCode = async (code: string, isActive: boolean) => {
    try {
      await togglePromoCodeInFirestore(code, isActive);
      showToast(isActive ? `Promo ${code} activated!` : `Promo ${code} paused.`);
    } catch {
      showToast('Failed to update promo code.');
    }
  };

  const handleDeletePromoCode = async (code: string) => {
    try {
      await deletePromoCodeInFirestore(code);
      showToast(`Promo ${code} deleted.`);
    } catch {
      showToast('Failed to delete promo code.');
    }
  };

  const handleVerifyAdminPasscode = async (
    passcode: string,
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      const effectivePlayerId = detectedIdentity.playerId || profile.uid || activePlayerId;
      const response = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: effectivePlayerId,
          initData: getTelegramInitData(),
          passcode: passcode.trim(),
        }),
      });
      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      const payload = (
        contentType.includes('application/json')
          ? await response.json().catch(() => ({}))
          : {}
      ) as {
        ok?: boolean;
        token?: string;
        passcodeSource?: 'database' | 'server_file' | 'env' | 'default';
        passcodeUpdatedAtMs?: number;
        error?: string;
      };
      if (payload.passcodeSource) {
        setAdminPasscodeSource(payload.passcodeSource);
      }
      if (typeof payload.passcodeUpdatedAtMs === 'number') {
        setAdminPasscodeUpdatedAtMs(payload.passcodeUpdatedAtMs);
      }
      if (response.ok && payload.ok) {
        if (payload.token) {
          setAdminSessionToken(payload.token);
        }
        setAdminUnlocked(true);
        playClaimSound(soundsEnabled);
        triggerHapticFeedback('success');
        showToast('Admin Console unlocked!');
        return { ok: true };
      }
      return {
        ok: false,
        error:
          payload.error ||
          (!contentType.includes('application/json')
            ? `Verification endpoint returned HTTP ${response.status}. Please refresh the app.`
            : response.status >= 500
              ? 'Server error while verifying Admin Passcode.'
              : 'Incorrect Admin Passcode. Please try again.'),
      };
    } catch {
      return {
        ok: false,
        error: 'Unable to reach verification server. Please check your connection.',
      };
    }
  };

  const handleTestChannelsDiagnostic = async (
    channelsOverride?: typeof activeRequiredChannels,
  ) => {
    try {
      const response = await fetch('/api/telegram/test-channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: profile.uid,
          initData: getTelegramInitData(),
          token: adminSessionToken,
          requiredChannels: channelsOverride,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        botConfigured?: boolean;
        botUsername?: string | null;
        botError?: string;
        error?: string;
        channels?: Array<{
          id: string;
          handle: string;
          botIsAdmin: boolean;
          botStatus: string;
          userJoined?: boolean | null;
          userStatus?: string | null;
          error?: string;
        }>;
      };
      if (typeof payload.botConfigured === 'boolean') {
        setServerBotConfigured(payload.botConfigured);
      }
      return {
        ok: Boolean(response.ok && payload.ok),
        ...payload,
      };
    } catch {
      return {
        ok: false,
        error: 'Unable to reach channel verification server.',
      };
    }
  };

  const handleLockAdmin = () => {
    setAdminUnlocked(false);
    setAdminSessionToken('');
    showToast('Admin Console locked.');
  };

  const handleBanPlayer = async (input: {
    targetId: string;
    displayName?: string;
    handle?: string;
    reason?: string;
  }) => {
    const record = await banPlayerInFirestore({
      targetId: input.targetId,
      displayName: input.displayName,
      handle: input.handle,
      reason: input.reason,
      bannedBy: profile.uid,
      extraAdminIds,
    });
    const label = record.displayName || getPrimaryDepositMemo(record.uid) || record.uid;
    showToast(`Blocked player ${label}!`);
  };

  const handleUnbanPlayer = async (targetId: string) => {
    await unbanPlayerInFirestore(targetId);
    const label = getPrimaryDepositMemo(targetId) || targetId;
    showToast(`Unblocked player ${label}!`);
  };

  const handleSearchUsers = async (query: string): Promise<UserFarmProfile[]> => {
    return searchUsersInFirestore(query, recentPlayers);
  };

  const handleFetchPlayerReferrals = async (playerUid: string): Promise<ReferralRecord[]> => {
    return fetchPlayerReferralsFromFirestore(playerUid);
  };

  const handleAdjustCoins = async (input: {
    targetUid: string;
    deltaCoins: number;
    note?: string;
  }): Promise<UserFarmProfile> => {
    const res = await adjustPlayerCoinsInFirestore({
      adminUid: profile.uid,
      targetUid: input.targetUid,
      deltaCoins: input.deltaCoins,
      note: input.note,
      extraAdminIds,
    });
    setRecentPlayers((prev) =>
      prev.map((p) => (p.uid === res.profile.uid ? res.profile : p)),
    );
    const label = res.profile.displayName || getPrimaryDepositMemo(res.profile.uid);
    showToast(
      res.actualDelta >= 0
        ? `Added +${res.actualDelta.toLocaleString()} coins to ${label}!`
        : `Removed ${Math.abs(res.actualDelta).toLocaleString()} coins from ${label}!`,
    );
    return res.profile;
  };

  const handleAdjustReferralCount = async (input: {
    targetUid: string;
    deltaRefers: number;
  }): Promise<UserFarmProfile> => {
    const res = await adjustPlayerReferralCountInFirestore({
      adminUid: profile.uid,
      targetUid: input.targetUid,
      deltaRefers: input.deltaRefers,
      extraAdminIds,
    });
    setRecentPlayers((prev) =>
      prev.map((p) => (p.uid === res.profile.uid ? res.profile : p)),
    );
    const label = res.profile.displayName || getPrimaryDepositMemo(res.profile.uid);
    showToast(
      res.actualDelta >= 0
        ? `Added +${res.actualDelta} refers to ${label}!`
        : `Removed ${Math.abs(res.actualDelta)} refers from ${label}!`,
    );
    return res.profile;
  };

  const handleAddReferralRelation = async (input: {
    referrerIdOrCode: string;
    referredIdOrCode: string;
    bonusCoins?: number;
  }) => {
    const res = await adminAddReferralRelationInFirestore({
      adminUid: profile.uid,
      referrerIdOrCode: input.referrerIdOrCode,
      referredIdOrCode: input.referredIdOrCode,
      bonusCoins: input.bonusCoins,
      extraAdminIds,
    });
    setRecentPlayers((prev) =>
      prev.map((p) => {
        if (p.uid === res.referrerProfile.uid) return res.referrerProfile;
        if (p.uid === res.referredProfile.uid) return res.referredProfile;
        return p;
      }),
    );
    showToast(
      `Linked ${res.referredProfile.displayName} under ${res.referrerProfile.displayName}!`,
    );
    return res;
  };

  const handleRemoveReferralRelation = async (input: {
    referrerUid: string;
    referredUid: string;
  }) => {
    const res = await adminRemoveReferralRelationInFirestore({
      adminUid: profile.uid,
      referrerUid: input.referrerUid,
      referredUid: input.referredUid,
      extraAdminIds,
    });
    setRecentPlayers((prev) =>
      prev.map((p) => {
        if (res.referrerProfile && p.uid === res.referrerProfile.uid) {
          return res.referrerProfile;
        }
        if (res.referredProfile && p.uid === res.referredProfile.uid) {
          return res.referredProfile;
        }
        return p;
      }),
    );
    showToast('Removed referral link & updated counts!');
    return res;
  };

  const handleAddAdmin = async (input: {
    targetId: string;
    displayName?: string;
    handle?: string;
  }) => {
    const nextConfig = await addAdminInFirestore({
      actorUid: profile.uid,
      targetId: input.targetId,
      displayName: input.displayName,
      handle: input.handle,
    });
    setAdminsConfig(nextConfig);
    const label = getPrimaryDepositMemo(input.targetId) || input.targetId;
    showToast(`Added Co-Admin ${label}!`);
  };

  const handleRemoveAdmin = async (targetId: string) => {
    const nextConfig = await removeAdminInFirestore({
      actorUid: profile.uid,
      targetId,
    });
    setAdminsConfig(nextConfig);
    const label = getPrimaryDepositMemo(targetId) || targetId;
    showToast(`Removed Co-Admin ${label}!`);
  };

  const handleSaveWithdrawApproveTemplate = async (
    tpl: Omit<WithdrawApproveMessageTemplate, 'updatedAtMs'>,
  ): Promise<boolean> => {
    try {
      const saved = await saveWithdrawApproveTemplateInFirestore(tpl);
      setWithdrawApproveTemplate(saved);
      await safeFetchJson('/api/admin/payout-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...tpl,
          token: adminSessionToken,
          initData: getTelegramInitData(),
        }),
      });
      playClaimSound(soundsEnabled);
      triggerHapticFeedback('success');
      showToast('Withdrawal approval DM message saved!');
      return true;
    } catch {
      showToast('Failed to save approval DM template.');
      return false;
    }
  };

  const handleFetchBroadcastStats = useCallback(
    async (excludeBanned: boolean) => {
      try {
        const res = await fetch('/api/admin/broadcast/stats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: adminSessionToken,
            initData: getTelegramInitData(),
            excludeBanned,
          }),
        });
        const payload = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          totalRecipients?: number;
          botSubscriberCount?: number;
          blockedBotCount?: number;
          playerRecipientCount?: number;
          error?: string;
        };
        return { ok: Boolean(res.ok && payload.ok), ...payload };
      } catch {
        return { ok: false, error: 'Failed to load broadcast audience.' };
      }
    },
    [adminSessionToken],
  );

  const handleSyncBotSubscribers = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/telegram/sync-bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: adminSessionToken,
          initData: getTelegramInitData(),
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        totalRecipients?: number;
        botSubscriberCount?: number;
        blockedBotCount?: number;
        playerRecipientCount?: number;
        poll?: { newUpdates?: number; webhookActive?: boolean; error?: string };
        error?: string;
      };
      if (res.ok && payload.ok) {
        const syncedNew = payload.poll?.newUpdates ?? 0;
        showToast(
          syncedNew > 0
            ? `Synced ${syncedNew} new bot user${syncedNew === 1 ? '' : 's'}! Total: ${payload.totalRecipients ?? 0}`
            : `Bot audience synced (${payload.totalRecipients ?? 0} reachable).`,
        );
        return {
          ok: true,
          totalRecipients: payload.totalRecipients,
          botSubscriberCount: payload.botSubscriberCount,
          blockedBotCount: payload.blockedBotCount,
          playerRecipientCount: payload.playerRecipientCount,
          newUpdates: syncedNew,
          webhookActive: payload.poll?.webhookActive,
        };
      }
      const errMsg = payload.error || payload.poll?.error || 'Could not sync bot users.';
      showToast(errMsg);
      return { ok: false, error: errMsg };
    } catch {
      const errMsg = 'Network error syncing bot subscribers.';
      showToast(errMsg);
      return { ok: false, error: errMsg };
    }
  }, [adminSessionToken, showToast]);

  const handleSendBroadcast = async (input: {
    title: string;
    message: string;
    mediaType: 'none' | 'photo' | 'video' | 'animation';
    mediaUrl?: string;
    mediaDataUrl?: string;
    mediaFilename?: string;
    buttonText?: string;
    buttonUrl?: string;
    excludeBanned?: boolean;
    testOnlyToAdmin?: boolean;
  }) => {
    try {
      const response = await fetch('/api/admin/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...input,
          token: adminSessionToken,
          initData: getTelegramInitData(),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        totalTargets?: number;
        sentCount?: number;
        failedCount?: number;
        blockedCount?: number;
        testOnlyToAdmin?: boolean;
        sampleError?: string;
        error?: string;
      };
      if (response.ok && payload.ok) {
        playClaimSound(soundsEnabled);
        triggerHapticFeedback('success');
        showToast(
          payload.testOnlyToAdmin
            ? `Test DM sent (${payload.sentCount ?? 0}/${payload.totalTargets ?? 0})`
            : `Broadcast complete: ${payload.sentCount ?? 0} delivered`,
        );
        return { ok: true, ...payload };
      }
      const errMsg = payload.error || 'Failed to send broadcast.';
      showToast(errMsg);
      return { ok: false, error: errMsg, ...payload };
    } catch {
      const errMsg = 'Network error while sending broadcast.';
      showToast(errMsg);
      return { ok: false, error: errMsg };
    }
  };

  const handleClaimDaily = () => {
    const now = Date.now();
    const res = claimDailyStreak(profile, todayStr, now);
    if ('error' in res) {
      showToast(res.error);
      return;
    }
    playClaimSound(soundsEnabled);
    triggerHapticFeedback('success');
    triggerRewardConfetti();
    void persistMutation({
      nextProfile: res.profile,
      transaction: res.transaction,
    });
    showToast(`Daily login claimed: +${res.rewardCoins} coins!`);
  };

  const handleAfterPromoAdCompleted = useCallback(
    async (cleanCode: string) => {
      if (!channelsGateEnabled) {
        executeClaimPromo(cleanCode, true);
        return;
      }

      const withCompletedAd = recordCompletedGateAd(latestProfileRef.current);
      void persistMutation({ nextProfile: withCompletedAd });

      const verification = await handleCheckChannels({ silent: true });
      if (
        verification &&
        (verification.allJoined || verification.verificationMode === 'disabled')
      ) {
        executeClaimPromo(cleanCode, false);
        return;
      }

      pendingPromoClaimCodeRef.current = cleanCode;
      setPendingPromoClaimCode(cleanCode);
      setShowChannelGateModal(true);
      triggerHapticFeedback('warning');
    },
    [channelsGateEnabled, executeClaimPromo, handleCheckChannels, persistMutation],
  );

  const handleClaimPromo = (code: string) => {
    if (watchingAdLoading) return;
    const now = Date.now();
    const current = latestProfileRef.current;
    const dryRun = claimPromoCode(current, code, now, promoCodes);
    if ('error' in dryRun) {
      showToast(dryRun.error);
      return;
    }

    const cleanCode = code.trim().toUpperCase();
    void (async () => {
      setWatchingAdLoading(true);
      setActiveAdNetwork(null);
      try {
        const external = await tryRunExternalRewardedAd(adConfig);
        if (external.handled) {
          if (external.rewarded) {
            await handleAfterPromoAdCompleted(cleanCode);
          } else {
            showToast('Complete the ad to claim your gift code.');
          }
          return;
        }
        setAdModalState({
          open: true,
          kind: 'claim_promo',
          promoCode: cleanCode,
          promoRewardSummary: dryRun.rewardSummary,
          notice: external.message ?? null,
          network: null,
          mandatory: false,
        });
      } finally {
        setWatchingAdLoading(false);
      }
    })();
  };

  useEffect(() => {
    if (isBanned || skipWelcome || showSplash) return;
    if (subView === 'admin') return;
    if (startupAdTriggeredRef.current) return;
    startupAdTriggeredRef.current = true;

    void (async () => {
      setWatchingAdLoading(true);
      try {
        const external = await tryRunExternalRewardedAd(adConfig);
        if (external.handled && external.rewarded) {
          const updated = recordCompletedGateAd(latestProfileRef.current);
          void persistMutation({ nextProfile: updated });
          return;
        }
        setAdModalState({
          open: true,
          kind: 'startup',
          notice: external.handled
            ? 'Complete the launch ad to enter Alpha Gram.'
            : (external.message ?? null),
          network: null,
          mandatory: true,
        });
      } finally {
        setWatchingAdLoading(false);
      }
    })();
  }, [adConfig, isBanned, persistMutation, showSplash, skipWelcome, subView]);

  const handleCompleteTask = (taskId: string) => {
    const now = Date.now();
    const res = completeTask(profile, taskId, now, customTasks);
    if ('error' in res) {
      showToast(res.error);
      return;
    }
    playClaimSound(soundsEnabled);
    triggerHapticFeedback('success');
    void persistMutation({
      nextProfile: res.profile,
      transaction: res.transaction,
    });
    if (res.isCustomTask) {
      void incrementTaskClaimCountInFirestore(taskId).catch(() => {});
    }
    showToast(`Task complete: +${res.rewardCoins} coins!`);
  };

  const handleWatchAd = () => {
    const now = Date.now();
    const res = watchAdStep(latestProfileRef.current, now);
    playClaimSound(soundsEnabled);
    triggerHapticFeedback('success');
    void persistMutation({
      nextProfile: res.profile,
      transaction: res.transaction,
    });
    if (res.hitMilestone) {
      triggerRewardConfetti();
      showToast(`10/10 Bonus Chest! +${res.rewardEggs.toLocaleString()} Free Eggs added!`);
    } else {
      showToast(`+${res.rewardEggs.toLocaleString()} Free Eggs earned! (${res.profile.watchedAdsCount}/10)`);
    }
  };

  const handleClaimAdNetwork = (network: AdNetworkId) => {
    const now = Date.now();
    const current = latestProfileRef.current;
    const res = claimAdNetworkReward(current, network, todayStr, now);
    if ('error' in res) {
      showToast(res.error);
      return;
    }
    playClaimSound(soundsEnabled);
    triggerHapticFeedback('success');
    void persistMutation({
      nextProfile: res.profile,
      transaction: res.transaction,
    });
    showToast(`${res.networkName}: +${res.rewardCoins} coins (${res.watchedToday}/${res.dailyLimit} today)`);
  };

  const handleClaimAdsgramBotJoin = () => {
    const now = Date.now();
    const current = latestProfileRef.current;
    const res = claimAdsgramBotJoinReward(current, todayStr, now);
    if ('error' in res) {
      showToast(res.error);
      return;
    }
    playClaimSound(soundsEnabled);
    triggerHapticFeedback('success');
    triggerRewardConfetti();
    void persistMutation({
      nextProfile: res.profile,
      transaction: res.transaction,
    });
    showToast(
      `AdsGram Bot Joins: +${res.rewardCoins} coins (${res.claimedToday}/${res.dailyLimit} today)`,
    );
  };

  const handleTriggerWatchAd = async () => {
    if (watchingAdLoading) return;
    setWatchingAdLoading(true);
    setActiveAdNetwork(null);
    setActiveAdAction('watch_ad');
    try {
      const external = await tryRunExternalRewardedAd(adConfig);
      if (external.handled) {
        if (external.rewarded) {
          handleWatchAd();
        } else {
          showToast('Ad closed early — reward not claimed.');
        }
        return;
      }
      setAdModalState({
        open: true,
        kind: 'watch_ad',
        notice: external.message ?? null,
        network: null,
        mandatory: false,
      });
    } finally {
      setWatchingAdLoading(false);
      setActiveAdAction(null);
    }
  };

  const handleTriggerAdNetwork = async (network: AdNetworkId) => {
    if (watchingAdLoading) return;
    setWatchingAdLoading(true);
    setActiveAdNetwork(network);
    setActiveAdAction('ad_network');
    try {
      const external = await tryRunAdNetwork(network, adConfig);
      if (external.handled) {
        if (external.rewarded) {
          handleClaimAdNetwork(network);
          if (external.message) {
            showToast(external.message);
          }
        } else {
          showToast('Ad closed early — reward not claimed.');
        }
        return;
      }
      setAdModalState({
        open: true,
        kind: 'ad_network',
        notice: external.message ?? null,
        network,
        mandatory: false,
      });
    } finally {
      setWatchingAdLoading(false);
      setActiveAdNetwork(null);
      setActiveAdAction(null);
    }
  };

  const handleTriggerAdsgramTask = async () => {
    if (watchingAdLoading) return;
    setWatchingAdLoading(true);
    setActiveAdNetwork(null);
    setActiveAdAction('adsgram_task');
    try {
      const external = await tryRunAdsgramTaskAd(adConfig);
      if (external.handled) {
        if (external.rewarded) {
          handleClaimAdsgramBotJoin();
          if (external.message) {
            showToast(external.message);
          }
        } else {
          showToast('Complete the bot join / click task to claim coins.');
        }
        return;
      }
      setAdModalState({
        open: true,
        kind: 'adsgram_task',
        notice: external.message ?? null,
        network: null,
        mandatory: false,
      });
    } finally {
      setWatchingAdLoading(false);
      setActiveAdAction(null);
    }
  };

  const handleUpgradeBasket = () => {
    const now = Date.now();
    const res = upgradeBasket(profile, now);
    if ('error' in res) {
      showToast(res.error);
      return;
    }
    playPurchaseSuccessSound(soundsEnabled);
    triggerHapticFeedback('medium');
    void persistMutation({
      nextProfile: res.profile,
      transaction: res.transaction,
    });
    showToast(`Basket upgraded to ${res.profile.basketTierHours}h (${res.profile.basketCapacity} eggs)!`);
  };

  const handleActivateBooster = () => {
    const now = Date.now();
    const current = latestProfileRef.current;
    const res = activateFeedBooster(current, now);
    if ('error' in res) {
      showToast(res.error);
      return;
    }
    playPurchaseSuccessSound(soundsEnabled);
    triggerHapticFeedback('medium');
    void persistMutation({
      nextProfile: res.profile,
      transaction: res.transaction,
    });
    showToast('2× Laying Feed activated for 1 hour!');
  };

  const handleClaimCoopFeverAd = () => {
    const now = Date.now();
    const updated = recordCoopFeverAd(latestProfileRef.current);
    const nextProg = getCoopFeverProgress(updated, now);
    playClaimSound(soundsEnabled);
    triggerHapticFeedback('success');
    void persistMutation({ nextProfile: updated });
    if (nextProg.ready) {
      triggerRewardConfetti();
      showToast('3× Coop Fever unlocked (25/25 Ads)! Tap Activate 3× Fever on your Farm!');
    } else {
      showToast(
        `3× Fever Ad counted (${nextProg.adsCollected}/${COOP_FEVER_REQUIRED_ADS}).`,
      );
    }
  };

  const handleTriggerCoopFeverAd = async () => {
    if (watchingAdLoading) return;
    const now = Date.now();
    const prog = getCoopFeverProgress(latestProfileRef.current, now);
    if (prog.active) {
      showToast('Coop Fever 3× Rush is already active on your farm!');
      return;
    }
    if (prog.ready) {
      handleActivateCoopFever();
      return;
    }
    setWatchingAdLoading(true);
    setActiveAdNetwork(null);
    setActiveAdAction(null);
    try {
      const external = await tryRunExternalRewardedAd(adConfig);
      if (external.handled) {
        if (external.rewarded) {
          handleClaimCoopFeverAd();
        } else {
          showToast('Complete the ad to charge 3× Coop Fever.');
        }
        return;
      }
      setAdModalState({
        open: true,
        kind: 'coop_fever',
        notice: external.message ?? null,
        network: null,
        mandatory: false,
      });
    } finally {
      setWatchingAdLoading(false);
    }
  };

  const handleActivateCoopFever = () => {
    const now = Date.now();
    const current = latestProfileRef.current;
    const res = activateCoopFever(current, now);
    if ('error' in res) {
      showToast(res.error);
      return;
    }
    playGoldenEggSound(soundsEnabled);
    triggerHapticFeedback('success');
    triggerRewardConfetti();
    void persistMutation({
      nextProfile: res.profile,
      transaction: res.transaction,
    });
    showToast('Coop Fever 3× Golden Rush activated for 10 minutes!');
  };

  const handlePurchaseAutoHarvestDrone = (
    durationId: AutoHarvestDurationId,
    currency: AutoHarvestCurrency,
  ) => {
    const now = Date.now();
    const current = latestProfileRef.current;
    const res = purchaseAutoHarvestDrone(current, durationId, currency, now);
    if ('error' in res) {
      showToast(res.error);
      return;
    }
    playPurchaseSuccessSound(soundsEnabled);
    triggerHapticFeedback('success');
    triggerRewardConfetti();
    void persistMutation({
      nextProfile: res.profile,
      transaction: res.transaction,
    });
    showToast(`Auto-Harvest Drone active (${res.tier.label})!`);
  };

  const handleToggleTelegramReminders = useCallback(() => {
    const current = latestProfileRef.current;
    const nextEnabled = current.telegramRemindersEnabled === false;
    const nextProfile: UserFarmProfile = {
      ...current,
      telegramRemindersEnabled: nextEnabled,
    };
    playTabTapSound(soundsEnabled);
    triggerHapticFeedback('selection');
    void persistMutation({ nextProfile });
    showToast(
      nextEnabled
        ? 'Telegram Bot Push Reminders enabled!'
        : 'Telegram Bot Push Reminders paused.',
    );
  }, [persistMutation, showToast, soundsEnabled]);

  // Execute Auto-Harvest Drone automatically when active & basket reaches capacity
  const autoHarvestBusyRef = useRef(false);
  useEffect(() => {
    if (!isPlayerSynced || isBanned || autoHarvestBusyRef.current) return;
    const current = latestProfileRef.current;
    const now = Date.now();
    if (!isAutoHarvestDroneActive(current, now)) return;
    const res = applyAutoHarvestIfDue(current, now);
    if (res.autoHarvestedEggs <= 0) return;

    const droneTx: TransactionEntry = {
      id: `tx_autoharvest_${now}`,
      userId: current.uid,
      type: 'auto_harvest',
      title: `Auto-Harvest Drone (+${res.autoHarvestedEggs.toLocaleString()} eggs)`.slice(0, 80),
      amount: res.autoHarvestedEggs,
      currency: 'eggs',
      usdValue: eggsToUsd(res.autoHarvestedEggs),
      status: 'completed',
      createdAtMs: now,
    };

    autoHarvestBusyRef.current = true;
    void persistMutation({
      nextProfile: res.profile,
      transaction: droneTx,
    }).finally(() => {
      autoHarvestBusyRef.current = false;
    });
    showToast(`Auto-Harvest Drone collected +${res.autoHarvestedEggs.toLocaleString()} eggs!`);
  }, [
    isBanned,
    isPlayerSynced,
    nowMs,
    persistMutation,
    profile.autoHarvestUntilMs,
    profile.lastCollectedAt,
    showToast,
  ]);

  // Sync Basket Full & Boost Expiry Push Reminders to Telegram Bot server
  const lastReminderSyncKeyRef = useRef<string>('');
  useEffect(() => {
    if (!isPlayerSynced || isBanned) return;
    if (!extractTelegramNumericUserId(profile.uid)) return;
    const initData = getTelegramInitData();
    if (!playerSessionToken && !initData) return;

    const now = Date.now();
    const ratePerHour = calculateProductionRate(profile, now);
    const pending = calculatePendingEggs(profile, now);
    const remainingCapacity = Math.max(0, profile.basketCapacity - pending);
    const rawFullAt =
      ratePerHour > 0 && remainingCapacity > 0
        ? now + Math.ceil((remainingCapacity / ratePerHour) * 3_600_000)
        : 0;
    const basketFullAtMs = rawFullAt > 0 ? Math.floor(rawFullAt / 60_000) * 60_000 : 0;
    const enabled = profile.telegramRemindersEnabled !== false;
    const feedBoostUntilMs = Number(profile.feedBoostUntilMs ?? 0);
    const coopFeverUntilMs = Number(profile.coopFeverUntilMs ?? 0);
    const autoHarvestUntilMs = Number(profile.autoHarvestUntilMs ?? 0);

    const sig = [
      profile.uid,
      enabled ? '1' : '0',
      basketFullAtMs,
      feedBoostUntilMs,
      coopFeverUntilMs,
      autoHarvestUntilMs,
      playerSessionToken ? 'tok' : 'init',
    ].join(':');
    if (lastReminderSyncKeyRef.current === sig) return;

    const timer = window.setTimeout(() => {
      lastReminderSyncKeyRef.current = sig;
      void safeFetchJson('/api/reminders/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: profile.uid,
          initData,
          token: playerSessionToken,
          enabled,
          basketFullAtMs,
          feedBoostUntilMs,
          coopFeverUntilMs,
          autoHarvestUntilMs,
        }),
      });
    }, 650);

    return () => window.clearTimeout(timer);
  }, [
    isBanned,
    isPlayerSynced,
    nowMs,
    playerSessionToken,
    profile,
  ]);

  const handleGoldenEggTap = () => {
    const now = Date.now();
    const current = latestProfileRef.current;
    const res = claimGoldenEggDrop(current, now);
    if ('error' in res) {
      playSoftTapSound(soundsEnabled);
      showToast(res.error);
      return;
    }
    playGoldenEggSound(soundsEnabled);
    triggerHapticFeedback('success');
    triggerGoldenEggConfetti();
    void persistMutation({
      nextProfile: res.profile,
      transaction: res.transaction,
    });
    showToast(`Golden Egg! +${res.bonusCoins} coins & +${res.xpGained} XP`);
  };

  const handleClaimAchievement = (achievementId: string) => {
    const now = Date.now();
    const current = latestProfileRef.current;
    const res = claimAchievement(current, achievementId, now);
    if ('error' in res) {
      showToast(res.error);
      return;
    }
    playClaimSound(soundsEnabled);
    triggerHapticFeedback('success');
    triggerRewardConfetti();
    void persistMutation({
      nextProfile: res.profile,
      transaction: res.transaction,
    });
    showToast(`${res.title} claimed: +${res.rewardCoins} coins!`);
  };

  const handleClaimReferralMilestone = (targetActive: number) => {
    const now = Date.now();
    const current = latestProfileRef.current;
    const activeRefCount = referrals.filter((r) => r.status !== 'pending').length;
    const res = claimReferralMilestone(current, targetActive, activeRefCount, now);
    if ('error' in res) {
      showToast(res.error);
      return;
    }
    playClaimSound(soundsEnabled);
    triggerHapticFeedback('success');
    triggerRewardConfetti();
    void persistMutation({
      nextProfile: res.profile,
      transaction: res.transaction,
    });
    const henNote = res.crate.bonusLeghorns > 0 ? ` & +${res.crate.bonusLeghorns} Hen` : '';
    showToast(`${res.crate.title} opened: +${res.crate.rewardCoins} coins${henNote}!`);
  };

  const handleChangeLanguage = (language: LanguageCode) => {
    userSelectedLangRef.current = language;
    setStoredLanguage(language, profile.uid);
    const nextProfile: UserFarmProfile = { ...latestProfileRef.current, language };
    void persistMutation({ nextProfile });
  };

  const navigateTab = (tab: NavTab) => {
    playTabTapSound(soundsEnabled);
    triggerHapticFeedback('selection');
    setSubView('none');
    setActiveTab(tab);
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  };

  const openSubView = (view: SubView) => {
    playTabTapSound(soundsEnabled);
    triggerHapticFeedback('selection');
    setSubView(view);
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  };

  const renderContextualPanel = () => {
    if (subView === 'profile') {
      return (
        <ProfileView
          key={profile.uid}
          profile={profile}
          isTelegramDetected={detectedIdentity.isTelegramDetected}
          extraAdminIds={extraAdminIds}
          onBack={() => setSubView('none')}
          onBuyChickens={() => {
            setSubView('none');
            setActiveTab('packs');
          }}
          onOpenSettings={() => setShowSettings(true)}
          onOpenAdmin={() => openSubView('admin')}
          onClaimAchievement={handleClaimAchievement}
        />
      );
    }

    if (subView === 'admin') {
      return (
        <AdminPanelView
          playerId={detectedIdentity.playerId || profile.uid}
          adminUnlocked={adminUnlocked}
          adminPasscodeSource={adminPasscodeSource}
          adminPasscodeUpdatedAtMs={adminPasscodeUpdatedAtMs}
          serverBotConfigured={serverBotConfigured}
          onVerifyAdminPasscode={handleVerifyAdminPasscode}
          onTestChannels={handleTestChannelsDiagnostic}
          onLockAdmin={handleLockAdmin}
          withdrawRequests={allWithdrawRequests}
          customTasks={customTasks}
          adConfig={adConfig}
          channelsConfig={channelsConfig}
          promoCodes={promoCodes}
          recentPlayers={recentPlayers}
          bannedUsers={bannedUsers}
          adminsConfig={adminsConfig}
          withdrawApproveTemplate={withdrawApproveTemplate}
          onSaveWithdrawApproveTemplate={handleSaveWithdrawApproveTemplate}
          onTabTap={() => playTabTapSound(soundsEnabled)}
          onBack={() => setSubView('none')}
          onReviewWithdrawal={handleReviewWithdrawal}
          onCreateTask={handleCreateCustomTask}
          onToggleTask={handleToggleCustomTask}
          onDeleteTask={handleDeleteCustomTask}
          onSaveAdConfig={handleSaveAdConfig}
          onSaveChannelsConfig={handleSaveChannelsConfig}
          onCreatePromoCode={handleCreatePromoCode}
          onTogglePromoCode={handleTogglePromoCode}
          onDeletePromoCode={handleDeletePromoCode}
          onBanPlayer={handleBanPlayer}
          onUnbanPlayer={handleUnbanPlayer}
          onSearchUsers={handleSearchUsers}
          onFetchPlayerReferrals={handleFetchPlayerReferrals}
          onAdjustCoins={handleAdjustCoins}
          onAdjustReferralCount={handleAdjustReferralCount}
          onAddReferralRelation={handleAddReferralRelation}
          onRemoveReferralRelation={handleRemoveReferralRelation}
          onAddAdmin={handleAddAdmin}
          onRemoveAdmin={handleRemoveAdmin}
          onFetchBroadcastStats={handleFetchBroadcastStats}
          onSyncBotSubscribers={handleSyncBotSubscribers}
          onSendBroadcast={handleSendBroadcast}
        />
      );
    }

    if (subView === 'your_farm') {
      return (
        <YourFarmView
          profile={profile}
          pendingEggs={pendingEggs}
          telegramRemindersEnabled={profile.telegramRemindersEnabled !== false}
          onBack={() => setSubView('none')}
          onUpgradeBasket={handleUpgradeBasket}
          onGoPacks={() => {
            setSubView('none');
            setActiveTab('packs');
          }}
          onOpenWithdraw={() => openSubView('withdraw')}
          onToggleTelegramReminders={handleToggleTelegramReminders}
          onActivateBooster={handleActivateBooster}
          onPurchaseAutoHarvestDrone={handlePurchaseAutoHarvestDrone}
        />
      );
    }

    if (subView === 'deposit') {
      return (
        <DepositView
          profile={profile}
          deposits={deposits}
          depositAddress={depositAddress}
          gramJettonMaster={gramJettonMaster}
          onBack={() => setSubView('none')}
          onViewWallet={() => {
            setSubView('none');
            setActiveTab('wallet');
          }}
          onAutoCreditGramDeposit={handleAutoCreditGramDeposit}
        />
      );
    }

    if (subView === 'withdraw') {
      return (
        <WithdrawView
          profile={profile}
          withdrawals={withdrawals}
          channelVerification={channelVerification}
          requiredChannels={activeRequiredChannels}
          channelsGateEnabled={channelsGateEnabled}
          checkingChannels={checkingChannels}
          onCheckChannels={() => void handleCheckChannels()}
          onBack={() => setSubView('none')}
          onGoToTasks={() => {
            setSubView('none');
            setActiveTab('tasks');
          }}
          onConfirmWithdraw={handleConfirmWithdraw}
        />
      );
    }

    if (activeTab === 'packs') {
      return (
        <PacksView
          profile={profile}
          buyingBusy={watchingAdLoading}
          onBuy={handleBuyChickens}
          onTopUp={() => setSubView('deposit')}
        />
      );
    }

    if (activeTab === 'leaderboard') {
      return (
        <LeaderboardView
          profile={profile}
          entries={leaderboardEntries}
          seasonConfig={seasonConfig}
          onTabTap={() => playTabTapSound(soundsEnabled)}
          onNavigateFriends={() => navigateTab('friends')}
          onNavigatePacks={() => navigateTab('packs')}
        />
      );
    }

    if (activeTab === 'tasks') {
      return (
        <TasksView
          profile={profile}
          todayStr={todayStr}
          customTasks={customTasks}
          adConfig={adConfig}
          payoutChannelUrl={getTelegramChannelUrl(payoutChannel)}
          getCodeChannelUrl={
            channelsConfig.getCodeChannelUrl ||
            getTelegramChannelUrl(payoutChannel) ||
            DEFAULT_GET_CODE_CHANNEL_URL
          }
          watchingAd={watchingAdLoading}
          activeAdNetwork={activeAdNetwork}
          activeAdAction={activeAdAction}
          channelVerification={channelVerification}
          requiredChannels={activeRequiredChannels}
          channelsGateEnabled={channelsGateEnabled}
          checkingChannels={checkingChannels}
          onCheckChannels={() => handleCheckChannels()}
          onVerifyTaskChannel={handleVerifyTaskChannel}
          onTabTap={() => playTabTapSound(soundsEnabled)}
          onClaimPromo={handleClaimPromo}
          onClaimDaily={handleClaimDaily}
          onCompleteTask={handleCompleteTask}
          onTriggerWatchAd={() => void handleTriggerWatchAd()}
          onTriggerAdNetwork={(net) => void handleTriggerAdNetwork(net)}
          onTriggerAdsgramTask={() => void handleTriggerAdsgramTask()}
          onOpenDeposit={() => openSubView('deposit')}
          onCreateTask={handleCreatePaidUserTask}
          onTopUpTask={handleTopUpTask}
          onRefundTask={handleRefundTask}
          onRefreshTasks={handleRefreshTasks}
        />
      );
    }

    if (activeTab === 'friends') {
      return (
        <FriendsView
          profile={profile}
          referrals={referrals}
          transactions={mergedReferralTransactions}
          botUsername={telegramBotConfig.botUsername}
          appShortName={telegramBotConfig.appShortName}
          onClaimReferralMilestone={handleClaimReferralMilestone}
        />
      );
    }

    if (activeTab === 'wallet') {
      return (
        <WalletView
          profile={profile}
          transactions={transactions}
          withdrawals={withdrawals}
          onTabTap={() => playTabTapSound(soundsEnabled)}
          onOpenDeposit={() => setSubView('deposit')}
          onOpenWithdraw={() => setSubView('withdraw')}
          onReinvest={handleReinvest}
        />
      );
    }

    // Desktop right-column overview when Farm tab is active
    const productionRate = calculateProductionRate(profile);
    return (
      <div className="space-y-4">
        <div className="clay-card p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="alpha-brand-crest w-11 h-11 rounded-2xl text-base font-extrabold flex items-center justify-center shrink-0">
                αG
              </div>
              <div className="min-w-0">
                <h2 className="text-xl font-extrabold text-stone-900 dark:text-stone-100 truncate">
                  Alpha Gram Overview
                </h2>
                <p className="text-xs text-stone-500 dark:text-stone-400">
                  Live Cloud Sync · User ID{' '}
                  <span className="font-mono-num font-bold text-stone-700 dark:text-stone-200">
                    {getPrimaryDepositMemo(profile.uid)}
                  </span>
                </p>
              </div>
            </div>
            <span className="clay-card-mint !rounded-xl inline-flex items-center gap-1 text-xs font-extrabold text-emerald-700 dark:text-emerald-300 px-3 py-1.5 shrink-0">
              <CheckCircle2 className="w-4 h-4" />
              <span>Cloud Synced</span>
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="clay-card-warm clay-hover-lift !rounded-2xl p-3">
              <div className="text-xs font-bold text-stone-500 dark:text-stone-400">Production</div>
              <div className="text-lg font-extrabold text-stone-900 dark:text-stone-100 font-mono-num mt-0.5">
                {productionRate} /h
              </div>
            </div>
            <div className="clay-card-mint clay-hover-lift !rounded-2xl p-3">
              <div className="text-xs font-bold text-stone-500 dark:text-stone-400">Referrals</div>
              <div className="text-lg font-extrabold text-stone-900 dark:text-stone-100 font-mono-num mt-0.5 flex items-center gap-1">
                <Users className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>{profile.referralCount}</span>
              </div>
            </div>
            <div className="clay-inset clay-hover-lift !rounded-2xl p-3">
              <div className="text-xs font-bold text-stone-500 dark:text-stone-400">Ref Rewards</div>
              <div className="text-lg font-extrabold text-stone-900 dark:text-stone-100 font-mono-num mt-0.5 flex items-center gap-1">
                <CoinIcon className="w-4 h-4 shrink-0" />
                <span>+{profile.referralCoinsEarned.toLocaleString()}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2">
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={() => navigateTab('packs')}
              className="clay-btn clay-btn-amber min-h-[44px] rounded-2xl font-extrabold text-xs flex items-center justify-center gap-1.5"
            >
              <Package className="w-4 h-4" />
              <span>Buy Hens</span>
            </motion.button>
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={() => openSubView('deposit')}
              className="clay-btn clay-btn-emerald min-h-[44px] rounded-2xl font-extrabold text-xs flex items-center justify-center gap-1.5"
            >
              <ArrowDownLeft className="w-4 h-4" />
              <span>{strings.deposit}</span>
            </motion.button>
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={() => openSubView('withdraw')}
              className="clay-btn clay-btn-sky min-h-[44px] rounded-2xl font-extrabold text-xs flex items-center justify-center gap-1.5"
            >
              <ArrowUpRight className="w-4 h-4" />
              <span>{strings.withdraw}</span>
            </motion.button>
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={() => navigateTab('friends')}
              className="clay-btn clay-btn-neutral min-h-[44px] rounded-2xl text-stone-800 dark:text-stone-100 font-extrabold text-xs flex items-center justify-center gap-1.5"
            >
              <Users className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>{strings.friends}</span>
            </motion.button>
          </div>
        </div>

        {/* Desktop Preview: Referral Program + Recent Transactions */}
        <div className="grid grid-cols-2 gap-4">
          <div className="clay-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-stone-900 dark:text-stone-100 flex items-center gap-1.5">
                <Users className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>Referral Rewards</span>
              </h3>
              <button
                type="button"
                onClick={() => navigateTab('friends')}
                className="text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
              >
                Invite
              </button>
            </div>
            <div className="space-y-2 text-xs">
              <div className="clay-card-mint !rounded-xl px-3 py-2 flex items-center justify-between">
                <span className="font-bold text-stone-700 dark:text-stone-200">Per Referral Join</span>
                <span className="font-extrabold font-mono-num text-emerald-700 dark:text-emerald-300">
                  +{REFERRER_SIGNUP_BONUS_COINS} Coins
                </span>
              </div>
              <div className="clay-card-warm !rounded-xl px-3 py-2 flex items-center justify-between">
                <span className="font-bold text-stone-700 dark:text-stone-200">Friend Deposit Share</span>
                <span className="font-extrabold font-mono-num text-amber-700 dark:text-amber-300">
                  {Math.round(REFERRAL_DEPOSIT_COMMISSION_RATE * 100)}% Commission
                </span>
              </div>
              <div className="text-[11px] text-stone-500 dark:text-stone-400 font-semibold">
                Instant Telegram Bot notifications for every new referral &amp; deposit share.
              </div>
            </div>
          </div>

          <div className="clay-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-stone-900 dark:text-stone-100 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>Recent Activity</span>
              </h3>
              <button
                type="button"
                onClick={() => navigateTab('wallet')}
                className="text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
              >
                Wallet
              </button>
            </div>
            <div className="space-y-2">
              {transactions.slice(0, 4).map((tx) => (
                <div key={tx.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-stone-700 dark:text-stone-300 truncate">{tx.title}</span>
                  <span
                    className={`font-extrabold font-mono-num flex items-center gap-1 shrink-0 ${
                      tx.amount >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {tx.amount >= 0 ? `+${tx.amount}` : tx.amount}
                    {tx.currency === 'eggs' ? (
                      <EggIcon className="w-3.5 h-3.5" />
                    ) : (
                      <CoinIcon className="w-3.5 h-3.5" />
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const showFarmOnMobile = activeTab === 'farm' && subView === 'none';

  const hideBottomNav = subView === 'profile' || subView === 'admin';

  if (isBanned && banRecord) {
    const displayUserId = getPrimaryDepositMemo(banRecord.uid || profile.uid);
    return (
      <div className="min-h-screen flex items-center justify-center p-4 text-stone-900 dark:text-stone-100">
        <div className="clay-card max-w-md w-full overflow-hidden">
          <div className="bg-stone-900 dark:bg-stone-950 border-b border-stone-800 px-5 py-4 text-white flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-rose-500/20 border border-rose-400/30 flex items-center justify-center shrink-0">
              <Ban className="w-5 h-5 text-rose-300" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-extrabold tracking-tight">Account Blocked</h1>
              <p className="text-xs text-stone-300">Access to all Alpha Gram features is suspended</p>
            </div>
          </div>

          <div className="p-5 space-y-4">
            <p className="text-xs font-semibold text-stone-600 dark:text-stone-300 leading-relaxed">
              Your account has been restricted by an administrator. Farm mining, shop purchases,
              tasks, referrals, and withdrawals are disabled while this block is active.
            </p>

            <div className="clay-inset !rounded-2xl p-3.5 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-stone-500 dark:text-stone-400">Blocked Player ID</span>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(displayUserId).catch(() => {});
                    setBanIdCopied(true);
                    window.setTimeout(() => setBanIdCopied(false), 1600);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg bg-stone-200/80 dark:bg-stone-800 px-2 py-1 font-mono-num font-extrabold text-stone-900 dark:text-stone-100 cursor-pointer"
                >
                  <span>{displayUserId}</span>
                  {banIdCopied ? (
                    <Check className="w-3 h-3 text-emerald-600" />
                  ) : (
                    <Copy className="w-3 h-3 opacity-70" />
                  )}
                </button>
              </div>
              {displayUserId !== banRecord.uid && (
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-stone-500 dark:text-stone-400">Account UID</span>
                  <span className="font-mono-num font-bold text-stone-700 dark:text-stone-300">
                    {banRecord.uid}
                  </span>
                </div>
              )}
              {banRecord.bannedAtMs > 0 && (
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-stone-500 dark:text-stone-400">Blocked On</span>
                  <span className="font-mono-num font-semibold text-stone-700 dark:text-stone-300">
                    {new Date(banRecord.bannedAtMs).toLocaleString()}
                  </span>
                </div>
              )}
            </div>

            <div className="rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/70 px-3.5 py-3 space-y-1">
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-rose-700 dark:text-rose-300">
                Reason
              </div>
              <div className="text-xs font-bold text-rose-900 dark:text-rose-200 break-words">
                {banRecord.reason || 'Blocked by Administrator'}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`${
        showFarmOnMobile
          ? 'min-h-[100dvh] lg:min-h-screen flex flex-col lg:block pb-0 lg:pb-22'
          : `min-h-screen ${hideBottomNav ? 'pb-6' : 'pb-22'}`
      } text-stone-900 dark:text-stone-100 transition-colors`}
    >
      <TopBar
        profile={profile}
        coinsLabel={strings.coins}
        eggsLabel={strings.eggs}
        isAllMuted={allAudioMuted}
        muteAllLabel={strings.muteAll}
        unmuteAllLabel={strings.unmuteAll}
        isAdmin={isAuthorizedAdmin}
        onOpenProfile={() => openSubView('profile')}
        onOpenAdmin={() => openSubView('admin')}
        onToggleMuteAll={handleToggleMuteAll}
        onOpenSettings={() => setShowSettings(true)}
        onOpenDeposit={() => openSubView('deposit')}
      />

      {/* Unified non-overlapping Clay Feedback Toast */}
      <AnimatePresence>
        {toastText && (
          <motion.div
            key={toastText}
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: 18, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.94 }}
            transition={{ type: 'spring', stiffness: 440, damping: 28 }}
            className="clay-card-dark fixed bottom-20 left-1/2 -translate-x-1/2 z-50 !rounded-2xl text-white px-4 py-2.5 text-xs sm:text-sm font-bold whitespace-nowrap flex items-center gap-2 shadow-2xl"
          >
            <Sparkles className="w-4 h-4 text-amber-300 shrink-0" />
            <span>{toastText}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <main
        className={
          showFarmOnMobile
            ? 'w-full flex-1 flex flex-col lg:block lg:max-w-6xl lg:mx-auto lg:px-5 lg:pt-5'
            : 'max-w-6xl mx-auto px-3 sm:px-5 pt-3 sm:pt-5'
        }
      >
        <div
          className={
            showFarmOnMobile
              ? 'flex-1 flex flex-col lg:grid lg:grid-cols-12 lg:gap-5 lg:items-start'
              : 'grid grid-cols-1 lg:grid-cols-12 gap-5 items-start'
          }
        >
          {/* Left / Primary Farm Stage */}
          <div
            className={`lg:col-span-5 lg:sticky lg:top-32 ${
              showFarmOnMobile ? 'flex-1 flex flex-col w-full lg:block' : 'hidden lg:block'
            }`}
          >
            <FarmMeadow
              profile={profile}
              pendingEggs={pendingEggs}
              collectLabel={strings.collect}
              isVisible={showFarmOnMobile}
              isProfileSynced={isPlayerSynced}
              onCollect={handleCollectEggs}
              onOpenYourFarm={() => openSubView('your_farm')}
              onOpenWithdraw={() => openSubView('withdraw')}
              onChickenTap={() => {
                playChickenCluckSound(soundsEnabled);
                triggerHapticFeedback('light');
              }}
              onGoldenEggDrop={handleGoldenEggTap}
              onActivateBooster={handleActivateBooster}
              onActivateCoopFever={handleActivateCoopFever}
              onWatchCoopFeverAd={() => void handleTriggerCoopFeverAd()}
              onBuyChickens={() => navigateTab('packs')}
            />
          </div>

          {/* Right / Active Workspace View */}
          <div className={`lg:col-span-7 ${showFarmOnMobile ? 'hidden lg:block' : 'block'}`}>
            <AnimatePresence mode="wait">
              <motion.div
                key={subView !== 'none' ? `sub-${subView}` : `tab-${activeTab}`}
                initial={{ opacity: 0, y: 8, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.99 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              >
                {renderContextualPanel()}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </main>

      {!hideBottomNav && (
        <BottomNav
          activeTab={activeTab}
          hasClaimableTasks={hasClaimableTasks}
          labels={{
            farm: strings.farm,
            packs: strings.packs,
            ranks: strings.ranks,
            tasks: strings.tasks,
            friends: strings.friends,
            wallet: strings.wallet,
          }}
          onSelectTab={navigateTab}
        />
      )}

      {showSplash && <SplashScreen onComplete={handleSplashComplete} />}

      {!showSplash && !adModalState.open && showSignUpBonusModal && (
        <SignUpBonusModal
          onClaim={() => {
            playClaimSound(soundsEnabled);
            setShowSignUpBonusModal(false);
            try {
              localStorage.setItem(`chickenland_signup_bonus_seen_${activePlayerId}`, '1');
            } catch {
              // ignore storage errors
            }
            showToast('+1,000 coins ready! Buy your first chicken in Packs to start mining.');
          }}
        />
      )}

      {!showSplash && !adModalState.open && showWelcomeModal && !showSignUpBonusModal && (
        <WelcomeBackModal
          pendingEggs={pendingEggs}
          awayLabel={formatAwayDuration(nowMs - profile.lastCollectedAt)}
          onCollect={handleCollectEggs}
          onDismiss={() => setShowWelcomeModal(false)}
          headingText={strings.welcomeBack}
          collectLabel={strings.collect}
        />
      )}

      {!showSplash &&
        !adModalState.open &&
        !showSignUpBonusModal &&
        channelsGateEnabled &&
        showChannelGateModal && (
          <ChannelCheckModal
            verification={channelVerification}
            requiredChannels={activeRequiredChannels}
            checking={checkingChannels}
            pendingPromoCode={pendingPromoClaimCode}
            onCheckChannels={() => void handleCheckChannels()}
            onClose={() => {
              pendingPromoClaimCodeRef.current = null;
              setPendingPromoClaimCode(null);
              setShowChannelGateModal(false);
            }}
          />
        )}

      {adModalState.open && (() => {
        const netDef = adModalState.network
          ? AD_NETWORK_TASKS.find((n) => n.id === adModalState.network)
          : null;
        return (
          <RewardedAdModal
            adConfig={adConfig}
            watchedCount={profile.watchedAdsCount}
            actionKind={adModalState.kind}
            networkLabel={netDef?.name ?? null}
            rewardCoins={
              adModalState.kind === 'adsgram_task'
                ? ADSGRAM_BOT_JOIN_TASK.rewardCoins
                : (netDef?.rewardCoins ?? null)
            }
            pendingEggs={adModalState.pendingEggs ?? null}
            promoCode={adModalState.promoCode ?? null}
            promoRewardSummary={adModalState.promoRewardSummary ?? null}
            chickenBreed={adModalState.chickenBreed ?? null}
            chickenQty={adModalState.chickenQty ?? null}
            minerCostCoins={adModalState.minerCostCoins ?? null}
            coopFeverAdsCollected={getCoopFeverProgress(profile, nowMs).adsCollected}
            coopFeverAdsRequired={COOP_FEVER_REQUIRED_ADS}
            fallbackNotice={adModalState.notice}
            mandatory={adModalState.mandatory}
            onComplete={() => {
              const currentModal = adModalState;
              setAdModalState({ open: false, kind: 'watch_ad', notice: null, network: null });
              if (currentModal.kind === 'startup') {
                const updated = recordCompletedGateAd(latestProfileRef.current);
                void persistMutation({ nextProfile: updated });
                playSoftTapSound(soundsEnabled);
              } else if (currentModal.kind === 'collect_eggs') {
                executeCollectEggs(true);
              } else if (currentModal.kind === 'claim_promo' && currentModal.promoCode) {
                void handleAfterPromoAdCompleted(currentModal.promoCode);
              } else if (currentModal.kind === 'buy_chicken' && currentModal.chickenBreed) {
                void executeBuyChickens(
                  currentModal.chickenBreed,
                  currentModal.chickenQty || 1,
                  true,
                );
              } else if (currentModal.kind === 'ad_network' && currentModal.network) {
                handleClaimAdNetwork(currentModal.network);
              } else if (currentModal.kind === 'adsgram_task') {
                handleClaimAdsgramBotJoin();
              } else if (currentModal.kind === 'coop_fever') {
                handleClaimCoopFeverAd();
              } else {
                handleWatchAd();
              }
            }}
            onClose={() => {
              if (adModalState.mandatory) return;
              const cancelledKind = adModalState.kind;
              setAdModalState({ open: false, kind: 'watch_ad', notice: null, network: null });
              if (cancelledKind === 'collect_eggs') {
                showToast('Ad cancelled — eggs were not collected.');
              } else if (cancelledKind === 'claim_promo') {
                showToast('Ad cancelled — gift code was not claimed.');
              } else if (cancelledKind === 'buy_chicken') {
                showToast('Ad cancelled — miner was not purchased.');
              } else {
                showToast('Ad closed early — reward not claimed.');
              }
            }}
          />
        );
      })()}

      {showSettings && (
        <SettingsModal
          currentLanguage={profile.language}
          musicEnabled={musicEnabled}
          soundsEnabled={soundsEnabled}
          telegramRemindersEnabled={profile.telegramRemindersEnabled !== false}
          themeMode={themeMode}
          onChangeLanguage={handleChangeLanguage}
          onToggleMusic={handleToggleMusic}
          onToggleSounds={handleToggleSounds}
          onToggleTelegramReminders={handleToggleTelegramReminders}
          onToggleTheme={handleToggleTheme}
          onClose={() => setShowSettings(false)}
        />
      )}
      <OfflineIndicator />
    </div>
  );
}
