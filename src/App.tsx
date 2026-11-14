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
import { testFirestoreConnection } from './firebase';
import {
  activateFeedBooster,
  buildLeaderboardRankings,
  buyChickens,
  calculatePendingEggs,
  calculateProductionRate,
  claimAchievement,
  claimDailyStreak,
  claimGoldenEggDrop,
  claimPromoCode,
  claimReferralMilestone,
  collectEggs,
  completeTask,
  createDefaultProfile,
  createDefaultSeasonConfig,
  DEFAULT_AD_CONFIG,
  DEFAULT_GRAM_DEPOSIT_ADDRESS,
  DEFAULT_GRAM_JETTON_MASTER,
  detectTop10RankCelebration,
  executeDeposit,
  executeWithdrawal,
  formatAwayDuration,
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
  applyReferralCodeInFirestore,
  commitPlayerMutation,
  createCustomTaskInFirestore,
  createPromoCodeInFirestore,
  deleteCustomTaskInFirestore,
  deletePromoCodeInFirestore,
  distributeSeasonPrizesInFirestore,
  ensurePlayerInFirestore,
  getStoredPlayerId,
  incrementPromoCodeUseInFirestore,
  resolveActivePlayerIdentity,
  reviewWithdrawalInFirestore,
  saveAdConfigInFirestore,
  saveSeasonConfigInFirestore,
  subscribeToAdConfig,
  subscribeToAllWithdrawRequests,
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
  ChickenBreedId,
  DepositOrder,
  DynamicPromoCode,
  LanguageCode,
  LeaderboardEntry,
  NavTab,
  ReferralRecord,
  SeasonConfig,
  SubView,
  TaskDefinition,
  TransactionEntry,
  UserFarmProfile,
  WithdrawalOrder,
  WithdrawRequestRecord,
} from './types/farm';
import { tryRunExternalRewardedAd } from './utils/ads';
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
import { getTelegramChannelUrl, getTelegramInitData, triggerHapticFeedback } from './utils/telegram';
import { applyThemeToDocument, getStoredTheme, setStoredTheme, type ThemeMode } from './utils/theme';
import { AdminPanelView } from './components/AdminPanelView';
import { BottomNav } from './components/BottomNav';
import { DepositView } from './components/DepositView';
import { FarmMeadow } from './components/FarmMeadow';
import { FriendsView } from './components/FriendsView';
import { CoinIcon, EggIcon } from './components/GameIcons';
import { LeaderboardView } from './components/LeaderboardView';
import { PacksView } from './components/PacksView';
import { ProfileView, SettingsModal, YourFarmView } from './components/ProfileAndFarmViews';
import { OfflineIndicator } from './components/PWAControls';
import { RewardedAdModal } from './components/RewardedAdModal';
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
  const [detectedIdentity] = useState(() => resolveActivePlayerIdentity());
  const activePlayerId = detectedIdentity.playerId || getStoredPlayerId();
  const initialSeed = useMemo(() => {
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
  const [allWithdrawRequests, setAllWithdrawRequests] = useState<WithdrawRequestRecord[]>([]);
  const [promoCodes, setPromoCodes] = useState<DynamicPromoCode[]>([]);
  const [seasonConfig, setSeasonConfig] = useState<SeasonConfig>(() => createDefaultSeasonConfig());

  const [activeTab, setActiveTab] = useState<NavTab>('farm');
  const [subView, setSubView] = useState<SubView>(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('admin') === '1') {
      return 'admin';
    }
    return 'none';
  });
  const [showSettings, setShowSettings] = useState(false);
  const [watchingAdLoading, setWatchingAdLoading] = useState(false);
  const [adModalState, setAdModalState] = useState<{ open: boolean; notice?: string | null }>({
    open: false,
    notice: null,
  });
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
    const initData = getTelegramInitData();
    if (!initData) return;
    fetch('/api/auth/verify-telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData }),
    }).catch(() => {
      // Non-fatal outside Telegram signed WebApp context
    });
  }, []);

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
    fetch('/api/config')
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (
          cfg: {
            gramDepositAddress?: string;
            gramJettonMaster?: string;
            payoutChannel?: string;
          } | null,
        ) => {
          if (cfg?.gramDepositAddress) {
            setDepositAddress(cfg.gramDepositAddress);
          }
          if (cfg?.gramJettonMaster) {
            setGramJettonMaster(cfg.gramJettonMaster);
          }
          if (cfg?.payoutChannel) {
            setPayoutChannel(cfg.payoutChannel);
          }
        },
      )
      .catch(() => {
        // Fallback to default GRAM deposit config
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
    let unsubPlayer: (() => void) | null = null;

    const init = async () => {
      try {
        const { profile: ensured, isNewPlayer } = await ensurePlayerInFirestore(activePlayerId, {
          displayName: detectedIdentity.displayName,
          handle: detectedIdentity.handle,
          photoUrl: detectedIdentity.photoUrl,
          isTelegramDetected: detectedIdentity.isTelegramDetected,
        });
        if (cancelled) return;

        const resolvedProfile: UserFarmProfile =
          userSelectedLangRef.current && userSelectedLangRef.current !== ensured.language
            ? { ...ensured, language: userSelectedLangRef.current }
            : ensured;
        setStoredLanguage(resolvedProfile.language, activePlayerId);
        latestProfileRef.current = resolvedProfile;
        setProfile(resolvedProfile);

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

        if (cancelled) return;
        setIsPlayerSynced(true);
        unsubPlayer = subscribeToPlayer(activePlayerId, {
          onProfile: (p) => {
            setStoredLanguage(p.language, p.uid);
            latestProfileRef.current = p;
            setProfile(p);
          },
          onTransactions: (txs) => setTransactions(txs),
          onReferralTransactions: (refTxs) => setReferralTransactions(refTxs),
          onDeposits: (deps) => setDeposits(deps),
          onWithdrawals: (wds) => {
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
          onReferrals: (refs) => setReferrals(refs),
        });
      } catch {
        if (!cancelled) {
          showToast('Could not connect to Firestore database. Please retry.');
        }
      }
    };

    ensurePromiseRef.current = init();

    return () => {
      cancelled = true;
      if (unsubPlayer) unsubPlayer();
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

  const handleCollectEggs = () => {
    const now = Date.now();
    const pending = calculatePendingEggs(profile, now);
    const res = collectEggs(profile, now, pending);
    if ('error' in res) {
      showToast(res.error);
      return;
    }
    playClaimSound(soundsEnabled);
    triggerHapticFeedback('success');
    setShowWelcomeModal(false);
    setNowMs(now);
    void persistMutation({
      nextProfile: res.profile,
      transaction: res.transaction,
      referralEggCommission: res.referralEggCommission,
    });
    showToast(`+${res.collected.toLocaleString()} eggs collected`);
  };

  const handleBuyChickens = async (breed: ChickenBreedId, qty: number) => {
    await ensurePromiseRef.current;
    const current = latestProfileRef.current;
    const now = Date.now();
    const res = buyChickens(current, breed, qty, now);
    if ('error' in res) {
      showToast(res.error);
      return;
    }
    playCoinChimeSound(soundsEnabled);
    triggerHapticFeedback('medium');
    await persistMutation({
      nextProfile: res.profile,
      transaction: res.transaction,
      activateReferral: res.shouldActivateReferral,
    });
    if (res.shouldActivateReferral) {
      showToast(`Purchased ${qty} chicken${qty > 1 ? 's' : ''} & activated referral reward!`);
    } else {
      showToast(`Purchased ${qty} chicken${qty > 1 ? 's' : ''}!`);
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

    try {
      const notifyRes = await fetch('/api/withdraw/notify', {
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
      const notifyData = (await notifyRes.json()) as { sent?: boolean; channel?: string };
      if (notifyData.sent) {
        showToast(
          `Withdrawal pending Admin approval — notified ${notifyData.channel || '@AG_PAYOUTS'}!`,
        );
        return;
      }
    } catch {
      // Non-fatal notification failure
    }
    showToast(`Withdrawal submitted (${res.withdrawal.gramAmount} GRAM) — Pending Admin approval`);
  };

  const handleReviewWithdrawal = async (
    request: WithdrawRequestRecord,
    decision: 'approved' | 'rejected',
    adminNote: string,
  ) => {
    try {
      await reviewWithdrawalInFirestore({ request, decision, adminNote });
      try {
        await fetch('/api/withdraw/notify', {
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
      } catch {
        // Non-fatal Telegram notification error
      }
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
    category: TaskDefinition['category'];
    rewardCoins: number;
    icon: string;
    actionUrl: string;
  }) => {
    try {
      await createCustomTaskInFirestore(input);
      showToast(`Added task "${input.title}"!`);
    } catch {
      showToast('Failed to add custom task.');
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

  const handleSaveAdConfig = async (cfg: Omit<AdConfig, 'updatedAtMs'>) => {
    try {
      const saved = await saveAdConfigInFirestore(cfg);
      setAdConfig(saved);
      showToast('Ad settings saved!');
    } catch {
      showToast('Failed to save ad settings.');
    }
  };

  const handleCreatePromoCode = async (input: {
    code: string;
    label: string;
    coins: number;
    maxUses: number;
    expiresInHours: number;
  }) => {
    try {
      const created = await createPromoCodeInFirestore(input);
      showToast(`Promo code ${created.code} created (+${created.coins} coins)!`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create promo code.');
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

  const handleClaimPromo = (code: string) => {
    const now = Date.now();
    const res = claimPromoCode(profile, code, now, promoCodes);
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
    if (res.dynamicPromoCode) {
      void incrementPromoCodeUseInFirestore(res.dynamicPromoCode);
    }
    showToast(`Promo claimed: +${res.rewardCoins} coins (${res.label})!`);
  };

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
    showToast(`Task complete: +${res.rewardCoins} coins!`);
  };

  const handleWatchAd = () => {
    const now = Date.now();
    const res = watchAdStep(profile, now);
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

  const handleTriggerWatchAd = async () => {
    if (watchingAdLoading) return;
    setWatchingAdLoading(true);
    try {
      const external = await tryRunExternalRewardedAd(adConfig);
      if (external.handled) {
        if (external.rewarded) {
          handleWatchAd();
        } else {
          showToast('Watch the full ad to earn your reward.');
        }
        return;
      }
      setAdModalState({ open: true, notice: external.message ?? null });
    } finally {
      setWatchingAdLoading(false);
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
          onBack={() => setSubView('none')}
          onUpgradeBasket={handleUpgradeBasket}
          onGoPacks={() => {
            setSubView('none');
            setActiveTab('packs');
          }}
          onToggleNotifications={() => void handleToggleNotifications()}
          onActivateBooster={handleActivateBooster}
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
          onBack={() => setSubView('none')}
          onConfirmWithdraw={handleConfirmWithdraw}
        />
      );
    }

    if (activeTab === 'packs') {
      return (
        <PacksView
          profile={profile}
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
          onTabTap={() => playTabTapSound(soundsEnabled)}
          onClaimPromo={handleClaimPromo}
          onClaimDaily={handleClaimDaily}
          onCompleteTask={handleCompleteTask}
          onTriggerWatchAd={() => void handleTriggerWatchAd()}
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
      <div className="animate-clay-enter space-y-4">
        <div className="clay-card p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-extrabold text-stone-900 dark:text-stone-100">Farm Economy Overview</h2>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                Auto-saved live to Firestore · User ID{' '}
                <span className="font-mono-num font-bold text-stone-700 dark:text-stone-200">
                  {getPrimaryDepositMemo(profile.uid)}
                </span>
              </p>
            </div>
            <span className="clay-card-mint !rounded-xl inline-flex items-center gap-1 text-xs font-extrabold text-emerald-700 dark:text-emerald-300 px-3 py-1.5 shrink-0">
              <CheckCircle2 className="w-4 h-4" />
              <span>Database Live</span>
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="clay-card-warm !rounded-2xl p-3">
              <div className="text-xs font-bold text-stone-500 dark:text-stone-400">Production</div>
              <div className="text-lg font-extrabold text-stone-900 dark:text-stone-100 font-mono-num mt-0.5">
                {productionRate} /h
              </div>
            </div>
            <div className="clay-card-mint !rounded-2xl p-3">
              <div className="text-xs font-bold text-stone-500 dark:text-stone-400">Referrals</div>
              <div className="text-lg font-extrabold text-stone-900 dark:text-stone-100 font-mono-num mt-0.5 flex items-center gap-1">
                <Users className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>{profile.referralCount}</span>
              </div>
            </div>
            <div className="clay-inset !rounded-2xl p-3">
              <div className="text-xs font-bold text-stone-500 dark:text-stone-400">Buyer Rank</div>
              <div className="text-lg font-extrabold text-stone-900 dark:text-stone-100 font-mono-num mt-0.5">
                #{rankings.userBuyerRank}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2">
            <button
              type="button"
              onClick={() => navigateTab('packs')}
              className="clay-btn clay-btn-amber min-h-[44px] rounded-2xl font-extrabold text-xs flex items-center justify-center gap-1.5"
            >
              <Package className="w-4 h-4" />
              <span>Buy Hens</span>
            </button>
            <button
              type="button"
              onClick={() => openSubView('deposit')}
              className="clay-btn clay-btn-emerald min-h-[44px] rounded-2xl font-extrabold text-xs flex items-center justify-center gap-1.5"
            >
              <ArrowDownLeft className="w-4 h-4" />
              <span>{strings.deposit}</span>
            </button>
            <button
              type="button"
              onClick={() => openSubView('withdraw')}
              className="clay-btn clay-btn-sky min-h-[44px] rounded-2xl font-extrabold text-xs flex items-center justify-center gap-1.5"
            >
              <ArrowUpRight className="w-4 h-4" />
              <span>{strings.withdraw}</span>
            </button>
            <button
              type="button"
              onClick={() => openSubView('leaderboard')}
              className="clay-btn clay-btn-neutral min-h-[44px] rounded-2xl text-stone-800 dark:text-stone-100 font-extrabold text-xs flex items-center justify-center gap-1.5"
            >
              <Trophy className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <span>{strings.top10}</span>
            </button>
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
      {toastText && (
        <div
          role="status"
          aria-live="polite"
          className="animate-clay-toast clay-card-dark fixed bottom-20 left-1/2 z-50 !rounded-2xl text-white px-4 py-2.5 text-xs sm:text-sm font-bold whitespace-nowrap"
        >
          {toastText}
        </div>
      )}

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
              onCollect={handleCollectEggs}
              onOpenYourFarm={() => openSubView('your_farm')}
              onChickenTap={() => {
                playSoftTapSound(soundsEnabled);
                triggerHapticFeedback('light');
              }}
              onGoldenEggDrop={handleGoldenEggTap}
              onActivateBooster={handleActivateBooster}
            />
          </div>

          {/* Right / Active Workspace View */}
          <div className={`lg:col-span-7 ${showFarmOnMobile ? 'hidden lg:block' : 'block'}`}>
            {renderContextualPanel()}
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

      {!showSplash && showSignUpBonusModal && (
        <SignUpBonusModal
          onClaim={() => {
            playClaimSound(soundsEnabled);
            setShowSignUpBonusModal(false);
            try {
              localStorage.setItem(`chickenland_signup_bonus_seen_${activePlayerId}`, '1');
            } catch {
              // ignore storage errors
            }
            showToast('+1,000 Sign-Up Bonus Coins ready!');
          }}
        />
      )}

      {!showSplash && showWelcomeModal && !showSignUpBonusModal && (
        <WelcomeBackModal
          pendingEggs={pendingEggs}
          awayLabel={formatAwayDuration(nowMs - profile.lastCollectedAt)}
          onCollect={handleCollectEggs}
          onDismiss={() => setShowWelcomeModal(false)}
          headingText={strings.welcomeBack}
          collectLabel={strings.collect}
        />
      )}

      {adModalState.open && (
        <RewardedAdModal
          adConfig={adConfig}
          watchedCount={profile.watchedAdsCount}
          fallbackNotice={adModalState.notice}
          onComplete={() => {
            setAdModalState({ open: false, notice: null });
            handleWatchAd();
          }}
          onClose={() => setAdModalState({ open: false, notice: null })}
        />
      )}

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
      <OfflineIndicator />
    </div>
  );
}
