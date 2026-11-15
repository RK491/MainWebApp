import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activateFeedBooster,
  AD_EXEMPT_ACTIONS,
  AD_GATED_ACTIONS,
  AD_NETWORK_TASKS,
  buildDeterministicDepositIds,
  buildEarningsChartSeries,
  buildInvitedFriendsList,
  buildLeaderboardRankings,
  buildReferralGrowthSeries,
  buyChickens,
  calculateBuyerPoints,
  calculateLevelYieldMultiplier,
  calculatePaidTaskCost,
  calculatePendingEggs,
  calculateProductionRate,
  calculateReferralBonusEggs,
  calculateReferralEggCommission,
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
  createDepositQuote,
  createPaidTaskOrder,
  decodeAchievementsAndAds,
  decodePromoLabelMeta,
  decodeTaskSubtitleMeta,
  DEFAULT_GRAM_DEPOSIT_ADDRESS,
  DEFAULT_GRAM_JETTON_MASTER,
  detectTop10RankCelebration,
  encodeAchievementsWithAds,
  encodePromoLabelMeta,
  encodeTaskSubtitleMeta,
  executeDeposit,
  executeWithdrawal,
  extractTelegramNumericUserId,
  FEED_BOOSTER_COST_COINS,
  FEED_BOOSTER_DURATION_MS,
  filterWithdrawalsByTab,
  formatPromoRewardSummary,
  formatReferralHandle,
  generateGiftCodeString,
  getAchievementsProgress,
  getAdNetworkClaimCountToday,
  getChickenMilestoneReached,
  getTaskRemainingSlots,
  getTotalAdsWatched,
  getWithdrawalStatusMeta,
  getWithdrawAdGateStatus,
  GOLDEN_EGG_COOLDOWN_MS,
  GOLDEN_EGG_REWARD_COINS,
  GOLDEN_EGG_REWARD_XP,
  gramToCoins,
  isFeedBoosterActive,
  isGoldenEggReady,
  isTelegramMemberStatusJoined,
  MAX_DEPOSIT_COINS,
  mergeTaskDefinitions,
  MIN_DEPOSIT_COINS,
  MIN_WITHDRAW_ADS_WATCHED,
  REFERRAL_MILESTONE_CRATES,
  REFERRER_LIFETIME_EGG_COMMISSION_RATE,
  REFERRER_SIGNUP_BONUS_COINS,
  REFERRER_SIGNUP_BONUS_EGGS,
  reinvestEggs,
  recordCompletedGateAd,
  REQUIRED_TELEGRAM_CHANNELS,
  shouldRequireAdForAction,
  SIGNUP_BONUS_COINS,
  sortTasks,
  summarizeReferrals,
  upgradeBasket,
  watchAdStep,
} from './economy';
import { hasConfiguredAdNetworkSdk, resolveEffectiveAdConfig } from '../utils/ads';
import {
  buildAcceptedDepositMemos,
  buildGramTransferUrl,
  friendlyTonAddressToRaw,
  getPrimaryDepositMemo,
  matchGramTransfersFromTonApiEvents,
  matchGramTransfersFromTonCenter,
  normalizeTxHash,
  OFFICIAL_GRAM_RAW_MASTER,
  type RejectedGramTransfer,
} from './tonGram';
import {
  calculateMsUntilBasketFull,
  shouldTriggerBasketFullNotification,
} from '../utils/notifications';
import { getTelegramChannelUrl, resolveTelegramUserIdentity } from '../utils/telegram';
import { isValidLanguageCode, LANGUAGE_OPTIONS, t } from '../utils/i18n';
import {
  THEME_STORAGE_KEY,
  applyThemeToDocument,
  getStoredTheme,
  isValidThemeMode,
  setStoredTheme,
} from '../utils/theme';
import {
  buildPersonalReferralUrl,
  buildReferralShareData,
  shareReferralLink,
} from '../utils/referralShare';
import {
  AUDIO_SETTINGS_STORAGE_KEY,
  computeMuteAllToggle,
  DEFAULT_AUDIO_SETTINGS,
  getStoredAudioSettings,
  isAllAudioMuted,
  setStoredAudioSettings,
} from '../utils/sound';

const NOW = 1_794_580_000_000;

test('mining does not start before buying a chicken, and starts cleanly after purchase with basketCapacity cap', () => {
  const { profile } = createDefaultProfile('player_test1', 'RK', '@rk', NOW);
  assert.equal(profile.leghornCount, 0);
  assert.equal(profile.boughtThisWeek, 0);
  assert.equal(calculateProductionRate(profile), 0);
  assert.equal(calculateBuyerPoints(profile), 0);

  // Even 24 hours later, zero eggs are mined until a chicken/miner is bought
  const withoutMiner = NOW + 24 * 60 * 60 * 1000;
  assert.equal(calculatePendingEggs(profile, withoutMiner), 0);
  assert.ok('error' in collectEggs(profile, withoutMiner));

  // Buying 1st chicken at `withoutMiner` starts mining from `withoutMiner` (0 retroactive eggs)
  const firstBuy = buyChickens(profile, 'leghorn', 1, withoutMiner);
  assert.ok(!('error' in firstBuy));
  assert.equal(firstBuy.profile.lastCollectedAt, withoutMiner);
  assert.equal(calculatePendingEggs(firstBuy.profile, withoutMiner), 0);
  assert.equal(calculateProductionRate(firstBuy.profile), 8);

  // With 2 Leghorns, 4 hours produces 64 eggs and caps at basketCapacity
  const twoHensProfile = { ...firstBuy.profile, leghornCount: 2, lastCollectedAt: NOW };
  assert.equal(calculateProductionRate(twoHensProfile), 16); // 2 * 8 = 16 eggs/h
  assert.equal(calculateBuyerPoints(twoHensProfile), 2);

  const later = NOW + 4 * 60 * 60 * 1000;
  const pending = calculatePendingEggs(twoHensProfile, later);
  assert.equal(pending, 64);

  const capped = calculatePendingEggs(twoHensProfile, NOW + 100 * 60 * 60 * 1000);
  assert.equal(capped, twoHensProfile.basketCapacity);
});

test('collectEggs increments balance, resets timer, and computes 5% lifetime referral egg commission', () => {
  const { profile, transactions } = createDefaultProfile('player_test1', 'RK', '@rk', NOW);
  assert.equal(profile.coins, SIGNUP_BONUS_COINS);
  assert.equal(SIGNUP_BONUS_COINS, 1000);
  assert.equal(profile.eggs, 0);
  assert.equal(profile.totalEggsCollected, 0);
  assert.equal(profile.totalCashEarnedUsd, 0);
  assert.equal(transactions[0].amount, 1000);

  const result = collectEggs(profile, NOW + 3600 * 1000, 50);
  assert.ok(!('error' in result));
  assert.equal(result.collected, 50);
  assert.equal(result.profile.eggs, 50);
  assert.equal(result.transaction.type, 'collect');
  assert.equal(result.transaction.amount, 50);
  assert.equal(result.referralEggCommission, 0);

  const referredResult = collectEggs(
    { ...profile, referredBy: 'tg_referrer_99' },
    NOW + 3600 * 1000,
    100,
  );
  assert.ok(!('error' in referredResult));
  assert.equal(referredResult.referralEggCommission, 5);
});

test('buyChickens deducts coins and increases production', () => {
  const { profile } = createDefaultProfile('player_test1', 'RK', '@rk', NOW);
  const res = buyChickens(profile, 'leghorn', 1, NOW);
  assert.ok(!('error' in res));
  assert.equal(res.profile.coins, 0);
  assert.equal(res.profile.leghornCount, 1);
  assert.equal(calculateProductionRate(res.profile), 8);

  const fail = buyChickens(res.profile, 'orpington', 1, NOW);
  assert.ok('error' in fail);
});

test('GRAM-only deposit enforces 1k-15k limits, requires txHash, converts GRAM to coins, and computes 5% referrer commission', () => {
  const quote = createDepositQuote(5000, 'GRAM_TON');
  assert.equal(quote.bonusCoins, 0);
  assert.equal(quote.totalCoins, 5000);
  assert.equal(quote.depositAddress, DEFAULT_GRAM_DEPOSIT_ADDRESS);
  assert.ok(quote.cryptoAmount.endsWith('GRAM'));

  // Clamps quotes below 1k and above 15k
  assert.equal(createDepositQuote(200, 'GRAM_TON').totalCoins, MIN_DEPOSIT_COINS);
  assert.equal(createDepositQuote(50000, 'GRAM_TON').totalCoins, MAX_DEPOSIT_COINS);

  const { profile } = createDefaultProfile('player_test1', 'RK', '@rk', NOW);
  profile.referredBy = 'player_referrer';

  const missingHash = executeDeposit(profile, 5000, 'GRAM_TON', NOW, '');
  assert.ok('error' in missingHash);

  const belowMin = executeDeposit(profile, 500, 'GRAM_TON', NOW, 'tx_low_1', 0.01);
  assert.ok('error' in belowMin);

  const aboveMax = executeDeposit(profile, 20000, 'GRAM_TON', NOW, 'tx_high_1', 2.0);
  assert.ok('error' in aboveMax);

  const first = executeDeposit(profile, 10000, 'GRAM_TON', NOW, 'tx_gram_123', 1.0);
  assert.ok(!('error' in first));
  assert.equal(first.deposit.bonusCoins, 0);
  assert.equal(first.deposit.coinsAmount, gramToCoins(1.0));
  assert.equal(first.deposit.cryptoAmount, '1.0000 GRAM');
  assert.equal(first.deposit.txHash, 'tx_gram_123');
  assert.equal(first.profile.coins, 1000 + gramToCoins(1.0));
  assert.equal(first.referrerCommissionCoins, Math.round(gramToCoins(1.0) * 0.05));

  // Deterministic IDs match across repeated calls for idempotent Firestore protection
  const second = executeDeposit(profile, 10000, 'GRAM_TON', NOW + 5000, 'tx_gram_123', 1.0);
  assert.ok(!('error' in second));
  assert.equal(second.deposit.id, first.deposit.id);
  assert.equal(second.transaction.id, first.transaction.id);
});

test('reinvestEggs converts eggs to coins with 20% bonus', () => {
  const { profile } = createDefaultProfile('player_test1', 'RK', '@rk', NOW);
  const res = reinvestEggs({ ...profile, eggs: 500 }, 500, NOW);
  assert.ok(!('error' in res));
  assert.equal(res.profile.eggs, 0);
  assert.equal(res.coinsReceived, 42);
  assert.equal(res.profile.coins, 1042);
});

test('executeWithdrawal enforces 30-ad watch gate, validates address and balance, and records withdrawal', () => {
  const { profile } = createDefaultProfile('player_test1', 'RK', '@rk', NOW);
  const unwatchedProfile = { ...profile, eggs: 500, totalAdsWatched: 29 };
  const blockedByAds = executeWithdrawal(
    unwatchedProfile,
    200,
    'UQB06dO9oc06d-1c8DF03FLdCznEHz_aLIA69fxzITcunwpr',
    '',
    NOW,
  );
  assert.ok('error' in blockedByAds);
  assert.match(blockedByAds.error, /30 ads/i);

  const fundedProfile = { ...profile, eggs: 500, totalAdsWatched: MIN_WITHDRAW_ADS_WATCHED };
  const badAddr = executeWithdrawal(fundedProfile, 200, 'abc', '', NOW);
  assert.ok('error' in badAddr);

  const tooMuch = executeWithdrawal(fundedProfile, 5000, 'UQB06dO9oc06d-1c8DF03FLdCznEHz_aLIA69fxzITcunwpr', '', NOW);
  assert.ok('error' in tooMuch);

  const ok = executeWithdrawal(fundedProfile, 200, 'UQB06dO9oc06d-1c8DF03FLdCznEHz_aLIA69fxzITcunwpr', '1234', NOW);
  assert.ok(!('error' in ok));
  assert.equal(ok.profile.eggs, 300);
  assert.equal(ok.withdrawal.eggsAmount, 200);
  assert.equal(ok.withdrawal.memo, '1234');
  assert.equal(ok.withdrawal.status, 'pending');
  assert.equal(ok.transaction.status, 'pending');
  assert.equal(ok.transaction.type, 'withdraw');
  assert.equal(getWithdrawalStatusMeta(ok.withdrawal.status).label, 'Pending Approval');
  assert.equal(getWithdrawalStatusMeta('approved').label, 'Approved');
  assert.equal(getWithdrawalStatusMeta('rejected').label, 'Rejected');
});

test('daily streak and promo codes prevent duplicate claims', () => {
  const { profile } = createDefaultProfile('player_test1', 'RK', '@rk', NOW);
  const d1 = claimDailyStreak(profile, '2026-11-13', NOW);
  assert.ok(!('error' in d1));
  assert.equal(d1.rewardCoins, 30);

  const d1Again = claimDailyStreak(d1.profile, '2026-11-13', NOW + 5000);
  assert.ok('error' in d1Again);

  const p1 = claimPromoCode(d1.profile, 'chicken2026', NOW);
  assert.ok(!('error' in p1));
  assert.equal(p1.rewardCoins, 500);

  const p1Again = claimPromoCode(p1.profile, 'CHICKEN2026', NOW + 1000);
  assert.ok('error' in p1Again);
});

test('upgradeBasket upgrades 8h to 12h and leaderboard ranks buyers, inviters, and eggs', () => {
  const { profile } = createDefaultProfile('player_test1', 'RK', '@rk', NOW);
  const dep = executeDeposit(profile, 10000, 'GRAM_TON', NOW, 'tx_upgrade_1');
  assert.ok(!('error' in dep));
  const up = upgradeBasket(dep.profile, NOW + 1000);
  assert.ok(!('error' in up));
  assert.equal(up.profile.basketTierHours, 12);

  const lb = buildLeaderboardRankings(
    [
      {
        uid: 'player_other',
        displayName: 'Other',
        handle: '@other',
        photoUrl: '',
        avatarColor: '#10B981',
        referralCode: 'CL-OTHER1',
        buyerPoints: 5,
        inviterCount: 3,
        eggs: 900,
        totalEggsCollected: 900,
        chickensCount: 5,
      },
    ],
    up.profile,
  );
  assert.equal(lb.topBuyers[0].uid, 'player_other');
  assert.equal(lb.topInviters[0].uid, 'player_other');
  assert.equal(lb.topEggs[0].uid, 'player_other');
});

test('resolveTelegramUserIdentity auto-detects Telegram user and query fallback + channel URLs', () => {
  const fromSdk = resolveTelegramUserIdentity({
    tgUser: {
      id: 778899,
      first_name: 'Rahul',
      last_name: 'Verma',
      username: 'rahulv',
      photo_url: 'https://t.me/i/userpic/320/rahulv.jpg',
    },
    startParam: 'CL-REF999',
  });
  assert.equal(fromSdk.playerId, 'tg_778899');
  assert.equal(fromSdk.displayName, 'Rahul Verma');
  assert.equal(fromSdk.handle, '@rahulv');
  assert.equal(fromSdk.photoUrl, 'https://t.me/i/userpic/320/rahulv.jpg');
  assert.equal(fromSdk.startParam, 'CL-REF999');
  assert.equal(fromSdk.isTelegramDetected, true);

  const fromQuery = resolveTelegramUserIdentity({
    search: '?tg_id=112233&tg_name=Aryan&tg_username=aryantest&tg_photo=https://example.com/p.png',
  });
  assert.equal(fromQuery.playerId, 'tg_112233');
  assert.equal(fromQuery.displayName, 'Aryan');
  assert.equal(fromQuery.handle, '@aryantest');
  assert.equal(fromQuery.photoUrl, 'https://example.com/p.png');
  assert.equal(fromQuery.isTelegramDetected, true);

  assert.equal(getTelegramChannelUrl('@AIRDROP_GALAXYS'), 'https://t.me/AIRDROP_GALAXYS');
  assert.equal(getTelegramChannelUrl('@AG_PAYOUTS'), 'https://t.me/AG_PAYOUTS');
});

test('matchGramTransfersFromTonApiEvents rejects spam, fake GRAM tokens, unconfirmed/failed txs, and out-of-range amounts', () => {
  const rawRecipient = friendlyTonAddressToRaw(DEFAULT_GRAM_DEPOSIT_ADDRESS)!;
  assert.ok(rawRecipient.startsWith('0:'));
  assert.equal(friendlyTonAddressToRaw(DEFAULT_GRAM_JETTON_MASTER), OFFICIAL_GRAM_RAW_MASTER);

  const rejected: RejectedGramTransfer[] = [];
  const fakeJettonRaw = '0:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

  const matched = matchGramTransfersFromTonApiEvents({
    rawDepositAddress: rawRecipient,
    memo: 'CL-TEST12',
    claimedTxHashes: ['already_claimed_hash'],
    onRejected: (info) => rejected.push(info),
    events: [
      {
        event_id: 'already_claimed_hash',
        in_progress: false,
        timestamp: 1794580000,
        actions: [
          {
            type: 'JettonTransfer',
            status: 'ok',
            JettonTransfer: {
              amount: '1000000000',
              comment: 'CL-TEST12',
              recipient: { address: rawRecipient },
              jetton: { address: OFFICIAL_GRAM_RAW_MASTER, symbol: 'GRAM', decimals: 9 },
            },
          },
        ],
      },
      {
        // Unconfirmed / in-progress must NOT credit coins
        event_id: 'pending_hash_001',
        in_progress: true,
        timestamp: 1794580050,
        actions: [
          {
            type: 'JettonTransfer',
            status: 'ok',
            JettonTransfer: {
              amount: '1000000000',
              comment: 'CL-TEST12',
              recipient: { address: rawRecipient },
              jetton: { address: OFFICIAL_GRAM_RAW_MASTER, symbol: 'GRAM', decimals: 9 },
            },
          },
        ],
      },
      {
        // Fake jetton with symbol GRAM must NOT credit coins
        event_id: 'fake_gram_hash_001',
        in_progress: false,
        timestamp: 1794580060,
        actions: [
          {
            type: 'JettonTransfer',
            status: 'ok',
            JettonTransfer: {
              amount: '1000000000',
              comment: 'CL-TEST12',
              recipient: { address: rawRecipient },
              jetton: { address: fakeJettonRaw, symbol: 'GRAM', decimals: 9 },
            },
          },
        ],
      },
      {
        // Below 1,000 coins minimum (0.01 GRAM = 113 coins) must NOT credit
        event_id: 'below_min_hash_001',
        in_progress: false,
        timestamp: 1794580070,
        actions: [
          {
            type: 'JettonTransfer',
            status: 'ok',
            JettonTransfer: {
              amount: '10000000',
              comment: 'CL-TEST12',
              recipient: { address: rawRecipient },
              jetton: { address: OFFICIAL_GRAM_RAW_MASTER, symbol: 'GRAM', decimals: 9 },
            },
          },
        ],
      },
      {
        // Above 15,000 coins maximum (2.0 GRAM = 22,660 coins) must NOT credit
        event_id: 'above_max_hash_001',
        in_progress: false,
        timestamp: 1794580080,
        actions: [
          {
            type: 'JettonTransfer',
            status: 'ok',
            JettonTransfer: {
              amount: '2000000000',
              comment: 'CL-TEST12',
              recipient: { address: rawRecipient },
              jetton: { address: OFFICIAL_GRAM_RAW_MASTER, symbol: 'GRAM', decimals: 9 },
            },
          },
        ],
      },
      {
        // Valid confirmed GRAM transfer within 1k-15k range (0.5 GRAM = 5,665 coins)
        event_id: 'fresh_gram_hash_001',
        in_progress: false,
        timestamp: 1794580100,
        actions: [
          {
            type: 'JettonTransfer',
            status: 'ok',
            JettonTransfer: {
              amount: '500000000',
              comment: 'CL-TEST12',
              recipient: { address: rawRecipient },
              jetton: { address: OFFICIAL_GRAM_RAW_MASTER, symbol: 'GRAM', decimals: 9, verification: 'whitelist' },
            },
          },
        ],
      },
      {
        event_id: 'other_user_hash',
        in_progress: false,
        timestamp: 1794580200,
        actions: [
          {
            type: 'JettonTransfer',
            status: 'ok',
            JettonTransfer: {
              amount: '500000000',
              comment: 'CL-OTHER9',
              recipient: { address: rawRecipient },
              jetton: { address: OFFICIAL_GRAM_RAW_MASTER, symbol: 'GRAM', decimals: 9 },
            },
          },
        ],
      },
    ],
  });

  assert.equal(matched.length, 1);
  assert.equal(matched[0].txHash, 'fresh_gram_hash_001');
  assert.equal(matched[0].gramAmount, 0.5);
  assert.equal(matched[0].coinsToCredit, gramToCoins(0.5));
  assert.deepEqual(
    rejected.map((r) => r.reason),
    ['pending', 'fake_token', 'below_min', 'above_max'],
  );
});

test('referral bonus constants and 5% lifetime egg commission calculate accurately', () => {
  assert.equal(REFERRER_SIGNUP_BONUS_COINS, 150);
  assert.equal(REFERRER_LIFETIME_EGG_COMMISSION_RATE, 0.05);
  assert.equal(calculateReferralEggCommission(0), 0);
  assert.equal(calculateReferralEggCommission(10), 1);
  assert.equal(calculateReferralEggCommission(100), 5);
  assert.equal(calculateReferralEggCommission(300), 15);

  assert.equal(calculateReferralBonusEggs(0), 0);
  assert.equal(calculateReferralBonusEggs(200), REFERRER_SIGNUP_BONUS_EGGS);
  assert.equal(calculateReferralBonusEggs(400), 1000);
});

test('basket-full browser notification triggers only when full, in background, enabled, granted, and once per cycle', () => {
  const base = {
    pendingEggs: 300,
    basketCapacity: 300,
    lastCollectedAt: NOW,
    lastNotifiedCollectedAt: null as number | null,
    isBackgrounded: true,
    notificationsEnabled: true,
    permission: 'granted' as const,
  };

  // Triggers when all criteria are satisfied
  assert.equal(shouldTriggerBasketFullNotification(base), true);

  // Does not trigger when foregrounded or not full
  assert.equal(shouldTriggerBasketFullNotification({ ...base, isBackgrounded: false }), false);
  assert.equal(shouldTriggerBasketFullNotification({ ...base, pendingEggs: 299 }), false);

  // Does not trigger when disabled or permission not granted
  assert.equal(shouldTriggerBasketFullNotification({ ...base, notificationsEnabled: false }), false);
  assert.equal(shouldTriggerBasketFullNotification({ ...base, permission: 'default' }), false);
  assert.equal(shouldTriggerBasketFullNotification({ ...base, permission: 'denied' }), false);

  // Prevents duplicate alert in the same cycle, then resets after next collection
  assert.equal(
    shouldTriggerBasketFullNotification({ ...base, lastNotifiedCollectedAt: NOW }),
    false,
  );
  assert.equal(
    shouldTriggerBasketFullNotification({
      ...base,
      lastCollectedAt: NOW + 10_000,
      lastNotifiedCollectedAt: NOW,
    }),
    true,
  );

  // Timing helper calculates exact remaining ms until basket capacity is reached
  const ms = calculateMsUntilBasketFull({
    productionRatePerHour: 100,
    basketCapacity: 300,
    lastCollectedAt: NOW,
    nowMs: NOW + 3_600_000, // 1h elapsed out of 3h needed
  });
  assert.equal(ms, 7_200_000);
  assert.equal(
    calculateMsUntilBasketFull({
      productionRatePerHour: 0,
      basketCapacity: 300,
      lastCollectedAt: NOW,
      nowMs: NOW,
    }),
    null,
  );
});

test('custom admin tasks merge with built-in tasks and reward coins upon completion', () => {
  const { profile } = createDefaultProfile('player_test1', 'RK', '@rk', NOW);
  const customTasks = [
    {
      id: 'task_admin_1',
      category: 'partner' as const,
      title: 'Join @AIRDROP_GALAXYS',
      rewardCoins: 450,
      icon: 'send',
      actionUrl: 'https://t.me/AIRDROP_GALAXYS',
      isCustom: true,
      isActive: true,
      createdAtMs: NOW,
    },
    {
      id: 'task_admin_paused',
      category: 'daily' as const,
      title: 'Paused Task',
      rewardCoins: 999,
      icon: 'gift',
      isCustom: true,
      isActive: false,
      createdAtMs: NOW,
    },
  ];

  const merged = mergeTaskDefinitions(customTasks);
  assert.ok(merged.some((t) => t.id === 'task_admin_1'));
  assert.ok(!merged.some((t) => t.id === 'task_admin_paused'));

  const done = completeTask(profile, 'task_admin_1', NOW, customTasks);
  assert.ok(!('error' in done));
  assert.equal(done.rewardCoins, 450);
  assert.equal(done.profile.coins, 1450);
  assert.ok(done.profile.completedTaskIds.includes('task_admin_1'));

  const duplicate = completeTask(done.profile, 'task_admin_1', NOW + 1000, customTasks);
  assert.ok('error' in duplicate);
});

test('referred player activates referral only on 1st chicken purchase and summarizeReferrals separates pending vs active', () => {
  const { profile } = createDefaultProfile('player_referred1', 'Priya Sharma', '@priya', NOW);
  assert.equal(profile.referralActivated, false);

  // Without referredBy, buying 1st chicken sets referralActivated=true but shouldActivateReferral=false
  const nonRefBuy = buyChickens(profile, 'leghorn', 1, NOW);
  assert.ok(!('error' in nonRefBuy));
  assert.equal(nonRefBuy.profile.referralActivated, true);
  assert.equal(nonRefBuy.shouldActivateReferral, false);

  // With referredBy, 1st chicken purchase activates referral once, 2nd purchase does not re-trigger
  const referredProfile = { ...profile, referredBy: 'tg_referrer1', coins: 2100 };
  const firstBuy = buyChickens(referredProfile, 'leghorn', 1, NOW);
  assert.ok(!('error' in firstBuy));
  assert.equal(firstBuy.profile.referralActivated, true);
  assert.equal(firstBuy.shouldActivateReferral, true);

  const secondBuy = buyChickens(firstBuy.profile, 'leghorn', 1, NOW + 1000);
  assert.ok(!('error' in secondBuy));
  assert.equal(secondBuy.shouldActivateReferral, false);

  const summary = summarizeReferrals([
    {
      id: 'u_pending',
      referrerUid: 'tg_referrer1',
      referredUid: 'u_pending',
      referredName: 'Pending User',
      referredHandle: '@pending',
      status: 'pending',
      coinsEarned: 0,
      toppedUpUsd: 0,
      createdAtMs: NOW,
    },
    {
      id: 'u_active',
      referrerUid: 'tg_referrer1',
      referredUid: 'u_active',
      referredName: 'Priya Sharma',
      referredHandle: '@priya',
      status: 'active',
      coinsEarned: 200,
      toppedUpUsd: 0,
      createdAtMs: NOW + 1000,
    },
  ]);
  assert.equal(summary.pendingCount, 1);
  assert.equal(summary.activeCount, 1);
  assert.equal(summary.totalBonusEggs, REFERRER_SIGNUP_BONUS_EGGS);
});

test('getChickenMilestoneReached detects 5, 10, 25 milestones and detectTop10RankCelebration guards initial load', () => {
  assert.equal(getChickenMilestoneReached(1, 4), null);
  const m5 = getChickenMilestoneReached(4, 5);
  assert.ok(m5);
  assert.equal(m5.threshold, 5);
  assert.equal(m5.badge, '5 Hens');

  const m10 = getChickenMilestoneReached(9, 10);
  assert.ok(m10);
  assert.equal(m10.threshold, 10);

  // Jumping across two milestones returns the highest milestone reached
  const m25 = getChickenMilestoneReached(8, 25);
  assert.ok(m25);
  assert.equal(m25.threshold, 25);

  assert.equal(getChickenMilestoneReached(10, 10), null);
  assert.equal(getChickenMilestoneReached(12, 10), null);

  // Top 10 celebration must suppress initial load and celebrate entering or climbing inside Top 10
  assert.equal(detectTop10RankCelebration({ previousRank: 11, nextRank: 6, hasInitialized: false }), false);
  assert.equal(detectTop10RankCelebration({ previousRank: null, nextRank: 1, hasInitialized: true }), false);
  assert.equal(detectTop10RankCelebration({ previousRank: 12, nextRank: 9, hasInitialized: true }), true);
  assert.equal(detectTop10RankCelebration({ previousRank: 6, nextRank: 3, hasInitialized: true }), true);
  assert.equal(detectTop10RankCelebration({ previousRank: 4, nextRank: 4, hasInitialized: true }), false);
  assert.equal(detectTop10RankCelebration({ previousRank: 4, nextRank: 7, hasInitialized: true }), false);
  assert.equal(detectTop10RankCelebration({ previousRank: 15, nextRank: 11, hasInitialized: true }), false);
});

test('matchGramTransfersFromTonCenter detects valid GRAM jetton transfers, builds deep links, and deduplicates base64/hex hashes', () => {
  const rawRecipient = friendlyTonAddressToRaw(DEFAULT_GRAM_DEPOSIT_ADDRESS)!;
  const sampleHex = 'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00';
  const sampleBase64 = Buffer.from(sampleHex, 'hex').toString('base64');
  assert.equal(normalizeTxHash(sampleBase64), sampleHex);

  const matched = matchGramTransfersFromTonCenter({
    rawDepositAddress: rawRecipient,
    memo: 'CL-TON123',
    claimedTxHashes: [sampleHex],
    transfers: [
      {
        transaction_hash: sampleBase64,
        amount: '800000000',
        destination: '0:jetton_wallet_address',
        destination_address: rawRecipient,
        jetton_master: OFFICIAL_GRAM_RAW_MASTER,
        transaction_now: 1794580000,
        decoded_payload: { type: 'comment', comment: 'CL-TON123' },
      },
      {
        transaction_hash: 'aborted_tc_hash',
        transaction_aborted: true,
        amount: '800000000',
        destination: '0:jetton_wallet_address',
        destination_address: rawRecipient,
        jetton_master: OFFICIAL_GRAM_RAW_MASTER,
        transaction_now: 1794580100,
        decoded_payload: { type: 'comment', comment: 'CL-TON123' },
      },
      {
        transaction_hash: 'fresh_tc_hash_002',
        amount: '1000000000',
        destination: '0:jetton_wallet_address',
        destination_address: rawRecipient,
        jetton_master: OFFICIAL_GRAM_RAW_MASTER,
        transaction_now: 1794580500,
        decoded_payload: { type: 'comment', comment: 'CL-TON123' },
      },
    ],
  });

  assert.equal(matched.length, 1);
  assert.equal(matched[0].txHash, 'fresh_tc_hash_002');
  assert.equal(matched[0].gramAmount, 1);
  assert.equal(matched[0].coinsToCredit, gramToCoins(1));

  const tonUrl = buildGramTransferUrl({
    depositAddress: DEFAULT_GRAM_DEPOSIT_ADDRESS,
    jettonMaster: DEFAULT_GRAM_JETTON_MASTER,
    gramAmount: 0.4413,
    memo: 'CL-TON123',
    scheme: 'ton',
  });
  assert.ok(tonUrl.startsWith(`ton://transfer/${DEFAULT_GRAM_DEPOSIT_ADDRESS}?`));
  assert.ok(tonUrl.includes(`jetton=${DEFAULT_GRAM_JETTON_MASTER}`));
  assert.ok(tonUrl.includes('amount=441300000'));
  assert.ok(tonUrl.includes('text=CL-TON123'));
});

test('i18n dictionary provides localized strings for every dropdown option and validates language codes', () => {
  for (const option of LANGUAGE_OPTIONS) {
    assert.equal(isValidLanguageCode(option.code), true);
    const dict = t(option.code);
    assert.ok(dict.farm.length > 0);
    assert.ok(dict.languageAndAudio.length > 0);
    assert.ok(dict.languageLabel.length > 0);
    assert.ok(dict.collect.length > 0);
  }
  assert.equal(isValidLanguageCode('zz'), false);
  assert.equal(t('hi').collect, 'इकट्ठा करें');
  assert.equal(t('es').wallet, 'Billetera');
});

test('filterWithdrawalsByTab filters between All, Pending, and Completed withdrawal requests', () => {
  const sampleWithdrawals = [
    {
      id: 'wd_1',
      userId: 'player_test1',
      eggsAmount: 100,
      gramAmount: '0.000612',
      usdValue: 0.0007,
      walletAddress: 'UQB06dO9oc06d-1c8DF03FLdCznEHz_aLIA69fxzITcunwpr',
      memo: '',
      network: 'GRAM_TON' as const,
      status: 'pending' as const,
      createdAtMs: NOW,
    },
    {
      id: 'wd_2',
      userId: 'player_test1',
      eggsAmount: 200,
      gramAmount: '0.001225',
      usdValue: 0.0014,
      walletAddress: 'UQB06dO9oc06d-1c8DF03FLdCznEHz_aLIA69fxzITcunwpr',
      memo: '',
      network: 'GRAM_TON' as const,
      status: 'processing' as const,
      createdAtMs: NOW + 1000,
    },
    {
      id: 'wd_3',
      userId: 'player_test1',
      eggsAmount: 300,
      gramAmount: '0.001838',
      usdValue: 0.0021,
      walletAddress: 'UQB06dO9oc06d-1c8DF03FLdCznEHz_aLIA69fxzITcunwpr',
      memo: '',
      network: 'GRAM_TON' as const,
      status: 'approved' as const,
      createdAtMs: NOW + 2000,
    },
    {
      id: 'wd_4',
      userId: 'player_test1',
      eggsAmount: 400,
      gramAmount: '0.002450',
      usdValue: 0.0028,
      walletAddress: 'UQB06dO9oc06d-1c8DF03FLdCznEHz_aLIA69fxzITcunwpr',
      memo: '',
      network: 'GRAM_TON' as const,
      status: 'completed' as const,
      createdAtMs: NOW + 3000,
    },
    {
      id: 'wd_5',
      userId: 'player_test1',
      eggsAmount: 150,
      gramAmount: '0.000919',
      usdValue: 0.001,
      walletAddress: 'UQB06dO9oc06d-1c8DF03FLdCznEHz_aLIA69fxzITcunwpr',
      memo: '',
      network: 'GRAM_TON' as const,
      status: 'rejected' as const,
      createdAtMs: NOW + 4000,
    },
  ];

  assert.equal(filterWithdrawalsByTab(sampleWithdrawals, 'all').length, 5);
  assert.deepEqual(
    filterWithdrawalsByTab(sampleWithdrawals, 'pending').map((w) => w.id),
    ['wd_1', 'wd_2'],
  );
  assert.deepEqual(
    filterWithdrawalsByTab(sampleWithdrawals, 'completed').map((w) => w.id),
    ['wd_3', 'wd_4'],
  );
});

test('auto-memo and User ID detection match TG numeric ID and player UID without CL- codes or false positives', () => {
  const rawRecipient = friendlyTonAddressToRaw(DEFAULT_GRAM_DEPOSIT_ADDRESS)!;
  assert.equal(getPrimaryDepositMemo('tg_778899123'), '778899123');
  assert.equal(getPrimaryDepositMemo('player_abc123'), 'player_abc123');

  const accepted = buildAcceptedDepositMemos('tg_778899123');
  assert.deepEqual(accepted, ['778899123', 'tg_778899123']);

  const matched = matchGramTransfersFromTonApiEvents({
    rawDepositAddress: rawRecipient,
    memo: '778899123',
    acceptedMemos: accepted,
    events: [
      {
        event_id: 'tg_numeric_memo_tx',
        in_progress: false,
        timestamp: 1794580100,
        actions: [
          {
            type: 'JettonTransfer',
            status: 'ok',
            JettonTransfer: {
              amount: '500000000',
              comment: '778899123',
              recipient: { address: rawRecipient },
              jetton: { address: OFFICIAL_GRAM_RAW_MASTER, symbol: 'GRAM', decimals: 9 },
            },
          },
        ],
      },
      {
        event_id: 'tg_uid_memo_tx',
        in_progress: false,
        timestamp: 1794580150,
        actions: [
          {
            type: 'JettonTransfer',
            status: 'ok',
            JettonTransfer: {
              amount: '500000000',
              comment: 'tg_778899123',
              recipient: { address: rawRecipient },
              jetton: { address: OFFICIAL_GRAM_RAW_MASTER, symbol: 'GRAM', decimals: 9 },
            },
          },
        ],
      },
      {
        event_id: 'cl_code_memo_tx_ignored',
        in_progress: false,
        timestamp: 1794580200,
        actions: [
          {
            type: 'JettonTransfer',
            status: 'ok',
            JettonTransfer: {
              amount: '500000000',
              comment: 'CL-899123',
              recipient: { address: rawRecipient },
              jetton: { address: OFFICIAL_GRAM_RAW_MASTER, symbol: 'GRAM', decimals: 9 },
            },
          },
        ],
      },
      {
        event_id: 'unrelated_user_tx',
        in_progress: false,
        timestamp: 1794580300,
        actions: [
          {
            type: 'JettonTransfer',
            status: 'ok',
            JettonTransfer: {
              amount: '500000000',
              comment: '991122334',
              recipient: { address: rawRecipient },
              jetton: { address: OFFICIAL_GRAM_RAW_MASTER, symbol: 'GRAM', decimals: 9 },
            },
          },
        ],
      },
    ],
  });

  assert.deepEqual(
    matched.map((m) => m.txHash),
    ['tg_numeric_memo_tx', 'tg_uid_memo_tx'],
  );
});

test('strict memo-only detection blocks cross-user hashes and repeated txHash reuse', () => {
  const rawRecipient = friendlyTonAddressToRaw(DEFAULT_GRAM_DEPOSIT_ADDRESS)!;
  const sampleHex = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

  // Empty memo must never match any transfer
  assert.equal(
    matchGramTransfersFromTonApiEvents({
      rawDepositAddress: rawRecipient,
      memo: '',
      acceptedMemos: [],
      events: [
        {
          event_id: sampleHex,
          in_progress: false,
          timestamp: 1794580400,
          actions: [
            {
              type: 'JettonTransfer',
              status: 'ok',
              JettonTransfer: {
                amount: '500000000',
                comment: '778899123',
                recipient: { address: rawRecipient },
                jetton: { address: OFFICIAL_GRAM_RAW_MASTER, symbol: 'GRAM', decimals: 9 },
              },
            },
          ],
        },
      ],
    }).length,
    0,
  );

  // Another user's transfer cannot be matched by player B
  assert.equal(
    matchGramTransfersFromTonApiEvents({
      rawDepositAddress: rawRecipient,
      memo: '111222333',
      acceptedMemos: ['111222333', 'tg_111222333'],
      events: [
        {
          event_id: sampleHex,
          in_progress: false,
          timestamp: 1794580400,
          actions: [
            {
              type: 'JettonTransfer',
              status: 'ok',
              JettonTransfer: {
                amount: '500000000',
                comment: '778899123',
                recipient: { address: rawRecipient },
                jetton: { address: OFFICIAL_GRAM_RAW_MASTER, symbol: 'GRAM', decimals: 9 },
              },
            },
          ],
        },
      ],
    }).length,
    0,
  );

  // Already-claimed txHash cannot be credited a second time (even with uppercase hex)
  assert.equal(
    matchGramTransfersFromTonApiEvents({
      rawDepositAddress: rawRecipient,
      memo: '778899123',
      acceptedMemos: ['778899123'],
      claimedTxHashes: [sampleHex.toUpperCase()],
      events: [
        {
          event_id: sampleHex,
          in_progress: false,
          timestamp: 1794580400,
          actions: [
            {
              type: 'JettonTransfer',
              status: 'ok',
              JettonTransfer: {
                amount: '500000000',
                comment: '778899123',
                recipient: { address: rawRecipient },
                jetton: { address: OFFICIAL_GRAM_RAW_MASTER, symbol: 'GRAM', decimals: 9 },
              },
            },
          ],
        },
      ],
    }).length,
    0,
  );

  // Deterministic deposit IDs remain identical regardless of hex casing
  assert.deepEqual(
    buildDeterministicDepositIds(sampleHex),
    buildDeterministicDepositIds(sampleHex.toUpperCase()),
  );
});

test('global theme helpers validate modes, persist to localStorage, toggle .dark class, and have localized labels', () => {
  assert.equal(isValidThemeMode('light'), true);
  assert.equal(isValidThemeMode('dark'), true);
  assert.equal(isValidThemeMode('system'), false);
  assert.equal(isValidThemeMode(null), false);

  for (const option of LANGUAGE_OPTIONS) {
    assert.ok(t(option.code).darkMode.length > 0);
  }

  const prevWindow = (globalThis as { window?: unknown }).window;
  const prevDocument = (globalThis as { document?: unknown }).document;
  const store = new Map<string, string>();
  const classes = new Set<string>();
  const docEl = {
    classList: {
      toggle: (cls: string, force?: boolean) => {
        const shouldAdd = force ?? !classes.has(cls);
        if (shouldAdd) classes.add(cls);
        else classes.delete(cls);
        return shouldAdd;
      },
      contains: (cls: string) => classes.has(cls),
    },
    dataset: {} as Record<string, string>,
    style: { colorScheme: '' },
  };

  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, val: string) => {
        store.set(key, val);
      },
    },
  };
  (globalThis as { document?: unknown }).document = {
    documentElement: docEl,
  };

  try {
    assert.equal(getStoredTheme(), 'light');

    setStoredTheme('dark');
    assert.equal(store.get(THEME_STORAGE_KEY), 'dark');
    assert.equal(getStoredTheme(), 'dark');
    assert.equal(classes.has('dark'), true);
    assert.equal(docEl.dataset.theme, 'dark');
    assert.equal(docEl.style.colorScheme, 'dark');

    setStoredTheme('light');
    assert.equal(store.get(THEME_STORAGE_KEY), 'light');
    assert.equal(getStoredTheme(), 'light');
    assert.equal(classes.has('dark'), false);
    assert.equal(docEl.dataset.theme, 'light');
    assert.equal(docEl.style.colorScheme, 'light');

    applyThemeToDocument('dark');
    assert.equal(classes.has('dark'), true);
  } finally {
    if (prevWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = prevWindow;
    }
    if (prevDocument === undefined) {
      delete (globalThis as { document?: unknown }).document;
    } else {
      (globalThis as { document?: unknown }).document = prevDocument;
    }
  }
});

test('formatReferralHandle normalizes @ prefix and falls back safely when handle is empty', () => {
  assert.equal(formatReferralHandle('priya'), '@priya');
  assert.equal(formatReferralHandle('  @AryanDev  '), '@AryanDev');
  assert.equal(formatReferralHandle('', 'tg_778899123'), '@899123');
  assert.equal(formatReferralHandle('   ', ''), '@farmer');
});

test('buildInvitedFriendsList sorts newest-first, matches handles safely without prefix collisions, and sums eggs', () => {
  const referrals = [
    {
      id: 'u_ann',
      referrerUid: 'tg_ref',
      referredUid: 'u_ann',
      referredName: 'Ann',
      referredHandle: 'ann',
      status: 'active' as const,
      coinsEarned: 150,
      toppedUpUsd: 0,
      createdAtMs: NOW + 1000,
    },
    {
      id: 'u_anna',
      referrerUid: 'tg_ref',
      referredUid: 'u_anna',
      referredName: 'Anna',
      referredHandle: '@anna',
      status: 'active' as const,
      coinsEarned: 150,
      toppedUpUsd: 1.5,
      eggsEarned: 10,
      createdAtMs: NOW + 3000,
    },
    {
      id: 'u_legacy',
      referrerUid: 'tg_ref',
      referredUid: 'u_legacy',
      referredName: 'Legacy Friend',
      referredHandle: '',
      status: 'active' as const,
      coinsEarned: 150,
      toppedUpUsd: 0,
      createdAtMs: NOW + 2000,
    },
    {
      id: 'u_pending',
      referrerUid: 'tg_ref',
      referredUid: 'u_pending',
      referredName: 'Pending Pal',
      referredHandle: 'pendingpal',
      status: 'pending' as const,
      coinsEarned: 0,
      toppedUpUsd: 0,
      createdAtMs: NOW + 4000,
    },
  ];

  const transactions = [
    {
      id: 'tx_1',
      userId: 'tg_ref',
      type: 'referral' as const,
      title: '5% eggs · @ann (Ann)',
      amount: 12,
      currency: 'eggs' as const,
      usdValue: 0.0001,
      status: 'completed' as const,
      createdAtMs: NOW + 5000,
    },
    {
      id: 'tx_2',
      userId: 'tg_ref',
      type: 'referral' as const,
      title: '5% eggs · @anna (Anna)',
      amount: 25,
      currency: 'eggs' as const,
      usdValue: 0.0002,
      status: 'completed' as const,
      createdAtMs: NOW + 6000,
    },
    {
      id: 'tx_3',
      userId: 'tg_ref',
      type: 'referral' as const,
      title: '5% lifetime eggs from Legacy Friend',
      amount: 18,
      currency: 'eggs' as const,
      usdValue: 0.0001,
      status: 'completed' as const,
      createdAtMs: NOW + 7000,
    },
    {
      // Non-egg referral coin bonus must not count toward eggsGenerated
      id: 'tx_4',
      userId: 'tg_ref',
      type: 'referral' as const,
      title: 'Referral signup bonus @ann',
      amount: 150,
      currency: 'coins' as const,
      usdValue: 0.015,
      status: 'completed' as const,
      createdAtMs: NOW + 8000,
    },
  ];

  const list = buildInvitedFriendsList(referrals, transactions);
  assert.deepEqual(
    list.map((f) => f.id),
    ['u_pending', 'u_anna', 'u_legacy', 'u_ann'],
  );

  const byId = Object.fromEntries(list.map((f) => [f.id, f]));
  assert.equal(byId.u_pending.formattedHandle, '@pendingpal');
  assert.equal(byId.u_pending.eggsGenerated, 0);

  assert.equal(byId.u_anna.formattedHandle, '@anna');
  assert.equal(byId.u_anna.eggsGenerated, 35); // 10 baseline + 25 tx

  assert.equal(byId.u_ann.formattedHandle, '@ann');
  assert.equal(byId.u_ann.eggsGenerated, 12); // Not polluted by @anna or coin bonus

  assert.equal(byId.u_legacy.formattedHandle, '@legacy');
  assert.equal(byId.u_legacy.eggsGenerated, 18);
});

test('referralShare builds personal referral URL, invokes Web Share API, and handles cancel/fallback cleanly', async () => {
  const url = buildPersonalReferralUrl('CL-778899', 'https://chickenland.app/');
  assert.equal(url, 'https://chickenland.app/?ref=CL-778899');
  assert.equal(buildPersonalReferralUrl('', 'https://chickenland.app/'), 'https://chickenland.app');

  const payload = buildReferralShareData('CL-778899', url, 'Rahul');
  assert.equal(payload.title, 'Join Alpha Gram!');
  assert.equal(payload.url, url);
  assert.ok(payload.text?.includes('CL-778899'));
  assert.ok(payload.text?.includes('+1,000'));

  // 1. Web Share API succeeds
  let sharedPayload: ShareData | null = null;
  let clipboardCalls = 0;
  const okOutcome = await shareReferralLink({
    referralCode: 'CL-778899',
    referralUrl: url,
    referrerName: 'Rahul',
    nav: {
      share: async (data) => {
        sharedPayload = data;
      },
      clipboard: {
        writeText: async () => {
          clipboardCalls += 1;
        },
      },
    },
  });
  assert.equal(okOutcome, 'shared');
  assert.deepEqual(sharedPayload, payload);
  assert.equal(clipboardCalls, 0);

  // 2. AbortError returns 'cancelled' without overwriting clipboard
  const cancelOutcome = await shareReferralLink({
    referralCode: 'CL-778899',
    referralUrl: url,
    nav: {
      share: async () => {
        const err = new Error('Share dismissed');
        err.name = 'AbortError';
        throw err;
      },
      clipboard: {
        writeText: async () => {
          clipboardCalls += 1;
        },
      },
    },
  });
  assert.equal(cancelOutcome, 'cancelled');
  assert.equal(clipboardCalls, 0);

  // 3. NotAllowedError or canShare=false falls back to clipboard copy
  let copiedText = '';
  const fallbackOutcome = await shareReferralLink({
    referralCode: 'CL-778899',
    referralUrl: url,
    nav: {
      canShare: () => false,
      share: async () => {
        throw new Error('Should not be called when canShare returns false');
      },
      clipboard: {
        writeText: async (text) => {
          copiedText = text;
        },
      },
    },
  });
  assert.equal(fallbackOutcome, 'copied');
  assert.equal(copiedText, url);

  let errorFallbackCopied = '';
  const errFallbackOutcome = await shareReferralLink({
    referralCode: 'CL-778899',
    referralUrl: url,
    nav: {
      share: async () => {
        throw new Error('Blocked by iframe policy');
      },
      clipboard: {
        writeText: async (text) => {
          errorFallbackCopied = text;
        },
      },
    },
  });
  assert.equal(errFallbackOutcome, 'copied');
  assert.equal(errorFallbackCopied, url);
});

test('Mute All controls both music and sound effects globally and persists synced settings', () => {
  assert.equal(isAllAudioMuted(DEFAULT_AUDIO_SETTINGS), false);
  assert.equal(t('en').muteAll, 'Mute All');
  assert.equal(t('en').unmuteAll, 'Unmute All');

  // 1. Muting from active music + sounds turns both off and remembers prior state
  const mutedFromBoth = computeMuteAllToggle({
    musicEnabled: true,
    soundsEnabled: true,
  });
  assert.equal(mutedFromBoth.musicEnabled, false);
  assert.equal(mutedFromBoth.soundsEnabled, false);
  assert.equal(isAllAudioMuted(mutedFromBoth), true);

  // 2. Unmuting restores both music + sounds
  const restoredBoth = computeMuteAllToggle(mutedFromBoth);
  assert.equal(restoredBoth.musicEnabled, true);
  assert.equal(restoredBoth.soundsEnabled, true);
  assert.equal(isAllAudioMuted(restoredBoth), false);

  // 3. Muting from sounds-only preserves music=false when unmuting
  const mutedSoundsOnly = computeMuteAllToggle({
    musicEnabled: false,
    soundsEnabled: true,
  });
  assert.equal(isAllAudioMuted(mutedSoundsOnly), true);
  const restoredSoundsOnly = computeMuteAllToggle(mutedSoundsOnly);
  assert.equal(restoredSoundsOnly.musicEnabled, false);
  assert.equal(restoredSoundsOnly.soundsEnabled, true);

  // 4. Unmuting when both were manually turned off enables audio globally
  const unmutedFromManualOff = computeMuteAllToggle({
    musicEnabled: false,
    soundsEnabled: false,
  });
  assert.equal(unmutedFromManualOff.musicEnabled, true);
  assert.equal(unmutedFromManualOff.soundsEnabled, true);

  // 5. Storage persistence roundtrip
  const prevWindow = (globalThis as { window?: unknown }).window;
  const store = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, val: string) => {
        store.set(key, val);
      },
    },
  };

  try {
    assert.deepEqual(getStoredAudioSettings(), DEFAULT_AUDIO_SETTINGS);
    setStoredAudioSettings(mutedFromBoth);
    assert.ok(store.has(AUDIO_SETTINGS_STORAGE_KEY));
    assert.deepEqual(getStoredAudioSettings(), mutedFromBoth);
  } finally {
    if (prevWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = prevWindow;
    }
  }
});

test('buildReferralGrowthSeries aggregates daily new referrals over the last 7 days', () => {
  const refTime = new Date(2026, 10, 14, 15, 30, 0).getTime(); // Nov 14, 2026 15:30 local
  const dayMs = 24 * 60 * 60 * 1000;

  const referrals = [
    {
      id: 'ref_today_1',
      referrerUid: 'tg_host',
      referredUid: 'ref_today_1',
      referredName: 'Asha',
      referredHandle: '@asha',
      status: 'active' as const,
      coinsEarned: 150,
      toppedUpUsd: 0,
      createdAtMs: refTime - 60 * 60 * 1000, // Today (Nov 14)
    },
    {
      id: 'ref_today_2',
      referrerUid: 'tg_host',
      referredUid: 'ref_today_2',
      referredName: 'Kabir',
      referredHandle: '@kabir',
      status: 'pending' as const,
      coinsEarned: 0,
      toppedUpUsd: 0,
      createdAtMs: refTime - 2 * 60 * 60 * 1000, // Today (Nov 14)
    },
    {
      id: 'ref_2d_ago',
      referrerUid: 'tg_host',
      referredUid: 'ref_2d_ago',
      referredName: 'Maya',
      referredHandle: '@maya',
      status: 'active' as const,
      coinsEarned: 150,
      toppedUpUsd: 1,
      createdAtMs: refTime - 2 * dayMs, // Nov 12
    },
    {
      id: 'ref_too_old',
      referrerUid: 'tg_host',
      referredUid: 'ref_too_old',
      referredName: 'Old Pal',
      referredHandle: '@oldpal',
      status: 'active' as const,
      coinsEarned: 150,
      toppedUpUsd: 0,
      createdAtMs: refTime - 8 * dayMs, // Nov 6 (outside 7-day window)
    },
  ];

  const series = buildReferralGrowthSeries(referrals, refTime, 7);
  assert.equal(series.length, 7);
  assert.equal(series[0].dateKey, '2026-11-08');
  assert.equal(series[6].dateKey, '2026-11-14');

  // Nov 12 (index 4) has 1 active referral
  assert.equal(series[4].dateKey, '2026-11-12');
  assert.equal(series[4].newReferrals, 1);
  assert.equal(series[4].activeReferrals, 1);
  assert.equal(series[4].pendingReferrals, 0);

  // Nov 14 (index 6) has 2 referrals (1 active, 1 pending)
  assert.equal(series[6].newReferrals, 2);
  assert.equal(series[6].activeReferrals, 1);
  assert.equal(series[6].pendingReferrals, 1);

  // Empty days are zero-filled and out-of-window referrals excluded
  const totalInWindow = series.reduce((sum, pt) => sum + pt.newReferrals, 0);
  assert.equal(totalInWindow, 3);
});

test('level yield multiplier (+2%/lvl above Level 1) and 2x Laying Feed booster scale production rate accurately', () => {
  const { profile } = createDefaultProfile('player_boost1', 'Karan', '@karan', NOW);
  assert.equal(calculateLevelYieldMultiplier(1), 1.0);
  assert.equal(calculateLevelYieldMultiplier(6), 1.1); // +10%
  assert.equal(calculateProductionRate(profile, NOW), 0);
  assert.ok('error' in activateFeedBooster(profile, NOW));

  const starterProfile = { ...profile, leghornCount: 2 };
  assert.equal(calculateProductionRate(starterProfile, NOW), 16); // 2 * 8

  const lv6Profile = { ...profile, level: 6, leghornCount: 10 };
  assert.equal(calculateProductionRate(lv6Profile, NOW), 88); // 80 * 1.1

  const activated = activateFeedBooster(lv6Profile, NOW);
  assert.ok(!('error' in activated));
  assert.equal(activated.profile.coins, profile.coins - FEED_BOOSTER_COST_COINS);
  assert.equal(activated.profile.feedBoostUntilMs, NOW + FEED_BOOSTER_DURATION_MS);
  assert.equal(isFeedBoosterActive(activated.profile, NOW + 1000), true);
  assert.equal(calculateProductionRate(activated.profile, NOW + 1000), 176); // 88 * 2

  const duplicate = activateFeedBooster(activated.profile, NOW + 1000);
  assert.ok('error' in duplicate);

  const afterExpiry = NOW + FEED_BOOSTER_DURATION_MS + 1000;
  assert.equal(isFeedBoosterActive(activated.profile, afterExpiry), false);
  assert.equal(calculateProductionRate(activated.profile, afterExpiry), 88);
});

test('golden egg drops require at least 1 chicken, reward bonus coins + XP, and enforce cooldown', () => {
  const { profile } = createDefaultProfile('player_gold1', 'Meera', '@meera', NOW);
  assert.ok('error' in claimGoldenEggDrop(profile, NOW));

  const activeFarm = { ...profile, leghornCount: 1 };
  assert.equal(isGoldenEggReady(activeFarm, NOW), true);

  const drop = claimGoldenEggDrop(activeFarm, NOW);
  assert.ok(!('error' in drop));
  assert.equal(drop.bonusCoins, GOLDEN_EGG_REWARD_COINS);
  assert.equal(drop.xpGained, GOLDEN_EGG_REWARD_XP);
  assert.equal(drop.profile.coins, activeFarm.coins + GOLDEN_EGG_REWARD_COINS);
  assert.equal(drop.profile.goldenEggsFound, 1);

  assert.equal(isGoldenEggReady(drop.profile, NOW + 10_000), false);
  const tooEarly = claimGoldenEggDrop(drop.profile, NOW + 10_000);
  assert.ok('error' in tooEarly);

  const afterCooldown = claimGoldenEggDrop(drop.profile, NOW + GOLDEN_EGG_COOLDOWN_MS);
  assert.ok(!('error' in afterCooldown));
  assert.equal(afterCooldown.profile.goldenEggsFound, 2);
});

test('achievements unlock on progress milestones and prevent duplicate claims', () => {
  const { profile } = createDefaultProfile('player_ach1', 'Dev', '@dev', NOW);
  const lockedErr = claimAchievement(profile, 'first_harvest', NOW);
  assert.ok('error' in lockedErr);

  const progressed = { ...profile, totalEggsCollected: 120 };
  const list = getAchievementsProgress(progressed);
  const firstHarvest = list.find((a) => a.id === 'first_harvest');
  assert.ok(firstHarvest?.unlocked);
  assert.equal(firstHarvest?.claimed, false);

  const claimed = claimAchievement(progressed, 'first_harvest', NOW);
  assert.ok(!('error' in claimed));
  assert.equal(claimed.rewardCoins, 75);
  assert.equal(claimed.profile.coins, progressed.coins + 75);

  const dup = claimAchievement(claimed.profile, 'first_harvest', NOW + 1000);
  assert.ok('error' in dup);
});

test('referral milestone crates unlock at 3/10/25 active referrals and grant coins + hens', () => {
  const { profile } = createDefaultProfile('player_refcrate', 'Neha', '@neha', NOW);
  assert.equal(REFERRAL_MILESTONE_CRATES.length, 3);

  const locked = claimReferralMilestone(profile, 3, 2, NOW);
  assert.ok('error' in locked);

  const bronze = claimReferralMilestone({ ...profile, referralCount: 3 }, 3, 3, NOW);
  assert.ok(!('error' in bronze));
  assert.equal(bronze.crate.rewardCoins, 300);
  assert.equal(bronze.profile.leghornCount, profile.leghornCount);

  const silver = claimReferralMilestone({ ...bronze.profile, referralCount: 10 }, 10, 10, NOW);
  assert.ok(!('error' in silver));
  assert.equal(silver.crate.rewardCoins, 1200);
  assert.equal(silver.profile.leghornCount, profile.leghornCount + 1);

  const dup = claimReferralMilestone(silver.profile, 10, 10, NOW + 1000);
  assert.ok('error' in dup);
});

test('buildEarningsChartSeries aggregates daily eggs collected and coin inflows cleanly', () => {
  const refTime = new Date(2026, 10, 14, 15, 0, 0).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const series = buildEarningsChartSeries(
    [
      {
        id: 't1',
        userId: 'u1',
        type: 'collect',
        title: 'Collected eggs',
        amount: 120,
        currency: 'eggs',
        usdValue: 0.001,
        status: 'completed',
        createdAtMs: refTime - 60_000,
      },
      {
        id: 't2',
        userId: 'u1',
        type: 'golden_egg',
        title: 'Golden Egg',
        amount: 25,
        currency: 'coins',
        usdValue: 0.0025,
        status: 'completed',
        createdAtMs: refTime - dayMs,
      },
      {
        id: 't3',
        userId: 'u1',
        type: 'buy_chicken',
        title: 'Bought Leghorn',
        amount: -1000,
        currency: 'coins',
        usdValue: 0.1,
        status: 'completed',
        createdAtMs: refTime - dayMs,
      },
    ],
    refTime,
    7,
  );
  assert.equal(series.length, 7);
  assert.equal(series[6].eggsCollected, 120);
  assert.equal(series[5].coinsEarned, 25);
});

test('dynamic admin promo codes validate active status, maxUses, expiry, and default season config', () => {
  const { profile } = createDefaultProfile('player_dynpromo', 'Ravi', '@ravi', NOW);
  const promos = [
    {
      code: 'SEASON1',
      label: 'Season Launch Drop',
      coins: 400,
      maxUses: 10,
      usedCount: 2,
      expiresAtMs: NOW + 3600_000,
      isActive: true,
      createdAtMs: NOW,
    },
    {
      code: 'PAUSED1',
      label: 'Paused Code',
      coins: 200,
      maxUses: 0,
      usedCount: 0,
      expiresAtMs: 0,
      isActive: false,
      createdAtMs: NOW,
    },
    {
      code: 'EXPIRED1',
      label: 'Old Code',
      coins: 200,
      maxUses: 0,
      usedCount: 0,
      expiresAtMs: NOW - 1000,
      isActive: true,
      createdAtMs: NOW - 5000,
    },
    {
      code: 'CAPPED1',
      label: 'Full Code',
      coins: 200,
      maxUses: 5,
      usedCount: 5,
      expiresAtMs: 0,
      isActive: true,
      createdAtMs: NOW,
    },
  ];

  assert.ok('error' in claimPromoCode(profile, 'PAUSED1', NOW, promos));
  assert.ok('error' in claimPromoCode(profile, 'EXPIRED1', NOW, promos));
  assert.ok('error' in claimPromoCode(profile, 'CAPPED1', NOW, promos));

  const ok = claimPromoCode(profile, 'season1', NOW, promos);
  assert.ok(!('error' in ok));
  assert.equal(ok.rewardCoins, 400);
  assert.equal(ok.dynamicPromoCode, 'SEASON1');
  assert.equal(ok.profile.coins, profile.coins + 400);

  const season = createDefaultSeasonConfig(NOW);
  assert.equal(season.seasonNumber, 1);
  assert.ok(season.prizePoolCoins > 0);
  assert.ok(season.endsAtMs > NOW);
});

test('daily ad-network tasks reward 80/90/100 coins, enforce 5/day limit, prune stale dates, and unlock free Leghorn at 10 ads', () => {
  assert.deepEqual(
    AD_NETWORK_TASKS.map((n) => [n.id, n.rewardCoins, n.dailyLimit]),
    [
      ['adsgram', 80, 5],
      ['gigapub', 90, 5],
      ['monetag', 100, 5],
    ],
  );

  const { profile } = createDefaultProfile('player_adnet', 'Kiran', '@kiran', NOW);
  // Seed stale ad entry from yesterday and 9 watched ads toward the 10-ad hen unlock
  let current = {
    ...profile,
    watchedAdsCount: 9,
    completedTaskIds: ['milestone_react', 'ad_adsgram_2026-11-13_1'],
  };

  // 1st claim today on Monetag (+100 coins) also hits 10/10 watched ads -> unlocks 1 White Leghorn
  const monetagRes = claimAdNetworkReward(current, 'monetag', '2026-11-14', NOW);
  assert.ok(!('error' in monetagRes));
  assert.equal(monetagRes.rewardCoins, 100);
  assert.equal(monetagRes.watchedToday, 1);
  assert.equal(monetagRes.unlockedChicken, true);
  assert.equal(monetagRes.profile.coins, current.coins + 100);
  assert.equal(monetagRes.profile.leghornCount, 1);
  assert.equal(monetagRes.profile.watchedAdsCount, 0);
  assert.ok(monetagRes.profile.completedTaskIds.includes('milestone_react'));
  assert.ok(!monetagRes.profile.completedTaskIds.includes('ad_adsgram_2026-11-13_1'));
  assert.equal(getAdNetworkClaimCountToday(monetagRes.profile.completedTaskIds, 'monetag', '2026-11-14'), 1);

  // AdsGram (+80) and Gigapub (+90) track separate 5/day quotas
  const adsgramRes = claimAdNetworkReward(monetagRes.profile, 'adsgram', '2026-11-14', NOW + 1000);
  assert.ok(!('error' in adsgramRes));
  assert.equal(adsgramRes.rewardCoins, 80);

  const gigapubRes = claimAdNetworkReward(adsgramRes.profile, 'gigapub', '2026-11-14', NOW + 2000);
  assert.ok(!('error' in gigapubRes));
  assert.equal(gigapubRes.rewardCoins, 90);
  assert.equal(gigapubRes.profile.watchedAdsCount, 2);

  // Exhaust remaining 4 AdsGram claims today -> 6th claim fails
  current = gigapubRes.profile;
  for (let i = 0; i < 4; i += 1) {
    const next = claimAdNetworkReward(current, 'adsgram', '2026-11-14', NOW + 3000 + i * 1000);
    assert.ok(!('error' in next));
    current = next.profile;
  }
  assert.equal(getAdNetworkClaimCountToday(current.completedTaskIds, 'adsgram', '2026-11-14'), 5);
  const capped = claimAdNetworkReward(current, 'adsgram', '2026-11-14', NOW + 10000);
  assert.ok('error' in capped);
});

test('task slots enforcement blocks completion when remaining slots reach 0 and merges 4 task categories', () => {
  const { profile } = createDefaultProfile('player_slots', 'Zara', '@zara', NOW);
  const customTasks = [
    {
      id: 'task_social_1',
      category: 'social' as const,
      title: 'Follow X',
      rewardCoins: 120,
      icon: 'users',
      isCustom: true,
      isActive: true,
      totalSlots: 10,
      claimedCount: 9,
      createdAtMs: NOW,
    },
    {
      id: 'task_exclusive_full',
      category: 'exclusive' as const,
      title: 'Sold Out VIP Drop',
      rewardCoins: 500,
      icon: 'gift',
      isCustom: true,
      isActive: true,
      totalSlots: 50,
      claimedCount: 50,
      createdAtMs: NOW,
    },
  ];

  const merged = mergeTaskDefinitions(customTasks);
  assert.ok(merged.some((t) => t.category === 'social'));
  assert.ok(merged.some((t) => t.category === 'daily'));
  assert.ok(merged.some((t) => t.category === 'exclusive'));
  assert.ok(merged.some((t) => t.category === 'partner'));

  assert.equal(getTaskRemainingSlots(customTasks[0], false), 1);
  assert.equal(getTaskRemainingSlots(customTasks[1], false), 0);

  const ok = completeTask(profile, 'task_social_1', NOW, customTasks);
  assert.ok(!('error' in ok));
  assert.equal(ok.isCustomTask, true);
  assert.equal(ok.rewardCoins, 120);

  const builtInDone = completeTask(profile, 'daily_news', NOW, customTasks);
  assert.ok(!('error' in builtInDone));
  assert.equal(builtInDone.isCustomTask, false);

  const fullErr = completeTask(profile, 'task_exclusive_full', NOW, customTasks);
  assert.ok('error' in fullErr);
});

test('paid user task creation enforces 5k min (30 joins, 150/join, 10% fee min 500), deducts coins, and blocks self-claim', () => {
  // Minimum criteria: 150 coins * 30 slots = 4,500 pool + 500 fee (10% of 5,000 budget) = 5,000 total
  const minCost = calculatePaidTaskCost(150, 30);
  assert.equal(minCost.rewardPoolCoins, 4500);
  assert.equal(minCost.platformFeeCoins, 500);
  assert.equal(minCost.totalCostCoins, 5000);

  // Scaling above minimum: 200 coins * 40 slots = 8,000 pool + 800 fee (10%) = 8,800 total
  const scaledCost = calculatePaidTaskCost(200, 40);
  assert.equal(scaledCost.rewardPoolCoins, 8000);
  assert.equal(scaledCost.platformFeeCoins, 800);
  assert.equal(scaledCost.totalCostCoins, 8800);

  // Inputs below minimums clamp safely to 150 reward / 30 slots / 5,000 total
  const clampedCost = calculatePaidTaskCost(50, 10);
  assert.equal(clampedCost.rewardCoins, 150);
  assert.equal(clampedCost.totalSlots, 30);
  assert.equal(clampedCost.totalCostCoins, 5000);

  const { profile } = createDefaultProfile('player_creator1', 'Aarav', '@aarav', NOW);
  assert.equal(profile.coins, 1000);

  // Under 5,000 coins balance cannot publish even minimum task
  const under5k = createPaidTaskOrder(
    { ...profile, coins: 4999 },
    {
      title: 'Join My Channel',
      category: 'partner',
      rewardCoins: 150,
      totalSlots: 30,
      icon: 'send',
      actionUrl: 'https://t.me/test',
    },
    NOW,
  );
  assert.ok('error' in under5k);

  const fundedCreator = { ...profile, coins: 6000 };

  // Below min reward (< 150) rejected
  const lowReward = createPaidTaskOrder(
    fundedCreator,
    {
      title: 'Low Reward Task',
      category: 'social',
      rewardCoins: 100,
      totalSlots: 30,
      icon: 'send',
      actionUrl: '',
    },
    NOW,
  );
  assert.ok('error' in lowReward);

  // Below min slots (< 30) rejected
  const lowSlots = createPaidTaskOrder(
    fundedCreator,
    {
      title: 'Low Slots Task',
      category: 'social',
      rewardCoins: 150,
      totalSlots: 29,
      icon: 'send',
      actionUrl: '',
    },
    NOW,
  );
  assert.ok('error' in lowSlots);

  // Valid minimum paid task deducts 5,000 coins and emits negative coin transaction
  const ok = createPaidTaskOrder(
    fundedCreator,
    {
      title: 'Join My Channel',
      category: 'partner',
      rewardCoins: 150,
      totalSlots: 30,
      icon: 'send',
      actionUrl: 'https://t.me/test',
    },
    NOW,
  );
  assert.ok(!('error' in ok));
  assert.equal(ok.cost.totalCostCoins, 5000);
  assert.equal(ok.profile.coins, 1000);
  assert.equal(ok.transaction.amount, -5000);
  assert.equal(ok.transaction.currency, 'coins');

  // Creator cannot claim their own posted task, while another player can
  const ownTask = {
    id: 'task_user_paid_1',
    category: 'partner' as const,
    title: 'Join My Channel',
    rewardCoins: 150,
    icon: 'send',
    actionUrl: 'https://t.me/test',
    totalSlots: 30,
    claimedCount: 0,
    creatorUid: 'player_creator1',
    paidCoins: 5000,
    isCustom: true,
    isActive: true,
    createdAtMs: NOW,
  };

  const selfClaim = completeTask(ok.profile, 'task_user_paid_1', NOW + 1000, [ownTask]);
  assert.ok('error' in selfClaim);

  const { profile: otherUser } = createDefaultProfile('player_other2', 'Meera', '@meera', NOW);
  const otherClaim = completeTask(otherUser, 'task_user_paid_1', NOW + 1000, [ownTask]);
  assert.ok(!('error' in otherClaim));
  assert.equal(otherClaim.rewardCoins, 150);
  assert.equal(otherClaim.profile.coins, otherUser.coins + 150);
});

test('sortTasks orders tasks accurately by Most Reward, Newest, and Ending Soon', () => {
  const sampleTasks = [
    {
      id: 'task_unlimited_high',
      category: 'partner' as const,
      title: 'Unlimited High Reward',
      rewardCoins: 600,
      icon: 'link',
      isCustom: true,
      isActive: true,
      createdAtMs: NOW - 5000,
    },
    {
      id: 'task_low_slots_medium',
      category: 'partner' as const,
      title: 'Almost Gone',
      rewardCoins: 200,
      icon: 'flame',
      isCustom: true,
      isActive: true,
      totalSlots: 50,
      claimedCount: 47, // 3 spots left
      createdAtMs: NOW - 2000,
    },
    {
      id: 'task_brand_new',
      category: 'partner' as const,
      title: 'Brand New Quest',
      rewardCoins: 350,
      icon: 'send',
      isCustom: true,
      isActive: true,
      totalSlots: 100,
      claimedCount: 10, // 90 spots left
      createdAtMs: NOW + 1000,
    },
    {
      id: 'task_sold_out_top_reward',
      category: 'partner' as const,
      title: 'Sold Out Whale',
      rewardCoins: 900,
      icon: 'gift',
      isCustom: true,
      isActive: true,
      totalSlots: 10,
      claimedCount: 10, // 0 spots left
      createdAtMs: NOW - 1000,
    },
  ];

  // Most Reward: descending by rewardCoins
  assert.deepEqual(
    sortTasks(sampleTasks, 'most_reward').map((t) => t.id),
    ['task_sold_out_top_reward', 'task_unlimited_high', 'task_brand_new', 'task_low_slots_medium'],
  );

  // Newest: descending by createdAtMs
  assert.deepEqual(
    sortTasks(sampleTasks, 'newest').map((t) => t.id),
    ['task_brand_new', 'task_sold_out_top_reward', 'task_low_slots_medium', 'task_unlimited_high'],
  );

  // Ending Soon: fewest open spots > 0 first, then unlimited, then sold-out (0 left) last
  assert.deepEqual(
    sortTasks(sampleTasks, 'ending_soon').map((t) => t.id),
    ['task_low_slots_medium', 'task_brand_new', 'task_unlimited_high', 'task_sold_out_top_reward'],
  );
});

test('totalAdsWatched accumulates across 10-ad chicken resets and unlocks withdrawal at 30 ads', () => {
  const { profile } = createDefaultProfile('player_ads30', 'Kabir', '@kabir', NOW);
  let current = { ...profile, eggs: 250 };

  assert.equal(getTotalAdsWatched(current), 0);
  assert.equal(getWithdrawAdGateStatus(current).unlocked, false);
  assert.equal(getWithdrawAdGateStatus(current).remaining, 30);

  // Watch 29 ads via watchAdStep & claimAdNetworkReward (triggers 2 chicken resets at 10 and 20)
  for (let i = 0; i < 20; i += 1) {
    current = watchAdStep(current, NOW + i * 1000).profile;
  }
  assert.equal(current.watchedAdsCount, 0);
  assert.equal(current.leghornCount, 2);
  assert.equal(getTotalAdsWatched(current), 20);

  for (let i = 0; i < 5; i += 1) {
    const netRes = claimAdNetworkReward(current, 'adsgram', '2026-11-14', NOW + 30_000 + i * 1000);
    assert.ok(!('error' in netRes));
    current = netRes.profile;
  }
  for (let i = 0; i < 4; i += 1) {
    const netRes = claimAdNetworkReward(current, 'gigapub', '2026-11-14', NOW + 40_000 + i * 1000);
    assert.ok(!('error' in netRes));
    current = netRes.profile;
  }

  assert.equal(getTotalAdsWatched(current), 29);
  assert.equal(getWithdrawAdGateStatus(current).unlocked, false);
  assert.equal(getWithdrawAdGateStatus(current).remaining, 1);

  // 30th ad unlocks withdrawals!
  const net30 = claimAdNetworkReward(current, 'monetag', '2026-11-14', NOW + 50_000);
  assert.ok(!('error' in net30));
  current = net30.profile;
  assert.equal(getTotalAdsWatched(current), 30);
  assert.equal(getWithdrawAdGateStatus(current).unlocked, true);
  assert.equal(getWithdrawAdGateStatus(current).remaining, 0);

  const wdOk = executeWithdrawal(
    current,
    150,
    'UQB06dO9oc06d-1c8DF03FLdCznEHz_aLIA69fxzITcunwpr',
    '',
    NOW + 60_000,
  );
  assert.ok(!('error' in wdOk));
});

test('encodeAchievementsWithAds and decodeAchievementsAndAds round-trip totalAdsWatched within 50-item Firestore limit', () => {
  // Zero ads leaves array untouched
  assert.deepEqual(encodeAchievementsWithAds(['first_harvest'], 0), ['first_harvest']);

  // Encodes 30 ads alongside real achievements, stripping old __ads tokens
  const encoded = encodeAchievementsWithAds(['first_harvest', '__ads:12', 'flock_5'], 30);
  assert.deepEqual(encoded, ['first_harvest', 'flock_5', '__ads:30']);
  assert.ok(encoded.every((item) => item.length <= 64));

  const decoded = decodeAchievementsAndAds(encoded, undefined, 0);
  assert.deepEqual(decoded.claimedAchievementIds, ['first_harvest', 'flock_5']);
  assert.equal(decoded.totalAdsWatched, 30);

  // Enforces max 50 items even with 60 real achievement IDs
  const manyIds = Array.from({ length: 60 }, (_, i) => `ach_${i}`);
  const capped = encodeAchievementsWithAds(manyIds, 42);
  assert.equal(capped.length, 50);
  assert.equal(capped[49], '__ads:42');
});

test('encodeTaskSubtitleMeta and decodeTaskSubtitleMeta preserve slots and creatorUid inside 120-char subtitle cap', () => {
  // Unlimited admin task without meta stays plain text (or undefined)
  assert.equal(encodeTaskSubtitleMeta({ subtitle: 'Join official channel', totalSlots: 0 }), 'Join official channel');
  assert.equal(encodeTaskSubtitleMeta({ subtitle: '', totalSlots: 0 }), undefined);

  // Paid task with long subtitle and 64-char creatorUid still stays <= 120 chars and round-trips cleanly
  const longSub = 'Join our verified community channel and complete daily engagement rewards for bonus coins!';
  const longUid = 'player_1234567890_abcdefghijklmnopqrstuvwxyz_12345678901234567';
  const encoded = encodeTaskSubtitleMeta({
    subtitle: longSub,
    totalSlots: 30,
    claimedCount: 7,
    creatorUid: longUid.slice(0, 64),
    paidCoins: 5000,
  });
  assert.ok(encoded);
  assert.ok(encoded.length <= 120);

  const decoded = decodeTaskSubtitleMeta(encoded);
  assert.equal(decoded.totalSlots, 30);
  assert.equal(decoded.claimedCount, 7);
  assert.equal(decoded.creatorUid, longUid.slice(0, 64));
  assert.equal(decoded.paidCoins, 5000);
  assert.ok(!decoded.subtitle?.includes('__m:'));

  // Standard paid task round-trips full subtitle + slot increment
  const standardEncoded = encodeTaskSubtitleMeta({
    subtitle: 'Join @my_channel',
    totalSlots: 30,
    claimedCount: 0,
    creatorUid: 'player_oojwtfoum3',
    paidCoins: 5000,
  });
  assert.ok(standardEncoded && standardEncoded.length <= 120);
  const standardDecoded = decodeTaskSubtitleMeta(standardEncoded);
  assert.equal(standardDecoded.subtitle, 'Join @my_channel');
  assert.equal(standardDecoded.totalSlots, 30);
  assert.equal(standardDecoded.claimedCount, 0);
  assert.equal(standardDecoded.creatorUid, 'player_oojwtfoum3');
  assert.equal(standardDecoded.paidCoins, 5000);
});

test('generateGiftCodeString, encodePromoLabelMeta, and decodePromoLabelMeta support coins, eggs, and chicken gifts within Firestore limits', () => {
  const generated = generateGiftCodeString('vip');
  assert.ok(generated.startsWith('VIP-'));
  assert.ok(/^[A-Z0-9_-]{3,32}$/.test(generated));

  // 1. Coins reward leaves label plain text
  const coinEnc = encodePromoLabelMeta({
    label: 'Weekend Bonus Drop',
    rewardType: 'coins',
    coins: 750,
  });
  assert.equal(coinEnc.encodedLabel, 'Weekend Bonus Drop');
  assert.equal(coinEnc.firestoreCoins, 750);
  const coinDec = decodePromoLabelMeta(coinEnc.encodedLabel, coinEnc.firestoreCoins);
  assert.equal(coinDec.rewardType, 'coins');
  assert.equal(coinDec.coins, 750);
  assert.equal(coinDec.eggs, 0);
  assert.equal(coinDec.chickenQty, 0);
  assert.equal(formatPromoRewardSummary(coinDec), '+750 coins');

  // 2. Eggs reward stays <= 60 chars, sets valid firestoreCoins >= 1, and decodes pure eggs (0 bonus coins)
  const eggEnc = encodePromoLabelMeta({
    label: 'Super Golden Harvest Community Giveaway Event Label That Is Long',
    rewardType: 'eggs',
    eggs: 2500,
    coins: 0,
  });
  assert.ok(eggEnc.encodedLabel.length <= 60);
  assert.ok(eggEnc.firestoreCoins >= 1);
  const eggDec = decodePromoLabelMeta(eggEnc.encodedLabel, eggEnc.firestoreCoins);
  assert.equal(eggDec.rewardType, 'eggs');
  assert.equal(eggDec.eggs, 2500);
  assert.equal(eggDec.coins, 0);
  assert.ok(!eggDec.label.includes('__r:'));
  assert.equal(formatPromoRewardSummary(eggDec), '+2,500 eggs');

  // 3. Chicken reward encodes breed + qty cleanly inside 60-char cap
  const henEnc = encodePromoLabelMeta({
    label: 'VIP Champion Hen Drop',
    rewardType: 'chicken',
    chickenBreed: 'australorp',
    chickenQty: 2,
    coins: 0,
  });
  assert.ok(henEnc.encodedLabel.length <= 60);
  assert.ok(henEnc.firestoreCoins >= 1);
  const henDec = decodePromoLabelMeta(henEnc.encodedLabel, henEnc.firestoreCoins);
  assert.equal(henDec.rewardType, 'chicken');
  assert.equal(henDec.chickenBreed, 'australorp');
  assert.equal(henDec.chickenQty, 2);
  assert.equal(henDec.coins, 0);
  assert.equal(formatPromoRewardSummary(henDec), '+2 Australorp');
});

test('claimPromoCode awards eggs and chickens accurately and starts farm clock on first gifted hen', () => {
  const { profile } = createDefaultProfile('player_gift1', 'Ananya', '@ananya', NOW);
  assert.equal(profile.leghornCount, 0);
  assert.equal(profile.eggs, 0);

  const promos = [
    {
      code: 'EGGS-2500',
      label: 'Egg Gift Drop',
      coins: 0,
      rewardType: 'eggs' as const,
      eggs: 2500,
      maxUses: 50,
      usedCount: 0,
      expiresAtMs: NOW + 86_400_000,
      isActive: true,
      createdAtMs: NOW,
    },
    {
      code: 'HEN-GIFT1',
      label: 'Starter Hen Gift',
      coins: 0,
      rewardType: 'chicken' as const,
      chickenBreed: 'rhode' as const,
      chickenQty: 2,
      maxUses: 10,
      usedCount: 0,
      expiresAtMs: 0,
      isActive: true,
      createdAtMs: NOW,
    },
  ];

  // Redeem Eggs Gift Code
  const eggClaim = claimPromoCode(profile, 'eggs-2500', NOW + 5000, promos);
  assert.ok(!('error' in eggClaim));
  assert.equal(eggClaim.rewardEggs, 2500);
  assert.equal(eggClaim.rewardCoins, 0);
  assert.equal(eggClaim.profile.eggs, 2500);
  assert.equal(eggClaim.profile.coins, profile.coins);
  assert.equal(eggClaim.transaction.currency, 'eggs');
  assert.equal(eggClaim.transaction.amount, 2500);

  // Redeem Chicken Hen Gift Code when farm previously had 0 chickens -> updates lastCollectedAt
  const henClaim = claimPromoCode(eggClaim.profile, 'HEN-GIFT1', NOW + 10_000, promos);
  assert.ok(!('error' in henClaim));
  assert.equal(henClaim.rewardChickenBreed, 'rhode');
  assert.equal(henClaim.rewardChickenQty, 2);
  assert.equal(henClaim.profile.rhodeCount, 2);
  assert.equal(henClaim.profile.lastCollectedAt, NOW + 10_000);
  assert.equal(henClaim.rewardSummary, '+2 Rhode Island Red');
});

test('REQUIRED_TELEGRAM_CHANNELS lists @AIRDROP_GALAXYS and @AG_PAYOUTS and membership helpers parse statuses accurately', () => {
  assert.deepEqual(
    REQUIRED_TELEGRAM_CHANNELS.map((c) => c.handle),
    ['@AIRDROP_GALAXYS', '@AG_PAYOUTS'],
  );
  assert.deepEqual(
    REQUIRED_TELEGRAM_CHANNELS.map((c) => c.url),
    ['https://t.me/AIRDROP_GALAXYS', 'https://t.me/AG_PAYOUTS'],
  );

  // Numeric Telegram user ID extraction
  assert.equal(extractTelegramNumericUserId('tg_778899123'), '778899123');
  assert.equal(extractTelegramNumericUserId('778899123'), '778899123');
  assert.equal(extractTelegramNumericUserId('player_guest_abc'), null);
  assert.equal(extractTelegramNumericUserId(''), null);

  // getChatMember status validation
  assert.equal(isTelegramMemberStatusJoined('member'), true);
  assert.equal(isTelegramMemberStatusJoined('administrator'), true);
  assert.equal(isTelegramMemberStatusJoined('creator'), true);
  assert.equal(isTelegramMemberStatusJoined('restricted', true), true);
  assert.equal(isTelegramMemberStatusJoined('restricted', false), false);
  assert.equal(isTelegramMemberStatusJoined('left'), false);
  assert.equal(isTelegramMemberStatusJoined('kicked'), false);
  assert.equal(isTelegramMemberStatusJoined(''), false);
});

test('ad-gate policy requires ads for startup, egg collect, gift claim, and ad cards while exempting tasks, withdraw, deposit, and miner buy', () => {
  for (const gated of AD_GATED_ACTIONS) {
    assert.equal(shouldRequireAdForAction(gated), true);
  }
  for (const exempt of AD_EXEMPT_ACTIONS) {
    assert.equal(shouldRequireAdForAction(exempt), false);
  }

  assert.equal(shouldRequireAdForAction('startup'), true);
  assert.equal(shouldRequireAdForAction('collect_eggs'), true);
  assert.equal(shouldRequireAdForAction('claim_promo'), true);
  assert.equal(shouldRequireAdForAction('ad_network'), true);
  assert.equal(shouldRequireAdForAction('watch_ad'), true);

  assert.equal(shouldRequireAdForAction('task'), false);
  assert.equal(shouldRequireAdForAction('withdraw'), false);
  assert.equal(shouldRequireAdForAction('deposit'), false);
  assert.equal(shouldRequireAdForAction('buy_chicken'), false);

  const { profile } = createDefaultProfile('player_adgate1', 'Dev', '@dev', NOW);
  assert.equal(getTotalAdsWatched(profile), 0);
  const afterOne = recordCompletedGateAd(profile);
  assert.equal(getTotalAdsWatched(afterOne), 1);

  const baseConfig = {
    provider: 'adsgram' as const,
    adsgramBlockId: '1234',
    gigapubProjectId: '',
    monetagZoneId: '998877',
    customTitle: 'Test',
    customDescription: 'Test',
    customUrl: '',
    watchSeconds: 5,
    bannerEnabled: false,
    bannerTitle: '',
    bannerSubtitle: '',
    bannerCtaText: '',
    bannerUrl: '',
    updatedAtMs: 0,
  };
  assert.equal(hasConfiguredAdNetworkSdk('adsgram', baseConfig), true);
  assert.equal(hasConfiguredAdNetworkSdk('gigapub', baseConfig), false);
  assert.equal(hasConfiguredAdNetworkSdk('monetag', baseConfig), true);
  assert.equal(resolveEffectiveAdConfig(baseConfig).adsgramBlockId, '1234');
});

