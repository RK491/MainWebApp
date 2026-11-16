import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Crown,
  Package,
  Sparkles,
  Trophy,
  Users,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { testFirestoreConnection } from './firebase';
import {
  activateFeedBooster,
  AD_NETWORK_TASKS,
  buildLeaderboardRankings,
  buyChickens,
  calculatePendingEggs,
  calculateProductionRate,
  CHICKEN_PACKS,
  claimAchievement,
  claimAdNetworkReward,
  claimDailyStreak,
  claimGoldenEggDrop,
  claimPromoCode,
  claimReferralMilestone,
  collectEggs,
  completeTask,
  createDefaultProfile,
  createDefaultSeasonConfig,
  createPaidTaskOrder,
  DEFAULT_AD_CONFIG,
  DEFAULT_CHANNELS_CONFIG,
  DEFAULT_GRAM_DEPOSIT_ADDRESS,
  DEFAULT_GRAM_JETTON_MASTER,
  detectTop10RankCelebration,
  executeDeposit,
  executeWithdrawal,
  formatAwayDuration,
  formatChannelsHandleSummary,
  formatPromoRewardSummary,
  getActiveRequiredChannels,
  recordCompletedGateAd,
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
  type FarmArtifactLayout,
  loadFarmArtifactLayout,
  saveFarmArtifactLayout,
} from './game/farmArtifacts';
import {
  applyReferralCodeInFirestore,
  commitPlayerMutation,
  createCustomTaskInFirestore,
  createPaidCustomTaskInFirestore,
  createPromoCodeInFirestore,
  deleteCustomTaskInFirestore,
  deletePromoCodeInFirestore,
  distributeSeasonPrizesInFirestore,
  ensurePlayerInFirestore,
  fetchCustomTasksFromFirestore,
  getStoredPlayerId,
  incrementPromoCodeUseInFirestore,
  incrementTaskClaimCountInFirestore,
  loadCachedPlayerProfile,
  resolveActivePlayerIdentity,
  reviewWithdrawalInFirestore,
  saveAdConfigInFirestore,
  saveChannelsConfigInFirestore,
  saveSeasonConfigInFirestore,
  subscribeToAdConfig,
  subscribeToAllWithdrawRequests,
  subscribeToChannelsConfig,
  subscribeToCustomTasks,
  subscribeToLeaderboard,
  subscribeToPlayer,
  subscribeToPromoCodes,
  subscribeToSeasonConfig,
  toggleCustomTaskInFirestore,
  togglePromoCodeInFirestore,
} from './services/farmStore';
import type {
  AdConfig,
  AdNetworkId,
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
  WithdrawalOrder,
  WithdrawRequestRecord,
} from './types/farm';
import { tryRunAdNetwork, tryRunExternalRewardedAd } from './utils/ads';
import { getStoredLanguage, setStoredLanguage, t } from './utils/i18n';
import {
  type BrowserNotificationPermission,
  calculateMsUntilBasketFull,
  dispatchBasketFullNotification,
  getBasketNotificationPreference,
  getBrowserNotificationPermission,
  getStoredLastNotifiedCycle,
  isDocumentBackgrounded,
  requestBrowserNotificationPermission,
  setBasketNotificationPreference,
  setStoredLastNotifiedCycle,
  shouldTriggerBasketFullNotification,
} from './utils/notifications';
import { triggerTop10RankConfetti, triggerWithdrawalConfetti } from './utils/celebration';
import {
  type AudioSettings,
  computeMuteAllToggle,
  getStoredAudioSettings,
  isAllAudioMuted,
  playClaimSound,
  playCoinChimeSound,
  playGoldenEggSound,
  playSoftTapSound,
  playTabTapSound,
  setStoredAudioSettings,
  stopAmbientMusic,
  syncAmbientMusic,
} from './utils/sound';
import {
  getTelegramChannelUrl,
  getTelegramInitData,
  safeFetchJson,
  triggerHapticFeedback,
} from './utils/telegram';
import { applyThemeToDocument, getStoredTheme, setStoredTheme, type ThemeMode } from './utils/theme';
import { AdminPanelView } from './components/AdminPanelView';
import { BottomNav } from './components/BottomNav';
import { ChannelCheckModal } from './components/ChannelCheckPanel';
import { DepositView } from './components/DepositView';
import { FarmArtifactsDrawer } from './components/FarmArtifactsDrawer';
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
  const [transactions, setTransactions] = useState<TransactionEntry[]>(initialSeed.transactions);
  const [referralTransactions, setReferralTransactions] = useState<TransactionEntry[]>([]);
  const [deposits, setDeposits] = useState<DepositOrder[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalOrder[]>([]);
  const [referrals, setReferrals] = useState<ReferralRecord[]>([]);
  const [cloudLeaderboard, setCloudLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [customTasks, setCustomTasks] = useState<TaskDefinition[]>([]);
  const [adConfig, setAdConfig] = useState<AdConfig>(DEFAULT_AD_CONFIG);
  const [channelsConfig, setChannelsConfig] = useState<ChannelsConfig>(DEFAULT_CHANNELS_CONFIG);
  const [allWithdrawRequests, setAllWithdrawRequests] = useState<WithdrawRequestRecord[]>([]);
  const [promoCodes, setPromoCodes] = useState<DynamicPromoCode[]>([]);
  const [seasonConfig, setSeasonConfig] = useState<SeasonConfig>(() => createDefaultSeasonConfig());

  const activeRequiredChannels = useMemo(
    () => getActiveRequiredChannels(channelsConfig),
    [channelsConfig],
  );
  const channelsGateEnabled = channelsConfig.enabled && activeRequiredChannels.length > 0;

  const [activeTab, setActiveTab] = useState<NavTab>('farm');
  const [subView, setSubView] = useState<SubView>(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('admin') === '1') {
      return 'admin';
    }
    return 'none';
  });
  const [showSettings, setShowSettings] = useState(false);
  const [showArtifactsDrawer, setShowArtifactsDrawer] = useState(false);
  const [artifactLayout, setArtifactLayout] = useState<FarmArtifactLayout>(() =>
    loadFarmArtifactLayout(activePlayerId),
  );
  const [watchingAdLoading, setWatchingAdLoading] = useState(false);
  const [activeAdNetwork, setActiveAdNetwork] = useState<AdNetworkId | null>(null);
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
  const [notificationPermission, setNotificationPermission] = useState<BrowserNotificationPermission>(() =>
    getBrowserNotificationPermission(),
  );
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(() =>
    getBasketNotificationPreference(),
  );
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
  const autoCheckedChannelsRef = useRef<string | null>(null);

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
        return detectedIdentity.startParam.trim().toUpperCase();
      }
      if (typeof window !== 'undefined') {
        return new URLSearchParams(window.location.search).get('ref')?.trim().toUpperCase() || null;
      }
      return null;
    })(),
  );
  const welcomeCheckedForPlayerRef = useRef<string | null>(null);
  const ensurePromiseRef = useRef<Promise<UserFarmProfile | void>>(Promise.resolve());
  const [isPlayerSynced, setIsPlayerSynced] = useState(false);
  const [isLeaderboardSynced, setIsLeaderboardSynced] = useState(false);
  const prevBuyerRankRef = useRef<number | null>(null);
  const rankCelebrationReadyRef = useRef(false);
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

  useEffect(() => {
    setArtifactLayout(loadFarmArtifactLayout(profile.uid));
  }, [profile.uid]);

  const handleChangeArtifactLayout = useCallback(
    (next: FarmArtifactLayout) => {
      setArtifactLayout(next);
      saveFarmArtifactLayout(latestProfileRef.current.uid, next);
    },
    [],
  );

  const handleToggleTheme = useCallback(() => {
    playTabTapSound(soundsEnabled);
    setThemeMode((prev) => {
      const next: ThemeMode = prev === 'dark' ? 'light' : 'dark';
      setStoredTheme(next);
      return next;
    });
  }, [soundsEnabled]);

  useEffect(() => {
    syncAmbientMusic(musicEnabled);
    if (!musicEnabled) {
      return () => stopAmbientMusic();
    }

    const handleFirstGesture = () => {
      syncAmbientMusic(true);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        stopAmbientMusic();
      } else {
        syncAmbientMusic(true);
      }
    };

    window.addEventListener('pointerdown', handleFirstGesture, { once: true });
    window.addEventListener('keydown', handleFirstGesture, { once: true });
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('pointerdown', handleFirstGesture);
      window.removeEventListener('keydown', handleFirstGesture);
      document.removeEventListener('visibilitychange', handleVisibility);
      stopAmbientMusic();
    };
  }, [musicEnabled]);

  useEffect(() => {
    // Re-check Telegram WebApp hydration shortly after mount in case SDK populates asynchronously
    if (detectedIdentity.isTelegramDetected) return;
    const timers = [150, 500, 1200].map((delay) =>
      window.setTimeout(() => {
        const next = resolveActivePlayerIdentity();
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
    const initData = getTelegramInitData();
    if (!initData) return;
    void safeFetchJson('/api/auth/verify-telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData }),
    });
  }, []);

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
        return disabledResult;
      }

      setCheckingChannels(true);
      try {
        const data = await safeFetchJson<ChannelVerificationResult>('/api/telegram/check-channels', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            playerId: latestProfileRef.current.uid,
            initData: getTelegramInitData(),
            requiredChannels: activeRequiredChannels,
          }),
        });
        if (!data) {
          if (!opts?.silent) {
            showToast('Could not verify channels right now. Please retry.');
          }
          return null;
        }
        setChannelVerification(data);

        if (data.verificationMode === 'disabled') {
          setShowChannelGateModal(false);
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
            if (!opts?.silent) {
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
            const missing = data.channels
              .filter((c) => !c.joined)
              .map((c) => c.handle)
              .join(' & ');
            if (!opts?.silent) {
              triggerHapticFeedback('warning');
              showToast(`Join required: ${missing || formatChannelsHandleSummary(activeRequiredChannels)}`);
            }
          }
        } else if (!opts?.silent) {
          if (data.verificationMode === 'guest_browser') {
            showToast('Open in Telegram Mini App for live bot channel check.');
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
    [activeRequiredChannels, channelsGateEnabled, showToast, soundsEnabled],
  );

  useEffect(() => {
    if (!channelsGateEnabled) {
      setShowChannelGateModal(false);
      return;
    }
    if (skipWelcome) return;
    if (!detectedIdentity.isTelegramDetected) return;
    if (autoCheckedChannelsRef.current === activePlayerId) return;
    autoCheckedChannelsRef.current = activePlayerId;

    void handleCheckChannels({ silent: true }).then((result) => {
      if (result && result.verificationMode === 'telegram_bot' && !result.allJoined) {
        setShowChannelGateModal(true);
      }
    });
  }, [activePlayerId, channelsGateEnabled, detectedIdentity.isTelegramDetected, handleCheckChannels, skipWelcome]);

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
  }, [notificationsEnabled]);

  useEffect(() => {
    checkAndNotifyBasketFull();
  }, [checkAndNotifyBasketFull, nowMs, profile]);

  useEffect(() => {
    if (!notificationsEnabled) return;

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
  }, [
    checkAndNotifyBasketFull,
    notificationsEnabled,
    profile,
  ]);

  const handleToggleNotifications = useCallback(async () => {
    const currentPerm = getBrowserNotificationPermission();
    setNotificationPermission(currentPerm);

    if (currentPerm === 'unsupported') {
      showToast('Browser notifications are not supported on this device.');
      return;
    }

    if (notificationsEnabled) {
      setNotificationsEnabled(false);
      setBasketNotificationPreference(false);
      showToast('Basket full browser alerts turned off.');
      return;
    }

    if (currentPerm === 'denied') {
      showToast('Notifications blocked — allow them in your browser site settings.');
      return;
    }

    const finalPerm =
      currentPerm === 'granted' ? 'granted' : await requestBrowserNotificationPermission();
    setNotificationPermission(finalPerm);

    if (finalPerm === 'granted') {
      setNotificationsEnabled(true);
      setBasketNotificationPreference(true);
      showToast('Basket full alerts enabled! We will remind you in the background.');
    } else {
      setNotificationsEnabled(false);
      setBasketNotificationPreference(false);
      showToast('Notification permission was not granted.');
    }
  }, [notificationsEnabled, showToast]);

  // Verify Firestore connection, fetch server GRAM config & subscribe to live public leaderboard
  useEffect(() => {
    testFirestoreConnection();
    void safeFetchJson<{
      gramDepositAddress?: string;
      gramJettonMaster?: string;
      payoutChannel?: string;
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
    });
    const unsubLb = subscribeToLeaderboard((entries) => {
      setCloudLeaderboard(entries);
      setIsLeaderboardSynced(true);
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
    const unsubSeason = subscribeToSeasonConfig((cfg) => {
      setSeasonConfig(cfg);
    });
    return () => {
      unsubLb();
      unsubTasks();
      unsubAds();
      unsubChannels();
      unsubPromos();
      unsubSeason();
    };
  }, []);

  useEffect(() => {
    if (subView !== 'admin') return;
    const unsubWdReqs = subscribeToAllWithdrawRequests((items) => {
      setAllWithdrawRequests(items);
    });
    return () => unsubWdReqs();
  }, [subView]);

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

        // Auto-link ?ref= / start_param as Pending until player buys their 1st chicken
        const refCode = pendingRefCodeRef.current;
        if (refCode && !ensured.referredBy && refCode !== ensured.referralCode.toUpperCase()) {
          pendingRefCodeRef.current = null;
          const refRes = await applyReferralCodeInFirestore(ensured, refCode);
          if (!cancelled && !('error' in refRes)) {
            latestProfileRef.current = refRes.profile;
            setProfile(refRes.profile);
            showToast(`+100 welcome coins! Buy 1st chicken to activate ${refRes.referrerName}'s referral`);
            if (typeof window !== 'undefined') {
              const url = new URL(window.location.href);
              url.searchParams.delete('ref');
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

  const rankings = useMemo(
    () => buildLeaderboardRankings(cloudLeaderboard, profile),
    [cloudLeaderboard, profile],
  );

  useEffect(() => {
    if (!isPlayerSynced || !isLeaderboardSynced) return;
    if (!rankCelebrationReadyRef.current) {
      rankCelebrationReadyRef.current = true;
      prevBuyerRankRef.current = rankings.userBuyerRank;
      return;
    }

    const shouldCelebrate = detectTop10RankCelebration({
      previousRank: prevBuyerRankRef.current,
      nextRank: rankings.userBuyerRank,
      hasInitialized: true,
    });
    prevBuyerRankRef.current = rankings.userBuyerRank;

    if (shouldCelebrate) {
      triggerTop10RankConfetti();
      showToast(`Reached Top 10 Leaderboard Rank #${rankings.userBuyerRank}!`);
    }
  }, [isLeaderboardSynced, isPlayerSynced, rankings.userBuyerRank, showToast]);

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
      setShowWelcomeModal(false);
      setNowMs(now);
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
      playCoinChimeSound(soundsEnabled);
      triggerHapticFeedback('success');
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
      await safeFetchJson('/api/withdraw/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
      showToast(
        decision === 'approved'
          ? `Approved ${request.gramAmount} GRAM for ${request.displayName}!`
          : `Rejected request & refunded ${request.eggsAmount.toLocaleString()} eggs.`,
      );
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
      setTransactions((prev) => [order.transaction, ...prev].slice(0, 60));
      playCoinChimeSound(soundsEnabled);
      triggerHapticFeedback('success');
      showToast(`Task published! -${order.cost.totalCostCoins.toLocaleString()} coins`);
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

  const handleSaveAdConfig = async (cfg: Omit<AdConfig, 'updatedAtMs'>) => {
    try {
      const saved = await saveAdConfigInFirestore(cfg);
      setAdConfig(saved);
      showToast('Ad settings saved!');
    } catch {
      showToast('Failed to save ad settings.');
    }
  };

  const handleSaveChannelsConfig = async (cfg: Omit<ChannelsConfig, 'updatedAtMs'>) => {
    try {
      const saved = await saveChannelsConfigInFirestore(cfg);
      setChannelsConfig(saved);
      showToast('Channel check settings saved!');
    } catch {
      showToast('Failed to save channel settings.');
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

  const handleSaveSeasonConfig = async (cfg: Omit<SeasonConfig, 'updatedAtMs'>) => {
    try {
      const saved = await saveSeasonConfigInFirestore(cfg);
      setSeasonConfig(saved);
      showToast(`${saved.title} settings saved!`);
    } catch {
      showToast('Failed to save season config.');
    }
  };

  const handleDistributeSeasonPrizes = async (nextDurationDays: number) => {
    try {
      const nextSeason = await distributeSeasonPrizesInFirestore({
        entries: rankings.topBuyers,
        season: seasonConfig,
        nextDurationDays,
      });
      setSeasonConfig(nextSeason);
      triggerTop10RankConfetti();
      showToast(`Season #${seasonConfig.seasonNumber} prizes paid & Season #${nextSeason.seasonNumber} started!`);
    } catch {
      showToast('Failed to distribute season prizes.');
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
    void persistMutation({
      nextProfile: res.profile,
      transaction: res.transaction,
    });
    showToast(`Daily login claimed: +${res.rewardCoins} coins!`);
  };

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
            executeClaimPromo(cleanCode, true);
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
    if (skipWelcome || showSplash) return;
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
  }, [adConfig, persistMutation, showSplash, skipWelcome, subView]);

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
    if (res.unlockedChicken) {
      showToast('10/10 ads watched — +1 Free White Leghorn added!');
    } else {
      showToast(`Ad watched (${res.profile.watchedAdsCount}/10)`);
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
    if (res.unlockedChicken) {
      showToast(`${res.networkName}: +${res.rewardCoins} coins & +1 Free White Leghorn!`);
    } else {
      showToast(`${res.networkName}: +${res.rewardCoins} coins (${res.watchedToday}/${res.dailyLimit} today)`);
    }
  };

  const handleTriggerWatchAd = async () => {
    if (watchingAdLoading) return;
    setWatchingAdLoading(true);
    setActiveAdNetwork(null);
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
    }
  };

  const handleTriggerAdNetwork = async (network: AdNetworkId) => {
    if (watchingAdLoading) return;
    setWatchingAdLoading(true);
    setActiveAdNetwork(network);
    try {
      const external = await tryRunAdNetwork(network, adConfig);
      if (external.handled) {
        if (external.rewarded) {
          handleClaimAdNetwork(network);
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
    }
  };

  const handleUpgradeBasket = () => {
    const now = Date.now();
    const res = upgradeBasket(profile, now);
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
    playCoinChimeSound(soundsEnabled);
    triggerHapticFeedback('medium');
    void persistMutation({
      nextProfile: res.profile,
      transaction: res.transaction,
    });
    showToast('2× Laying Feed activated for 1 hour!');
  };

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
          playerId={profile.uid}
          withdrawRequests={allWithdrawRequests}
          customTasks={customTasks}
          adConfig={adConfig}
          channelsConfig={channelsConfig}
          promoCodes={promoCodes}
          seasonConfig={seasonConfig}
          leaderboardEntries={cloudLeaderboard}
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
          onSaveSeasonConfig={handleSaveSeasonConfig}
          onDistributeSeasonPrizes={handleDistributeSeasonPrizes}
        />
      );
    }

    if (subView === 'leaderboard') {
      return (
        <LeaderboardView
          entries={cloudLeaderboard}
          profile={profile}
          seasonConfig={seasonConfig}
          onTabTap={() => playTabTapSound(soundsEnabled)}
          onBack={() => setSubView('none')}
          onGoBuy={() => {
            setSubView('none');
            setActiveTab('packs');
          }}
        />
      );
    }

    if (subView === 'your_farm') {
      return (
        <YourFarmView
          profile={profile}
          pendingEggs={pendingEggs}
          notificationsEnabled={notificationsEnabled}
          notificationPermission={notificationPermission}
          artifactLayout={artifactLayout}
          onBack={() => setSubView('none')}
          onUpgradeBasket={handleUpgradeBasket}
          onGoPacks={() => {
            setSubView('none');
            setActiveTab('packs');
          }}
          onToggleNotifications={() => void handleToggleNotifications()}
          onActivateBooster={handleActivateBooster}
          onOpenArtifactsDrawer={() => {
            playTabTapSound(soundsEnabled);
            setShowArtifactsDrawer(true);
          }}
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

    if (activeTab === 'tasks') {
      return (
        <TasksView
          profile={profile}
          todayStr={todayStr}
          customTasks={customTasks}
          adConfig={adConfig}
          payoutChannelUrl={getTelegramChannelUrl(payoutChannel)}
          watchingAd={watchingAdLoading}
          activeAdNetwork={activeAdNetwork}
          channelVerification={channelVerification}
          requiredChannels={activeRequiredChannels}
          channelsGateEnabled={channelsGateEnabled}
          checkingChannels={checkingChannels}
          onCheckChannels={() => handleCheckChannels()}
          onTabTap={() => playTabTapSound(soundsEnabled)}
          onClaimPromo={handleClaimPromo}
          onClaimDaily={handleClaimDaily}
          onCompleteTask={handleCompleteTask}
          onTriggerWatchAd={() => void handleTriggerWatchAd()}
          onTriggerAdNetwork={(net) => void handleTriggerAdNetwork(net)}
          onOpenDeposit={() => openSubView('deposit')}
          onCreateTask={handleCreatePaidUserTask}
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
              <div className="text-xs font-bold text-stone-500 dark:text-stone-400">Buyer Rank</div>
              <div className="text-lg font-extrabold text-stone-900 dark:text-stone-100 font-mono-num mt-0.5">
                #{rankings.userBuyerRank}
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
              onClick={() => openSubView('leaderboard')}
              className="clay-btn clay-btn-neutral min-h-[44px] rounded-2xl text-stone-800 dark:text-stone-100 font-extrabold text-xs flex items-center justify-center gap-1.5"
            >
              <Trophy className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <span>{strings.top10}</span>
            </motion.button>
          </div>
        </div>

        {/* Desktop Preview: Live Leaderboard + Recent Transactions */}
        <div className="grid grid-cols-2 gap-4">
          <div className="clay-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-stone-900 dark:text-stone-100 flex items-center gap-1.5">
                <Crown className="w-4 h-4 text-amber-500" />
                <span>Live Leaderboard</span>
              </h3>
              <button
                type="button"
                onClick={() => setSubView('leaderboard')}
                className="text-xs font-bold text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
              >
                View all
              </button>
            </div>
            <div className="space-y-2">
              {rankings.topBuyers.slice(0, 4).map((entry, idx) => (
                <div key={entry.uid} className="flex items-center justify-between text-xs gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-4 font-extrabold text-stone-400 dark:text-stone-500 font-mono-num">{idx + 1}</span>
                    <span className="font-bold text-stone-800 dark:text-stone-200 truncate">
                      {entry.displayName} {entry.isCurrentUser ? '(You)' : ''}
                    </span>
                  </div>
                  <span className="font-extrabold text-amber-700 dark:text-amber-400 font-mono-num shrink-0">
                    {entry.eggs.toLocaleString()} eggs · {entry.inviterCount} refs
                  </span>
                </div>
              ))}
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

  return (
    <div className={`min-h-screen text-stone-900 dark:text-stone-100 transition-colors ${hideBottomNav ? 'pb-6' : 'pb-22'}`}>
      <TopBar
        profile={profile}
        coinsLabel={strings.coins}
        eggsLabel={strings.eggs}
        isAllMuted={allAudioMuted}
        muteAllLabel={strings.muteAll}
        unmuteAllLabel={strings.unmuteAll}
        onOpenProfile={() => openSubView('profile')}
        onOpenLeaderboard={() => openSubView('leaderboard')}
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
            initial={{ opacity: 0, y: 14, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="clay-card-dark fixed bottom-20 left-1/2 -translate-x-1/2 z-50 !rounded-2xl text-white px-4 py-2.5 text-xs sm:text-sm font-bold whitespace-nowrap"
          >
            {toastText}
          </motion.div>
        )}
      </AnimatePresence>

      <main className="max-w-6xl mx-auto px-3 sm:px-5 pt-3 sm:pt-5">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left / Primary Farm Stage */}
          <div className={`lg:col-span-5 lg:sticky lg:top-32 ${showFarmOnMobile ? 'block' : 'hidden lg:block'}`}>
            <FarmMeadow
              profile={profile}
              pendingEggs={pendingEggs}
              collectLabel={strings.collect}
              isVisible={showFarmOnMobile}
              isProfileSynced={isPlayerSynced}
              artifactLayout={artifactLayout}
              onCollect={handleCollectEggs}
              onOpenYourFarm={() => openSubView('your_farm')}
              onOpenArtifactsDrawer={() => {
                playTabTapSound(soundsEnabled);
                setShowArtifactsDrawer(true);
              }}
              onArtifactTap={() => {
                playSoftTapSound(soundsEnabled);
                triggerHapticFeedback('light');
              }}
              onChickenTap={() => {
                playSoftTapSound(soundsEnabled);
                triggerHapticFeedback('light');
              }}
              onGoldenEggDrop={handleGoldenEggTap}
              onActivateBooster={handleActivateBooster}
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
            onCheckChannels={() => void handleCheckChannels()}
            onClose={() => setShowChannelGateModal(false)}
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
            rewardCoins={netDef?.rewardCoins ?? null}
            pendingEggs={adModalState.pendingEggs ?? null}
            promoCode={adModalState.promoCode ?? null}
            promoRewardSummary={adModalState.promoRewardSummary ?? null}
            chickenBreed={adModalState.chickenBreed ?? null}
            chickenQty={adModalState.chickenQty ?? null}
            minerCostCoins={adModalState.minerCostCoins ?? null}
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
                executeClaimPromo(currentModal.promoCode, true);
              } else if (currentModal.kind === 'buy_chicken' && currentModal.chickenBreed) {
                void executeBuyChickens(
                  currentModal.chickenBreed,
                  currentModal.chickenQty || 1,
                  true,
                );
              } else if (currentModal.kind === 'ad_network' && currentModal.network) {
                handleClaimAdNetwork(currentModal.network);
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
          notificationsEnabled={notificationsEnabled}
          notificationPermission={notificationPermission}
          themeMode={themeMode}
          onChangeLanguage={handleChangeLanguage}
          onToggleMusic={handleToggleMusic}
          onToggleSounds={handleToggleSounds}
          onToggleNotifications={() => void handleToggleNotifications()}
          onToggleTheme={handleToggleTheme}
          onClose={() => setShowSettings(false)}
        />
      )}
      {showArtifactsDrawer && (
        <FarmArtifactsDrawer
          layout={artifactLayout}
          onChangeLayout={handleChangeArtifactLayout}
          onSoftTap={() => {
            playSoftTapSound(soundsEnabled);
            triggerHapticFeedback('selection');
          }}
          onClose={() => setShowArtifactsDrawer(false)}
        />
      )}
      <OfflineIndicator />
    </div>
  );
}
