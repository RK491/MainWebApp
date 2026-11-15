import type {
  AdConfig,
  ChickenBreedId,
  ChickenPack,
  DepositNetwork,
  DepositOrder,
  DynamicPromoCode,
  LeaderboardEntry,
  ReferralRecord,
  SeasonConfig,
  TaskDefinition,
  TransactionEntry,
  UserFarmProfile,
  WithdrawalOrder,
  WithdrawalStatus,
} from '../types/farm';

export const USD_PER_EGG = 0.00000694;
export const GRAM_USD_PRICE = 1.133;
export const COINS_PER_USD = 10000;
export const COINS_PER_GRAM = Math.round(GRAM_USD_PRICE * COINS_PER_USD);
export const MIN_DEPOSIT_COINS = 1000;
export const MAX_DEPOSIT_COINS = 15000;
export const MIN_WITHDRAW_EGGS = 100;
export const MIN_REINVEST_EGGS = 100;
export const SIGNUP_BONUS_COINS = 1000;
export const REFERRER_SIGNUP_BONUS_COINS = 150;
export const REFERRER_SIGNUP_BONUS_EGGS = 500;
export const REFERRER_LIFETIME_EGG_COMMISSION_RATE = 0.05;
export const REFERRED_WELCOME_BONUS_COINS = 100;

export function calculateReferralEggCommission(collectedEggs: number): number {
  const safe = Math.max(0, Math.floor(collectedEggs));
  if (safe <= 0) return 0;
  return Math.max(1, Math.round(safe * REFERRER_LIFETIME_EGG_COMMISSION_RATE));
}

export function calculateReferralBonusEggs(coinsEarned: number): number {
  return Math.max(0, Math.round(Math.max(0, coinsEarned) * 2.5));
}

export function summarizeReferrals(referrals: ReferralRecord[]): {
  activeCount: number;
  pendingCount: number;
  totalBonusEggs: number;
  totalToppedUp: number;
} {
  let activeCount = 0;
  let pendingCount = 0;
  let totalBonusEggs = 0;
  let totalToppedUp = 0;

  for (const r of referrals) {
    if (r.status === 'pending') {
      pendingCount += 1;
    } else {
      activeCount += 1;
      totalBonusEggs += calculateReferralBonusEggs(r.coinsEarned || 0);
    }
    totalToppedUp += r.toppedUpUsd || 0;
  }

  return {
    activeCount,
    pendingCount,
    totalBonusEggs,
    totalToppedUp,
  };
}

export interface InvitedFriendSummary extends ReferralRecord {
  formattedHandle: string;
  eggsGenerated: number;
}

export function formatReferralHandle(handle: string, fallbackUid = ''): string {
  const trimmed = (handle || '').trim();
  if (trimmed) {
    return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
  }
  const suffix = fallbackUid.replace(/[^a-zA-Z0-9_-]/g, '').slice(-6).toLowerCase() || 'farmer';
  return `@${suffix}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function titleContainsHandle(title: string, handle: string): boolean {
  if (!handle || handle === '@') return false;
  const pattern = new RegExp(`(^|[\\s(])${escapeRegExp(handle.toLowerCase())}([\\s):,]|$)`);
  return pattern.test(title.toLowerCase());
}

export function buildInvitedFriendsList(
  referrals: ReferralRecord[],
  transactions: TransactionEntry[] = [],
): InvitedFriendSummary[] {
  const eggsByReferralKey = new Map<string, number>();

  for (const r of referrals) {
    eggsByReferralKey.set(r.id, Math.max(0, Math.floor(r.eggsEarned ?? 0)));
  }

  for (const tx of transactions) {
    if (tx.type !== 'referral' || tx.currency !== 'eggs' || tx.amount <= 0) {
      continue;
    }
    const title = (tx.title || '').trim();
    if (!title) continue;

    // 1. Match by explicit handle token (new format: "5% eggs · @handle (Display Name)")
    let matched = referrals.find((r) => {
      const h = formatReferralHandle(r.referredHandle, r.referredUid);
      return titleContainsHandle(title, h);
    });

    // 2. Backwards-compatible fallback for legacy titles ("5% lifetime eggs from Display Name")
    if (!matched) {
      const legacyMatch = title.match(/^5%\s+lifetime\s+eggs\s+from\s+(.+)$/i);
      const extractedName = legacyMatch?.[1]?.trim().toLowerCase() ?? '';
      if (extractedName) {
        matched =
          referrals.find(
            (r) =>
              r.status === 'active' &&
              r.referredName.trim().toLowerCase().slice(0, 56) === extractedName,
          ) ||
          referrals.find(
            (r) => r.referredName.trim().toLowerCase().slice(0, 56) === extractedName,
          );
      }
    }

    if (matched) {
      const prev = eggsByReferralKey.get(matched.id) ?? 0;
      eggsByReferralKey.set(matched.id, prev + Math.floor(tx.amount));
    }
  }

  return [...referrals]
    .sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0))
    .map((friend) => ({
      ...friend,
      formattedHandle: formatReferralHandle(friend.referredHandle, friend.referredUid),
      eggsGenerated: eggsByReferralKey.get(friend.id) ?? 0,
    }));
}

export interface DailyReferralGrowthPoint {
  dateKey: string;
  label: string;
  fullDate: string;
  newReferrals: number;
  activeReferrals: number;
  pendingReferrals: number;
}

function toLocalDateKey(ms: number): string {
  const d = new Date(ms);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function buildReferralGrowthSeries(
  referrals: ReferralRecord[],
  nowMs = Date.now(),
  days = 7,
): DailyReferralGrowthPoint[] {
  const safeDays = Math.max(1, Math.min(30, Math.floor(days)));
  const today = new Date(nowMs);
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const buckets = new Map<string, DailyReferralGrowthPoint>();
  const orderedKeys: string[] = [];

  for (let offset = safeDays - 1; offset >= 0; offset -= 1) {
    const dayDate = new Date(todayStart);
    dayDate.setDate(todayStart.getDate() - offset);
    const dateKey = toLocalDateKey(dayDate.getTime());
    const label = dayDate.toLocaleDateString('en-US', { weekday: 'short' });
    const fullDate = dayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    orderedKeys.push(dateKey);
    buckets.set(dateKey, {
      dateKey,
      label,
      fullDate,
      newReferrals: 0,
      activeReferrals: 0,
      pendingReferrals: 0,
    });
  }

  for (const r of referrals) {
    if (!Number.isFinite(r.createdAtMs) || r.createdAtMs <= 0) continue;
    const key = toLocalDateKey(r.createdAtMs);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.newReferrals += 1;
    if (r.status === 'pending') {
      bucket.pendingReferrals += 1;
    } else {
      bucket.activeReferrals += 1;
    }
  }

  return orderedKeys.map((k) => buckets.get(k)!);
}

export const DEFAULT_GRAM_DEPOSIT_ADDRESS =
  'UQAOZ7I-xhBLou2dkPqKUdQKA_ZbwKBjP_p85i73Fp2P1RXr';
export const DEFAULT_GRAM_JETTON_MASTER =
  'EQC47093oX5Xhb0xuk2lCr2RhS8rj-vul61u4W2UH5ORmG_O';

export const CHICKEN_PACKS: ChickenPack[] = [
  {
    id: 'leghorn',
    name: 'White Leghorn',
    eggsPerHour: 8,
    coinCost: 1000,
    usdCost: 0.1,
    leaderboardPoints: 1,
    tagline: 'Reliable daily layer for starter coops',
    accentColor: '#F59E0B',
  },
  {
    id: 'rhode',
    name: 'Rhode Island Red',
    eggsPerHour: 23,
    coinCost: 3000,
    usdCost: 0.3,
    leaderboardPoints: 3,
    tagline: 'Hardy heritage hen with strong yield',
    accentColor: '#DC2626',
  },
  {
    id: 'orpington',
    name: 'Buff Orpington',
    eggsPerHour: 75,
    coinCost: 10000,
    usdCost: 1.0,
    leaderboardPoints: 10,
    tagline: 'Golden heavy-producing farm favorite',
    accentColor: '#D97706',
  },
  {
    id: 'australorp',
    name: 'Australorp',
    eggsPerHour: 225,
    coinCost: 30000,
    usdCost: 3.0,
    leaderboardPoints: 30,
    tagline: 'Champion egg layer for top ranks',
    accentColor: '#1E293B',
  },
];

export const BASKET_TIERS = [
  { hours: 8, capacity: 300, upgradeCost: 0 },
  { hours: 12, capacity: 550, upgradeCost: 10000 },
  { hours: 24, capacity: 1200, upgradeCost: 25000 },
];

export const DAILY_STREAK_REWARDS = [30, 40, 50, 60, 70, 80, 100];

export const PROMO_CODES: Record<string, { coins: number; label: string }> = {
  CHICKEN2026: { coins: 500, label: 'Welcome Coop Bonus' },
  EGGS100: { coins: 150, label: 'Daily Egg Drop' },
  WELCOME50: { coins: 100, label: 'Starter Pack Code' },
  GRAMTON: { coins: 300, label: 'TON Community Drop' },
};

export const TASK_DEFINITIONS: TaskDefinition[] = [
  {
    id: 'daily_news',
    category: 'daily',
    title: 'Check in on our news channel',
    rewardCoins: 20,
    icon: 'megaphone',
  },
  {
    id: 'daily_payments',
    category: 'daily',
    title: 'Check in on our payments channel',
    rewardCoins: 20,
    icon: 'wallet',
  },
  {
    id: 'daily_promos',
    category: 'daily',
    title: 'Check in on our promo codes channel',
    rewardCoins: 20,
    icon: 'ticket',
  },
  {
    id: 'daily_reinvest',
    category: 'daily',
    title: 'Reinvest eggs today',
    rewardCoins: 100,
    icon: 'refresh',
  },
  {
    id: 'milestone_react',
    category: 'milestone',
    title: 'React to our farm update post',
    rewardCoins: 50,
    icon: 'heart',
  },
  {
    id: 'milestone_join_news',
    category: 'milestone',
    title: 'Join Farm News community',
    rewardCoins: 100,
    icon: 'send',
  },
  {
    id: 'milestone_join_pay',
    category: 'milestone',
    title: 'Verify TON payout channel',
    rewardCoins: 100,
    icon: 'shield',
  },
  {
    id: 'partner_app',
    category: 'partner',
    title: 'Partner farm explorer',
    rewardCoins: 300,
    icon: 'link',
  },
  {
    id: 'partner_boost',
    category: 'partner',
    title: 'Community reaction bonus',
    rewardCoins: 500,
    icon: 'flame',
  },
];

export const DEFAULT_AD_CONFIG: AdConfig = {
  provider: 'countdown',
  adsgramBlockId: '',
  monetagZoneId: '',
  customTitle: 'Alpha Gram Partner Spotlight',
  customDescription: 'Watch this short sponsor showcase to earn 1 step toward a free White Leghorn.',
  customUrl: 'https://t.me/AIRDROP_GALAXYS',
  watchSeconds: 5,
  bannerEnabled: false,
  bannerTitle: 'Join @AIRDROP_GALAXYS',
  bannerSubtitle: 'Daily TON & GRAM drops, promo codes & partner rewards',
  bannerCtaText: 'Open',
  bannerUrl: 'https://t.me/AIRDROP_GALAXYS',
  updatedAtMs: 0,
};

export function mergeTaskDefinitions(customTasks: TaskDefinition[] = []): TaskDefinition[] {
  const activeCustom = customTasks.filter((t) => t.isActive !== false);
  return [...TASK_DEFINITIONS, ...activeCustom];
}

export function getWithdrawalStatusMeta(status: WithdrawalStatus): {
  label: string;
  tone: 'amber' | 'emerald' | 'rose';
} {
  if (status === 'approved' || status === 'completed') {
    return { label: 'Approved', tone: 'emerald' };
  }
  if (status === 'rejected') {
    return { label: 'Rejected', tone: 'rose' };
  }
  return { label: 'Pending Approval', tone: 'amber' };
}

export type WithdrawalFilterTab = 'all' | 'pending' | 'completed';

export function filterWithdrawalsByTab(
  withdrawals: WithdrawalOrder[],
  tab: WithdrawalFilterTab,
): WithdrawalOrder[] {
  if (tab === 'all') return withdrawals;
  if (tab === 'pending') {
    return withdrawals.filter((w) => w.status === 'pending' || w.status === 'processing');
  }
  return withdrawals.filter((w) => w.status === 'approved' || w.status === 'completed');
}

export const DEPOSIT_ADDRESSES: Record<DepositNetwork, { label: string; sub: string; address: string }> = {
  GRAM_TON: {
    label: 'GRAM',
    sub: 'TON',
    address: DEFAULT_GRAM_DEPOSIT_ADDRESS,
  },
};

export function getChickenPack(breed: ChickenBreedId): ChickenPack {
  const found = CHICKEN_PACKS.find((p) => p.id === breed);
  if (!found) {
    throw new Error(`Unknown chicken breed: ${breed}`);
  }
  return found;
}

export const LEVEL_YIELD_BONUS_PER_LEVEL = 0.02;
export const FEED_BOOSTER_COST_COINS = 400;
export const FEED_BOOSTER_DURATION_MS = 60 * 60 * 1000; // 1 hour
export const GOLDEN_EGG_COOLDOWN_MS = 45 * 1000; // 45 seconds
export const GOLDEN_EGG_REWARD_COINS = 25;
export const GOLDEN_EGG_REWARD_XP = 5;

export function calculateLevelYieldMultiplier(level: number): number {
  const safeLevel = Math.max(1, Math.floor(level || 1));
  return Number((1 + (safeLevel - 1) * LEVEL_YIELD_BONUS_PER_LEVEL).toFixed(2));
}

export function isFeedBoosterActive(
  profile: Pick<UserFarmProfile, 'feedBoostUntilMs'>,
  nowMs = Date.now(),
): boolean {
  return Number(profile.feedBoostUntilMs ?? 0) > nowMs;
}

export function calculateProductionRate(
  profile: Pick<
    UserFarmProfile,
    'leghornCount' | 'rhodeCount' | 'orpingtonCount' | 'australorpCount'
  > &
    Partial<Pick<UserFarmProfile, 'level' | 'feedBoostUntilMs'>>,
  nowMs?: number,
): number {
  const baseRate =
    profile.leghornCount * 8 +
    profile.rhodeCount * 23 +
    profile.orpingtonCount * 75 +
    profile.australorpCount * 225;

  const levelMult = calculateLevelYieldMultiplier(profile.level ?? 1);
  const feedMult =
    nowMs !== undefined && isFeedBoosterActive({ feedBoostUntilMs: profile.feedBoostUntilMs }, nowMs)
      ? 2
      : 1;

  return Math.round(baseRate * levelMult * feedMult);
}

export function calculateTotalChickens(
  profile: Pick<UserFarmProfile, 'leghornCount' | 'rhodeCount' | 'orpingtonCount' | 'australorpCount'>,
): number {
  return (
    profile.leghornCount +
    profile.rhodeCount +
    profile.orpingtonCount +
    profile.australorpCount
  );
}

export function calculateBuyerPoints(
  profile: Pick<UserFarmProfile, 'leghornCount' | 'rhodeCount' | 'orpingtonCount' | 'australorpCount'>,
): number {
  return (
    profile.leghornCount * 1 +
    profile.rhodeCount * 3 +
    profile.orpingtonCount * 10 +
    profile.australorpCount * 30
  );
}

export const CHICKEN_MILESTONES = [5, 10, 25, 50, 100] as const;

export interface ChickenMilestoneInfo {
  threshold: number;
  title: string;
  subtitle: string;
  badge: string;
}

const MILESTONE_COPY: Record<number, { title: string; subtitle: string }> = {
  5: {
    title: 'Flock Starter!',
    subtitle: '5 chickens clucking across your meadow',
  },
  10: {
    title: 'Coop Commander!',
    subtitle: '10 chickens laying eggs 24/7',
  },
  25: {
    title: 'Poultry Tycoon!',
    subtitle: '25 chickens powering your farm',
  },
  50: {
    title: 'Golden Flock!',
    subtitle: '50 chickens — booming egg harvest',
  },
  100: {
    title: 'Farm Legend!',
    subtitle: '100 chickens — unstoppable poultry empire',
  },
};

export function getChickenMilestoneReached(
  prevCount: number,
  nextCount: number,
): ChickenMilestoneInfo | null {
  if (nextCount <= prevCount) return null;
  let reached: number | null = null;
  for (const milestone of CHICKEN_MILESTONES) {
    if (prevCount < milestone && nextCount >= milestone) {
      reached = milestone;
    }
  }
  if (reached === null) return null;
  const copy = MILESTONE_COPY[reached] ?? {
    title: `${reached} Chickens!`,
    subtitle: `Your flock reached ${reached} total chickens`,
  };
  return {
    threshold: reached,
    title: copy.title,
    subtitle: copy.subtitle,
    badge: `${reached} Hens`,
  };
}

export function detectTop10RankCelebration(params: {
  previousRank: number | null;
  nextRank: number;
  hasInitialized: boolean;
}): boolean {
  if (!params.hasInitialized) return false;
  if (params.nextRank < 1 || params.nextRank > 10) return false;
  if (params.previousRank === null) return false;
  return params.previousRank > 10 || params.nextRank < params.previousRank;
}

export function eggsToUsd(eggs: number): number {
  return Number((Math.max(0, eggs) * USD_PER_EGG).toFixed(4));
}

export function eggsToGram(eggs: number): number {
  const usd = Math.max(0, eggs) * USD_PER_EGG;
  return Number((usd / GRAM_USD_PRICE).toFixed(6));
}

export function coinsToUsd(coins: number): number {
  return Number((Math.max(0, coins) / COINS_PER_USD).toFixed(3));
}

export function gramToCoins(gramAmount: number): number {
  const safeGram = Math.max(0, gramAmount);
  return Math.round(safeGram * GRAM_USD_PRICE * COINS_PER_USD);
}

export function coinsToGram(coins: number): number {
  const usd = Math.max(0, coins) / COINS_PER_USD;
  return Number((usd / GRAM_USD_PRICE).toFixed(4));
}

export function calculatePendingEggs(
  profile: Pick<
    UserFarmProfile,
    | 'leghornCount'
    | 'rhodeCount'
    | 'orpingtonCount'
    | 'australorpCount'
    | 'lastCollectedAt'
    | 'basketCapacity'
  > &
    Partial<Pick<UserFarmProfile, 'level' | 'feedBoostUntilMs'>>,
  nowMs: number,
): number {
  const ratePerHour = calculateProductionRate(profile, nowMs);
  const elapsedHours = Math.max(0, (nowMs - profile.lastCollectedAt) / (1000 * 60 * 60));
  const raw = Math.floor(ratePerHour * elapsedHours);
  return Math.min(profile.basketCapacity, Math.max(0, raw));
}

export function formatAwayDuration(ms: number): string {
  const totalMinutes = Math.max(1, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

export function getXpForLevel(level: number): number {
  return Math.max(10, level * 10);
}

function addXp(level: number, xp: number, gain: number): { level: number; xp: number } {
  let nextLevel = level;
  let nextXp = xp + gain;
  while (nextXp >= getXpForLevel(nextLevel)) {
    nextXp -= getXpForLevel(nextLevel);
    nextLevel += 1;
  }
  return { level: nextLevel, xp: nextXp };
}

export function collectEggs(
  profile: UserFarmProfile,
  nowMs: number,
  explicitAmount?: number,
):
  | {
      profile: UserFarmProfile;
      transaction: TransactionEntry;
      collected: number;
      referralEggCommission: number;
    }
  | { error: string } {
  const pending = explicitAmount !== undefined ? explicitAmount : calculatePendingEggs(profile, nowMs);
  if (pending <= 0) {
    if (calculateTotalChickens(profile) <= 0) {
      return { error: 'Buy your first chicken in Packs to start egg mining!' };
    }
    return { error: 'No eggs ready in basket yet. Wait for your hens to lay!' };
  }
  const collected = Math.min(profile.basketCapacity, Math.floor(pending));
  const usdAdded = eggsToUsd(collected);
  const { level, xp } = addXp(profile.level, profile.xp, Math.max(1, Math.floor(collected / 15)));

  const nextProfile: UserFarmProfile = {
    ...profile,
    eggs: profile.eggs + collected,
    totalEggsCollected: profile.totalEggsCollected + collected,
    totalCashEarnedUsd: Number((profile.totalCashEarnedUsd + usdAdded).toFixed(4)),
    level,
    xp,
    lastCollectedAt: nowMs,
  };

  const transaction: TransactionEntry = {
    id: `tx_collect_${nowMs}`,
    userId: profile.uid,
    type: 'collect',
    title: 'Collected eggs',
    amount: collected,
    currency: 'eggs',
    usdValue: usdAdded,
    status: 'completed',
    createdAtMs: nowMs,
  };

  const referralEggCommission = profile.referredBy
    ? calculateReferralEggCommission(collected)
    : 0;

  return { profile: nextProfile, transaction, collected, referralEggCommission };
}

export function buyChickens(
  profile: UserFarmProfile,
  breed: ChickenBreedId,
  quantity: number,
  nowMs: number,
): { profile: UserFarmProfile; transaction: TransactionEntry; shouldActivateReferral: boolean } | { error: string } {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
    return { error: 'Select a valid quantity between 1 and 50.' };
  }
  const pack = getChickenPack(breed);
  const totalCost = pack.coinCost * quantity;
  if (profile.coins < totalCost) {
    return { error: `Need ${totalCost.toLocaleString()} coins (you have ${profile.coins.toLocaleString()}).` };
  }

  const { level, xp } = addXp(profile.level, profile.xp, pack.leaderboardPoints * quantity * 2);
  const shouldActivateReferral = Boolean(profile.referredBy && !profile.referralActivated);
  const hadNoChickens = calculateTotalChickens(profile) === 0;

  const nextProfile: UserFarmProfile = {
    ...profile,
    coins: profile.coins - totalCost,
    leghornCount: profile.leghornCount + (breed === 'leghorn' ? quantity : 0),
    rhodeCount: profile.rhodeCount + (breed === 'rhode' ? quantity : 0),
    orpingtonCount: profile.orpingtonCount + (breed === 'orpington' ? quantity : 0),
    australorpCount: profile.australorpCount + (breed === 'australorp' ? quantity : 0),
    boughtThisWeek: profile.boughtThisWeek + quantity,
    referralActivated: true,
    lastCollectedAt: hadNoChickens ? nowMs : profile.lastCollectedAt,
    level,
    xp,
  };

  const transaction: TransactionEntry = {
    id: `tx_buy_${breed}_${nowMs}`,
    userId: profile.uid,
    type: 'buy_chicken',
    title: `Bought ${quantity}x ${pack.name}`,
    amount: -totalCost,
    currency: 'coins',
    usdValue: Number((pack.usdCost * quantity).toFixed(2)),
    status: 'completed',
    createdAtMs: nowMs,
  };

  return { profile: nextProfile, transaction, shouldActivateReferral };
}

export function buildDeterministicDepositIds(txHash: string): {
  depositId: string;
  txId: string;
  refCommissionTxId: string;
} {
  const canonical = txHash.trim().toLowerCase();
  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b9;
  for (let i = 0; i < canonical.length; i += 1) {
    const code = canonical.charCodeAt(i);
    hashA ^= code;
    hashA = Math.imul(hashA, 0x01000193);
    hashB ^= code + i;
    hashB = Math.imul(hashB, 0x85ebca6b);
  }
  const digest = `${(hashA >>> 0).toString(16).padStart(8, '0')}${(hashB >>> 0).toString(16).padStart(8, '0')}`;
  const safePrefix = canonical.replace(/[^a-z0-9_-]/g, '_').slice(0, 32) || 'tx';
  return {
    depositId: `dep_${safePrefix}_${digest}`.slice(0, 64),
    txId: `tx_dep_${safePrefix}_${digest}`.slice(0, 64),
    refCommissionTxId: `tx_ref_${safePrefix}_${digest}`.slice(0, 64),
  };
}

export function createDepositQuote(
  coinsAmount: number,
  network: DepositNetwork = 'GRAM_TON',
  depositAddress = DEPOSIT_ADDRESSES.GRAM_TON.address,
): {
  coinsAmount: number;
  bonusCoins: number;
  totalCoins: number;
  usdAmount: number;
  gramAmount: number;
  cryptoAmount: string;
  depositAddress: string;
} {
  const safeCoins = Math.min(
    MAX_DEPOSIT_COINS,
    Math.max(MIN_DEPOSIT_COINS, Math.round(coinsAmount)),
  );
  const usdAmount = Number((safeCoins / COINS_PER_USD).toFixed(2));
  const gramAmount = coinsToGram(safeCoins);
  const cryptoAmount = `${gramAmount.toFixed(4)} GRAM`;

  return {
    coinsAmount: safeCoins,
    bonusCoins: 0,
    totalCoins: safeCoins,
    usdAmount,
    gramAmount,
    cryptoAmount,
    depositAddress: depositAddress || DEPOSIT_ADDRESSES[network].address,
  };
}

export function executeDeposit(
  profile: UserFarmProfile,
  coinsAmount: number,
  network: DepositNetwork,
  nowMs: number,
  txHash = '',
  explicitGramAmount?: number,
  depositAddress = DEPOSIT_ADDRESSES.GRAM_TON.address,
):
  | {
      profile: UserFarmProfile;
      deposit: DepositOrder;
      transaction: TransactionEntry;
      referrerCommissionCoins: number;
    }
  | { error: string } {
  const computedCoins =
    explicitGramAmount !== undefined && explicitGramAmount > 0
      ? gramToCoins(explicitGramAmount)
      : Math.round(coinsAmount);

  if (computedCoins < MIN_DEPOSIT_COINS) {
    return {
      error: `Minimum deposit is ${MIN_DEPOSIT_COINS.toLocaleString()} coins (≈ ${coinsToGram(MIN_DEPOSIT_COINS).toFixed(4)} GRAM).`,
    };
  }

  if (computedCoins > MAX_DEPOSIT_COINS) {
    return {
      error: `Maximum deposit is ${MAX_DEPOSIT_COINS.toLocaleString()} coins (≈ ${coinsToGram(MAX_DEPOSIT_COINS).toFixed(4)} GRAM).`,
    };
  }

  const usdAmount = Number(Math.max(0.1, computedCoins / COINS_PER_USD).toFixed(2));
  const gramStr =
    explicitGramAmount !== undefined && explicitGramAmount > 0
      ? `${explicitGramAmount.toFixed(4)} GRAM`
      : `${coinsToGram(computedCoins).toFixed(4)} GRAM`;

  const cleanTxHash = txHash.trim().slice(0, 128);
  if (!cleanTxHash) {
    return { error: 'On-chain GRAM transaction hash is required to credit points.' };
  }

  const ids = buildDeterministicDepositIds(cleanTxHash);

  const nextProfile: UserFarmProfile = {
    ...profile,
    coins: profile.coins + computedCoins,
    firstDepositBonusUsed: true,
  };

  const deposit: DepositOrder = {
    id: ids.depositId,
    userId: profile.uid,
    coinsAmount: computedCoins,
    bonusCoins: 0,
    usdAmount,
    network,
    cryptoAmount: gramStr,
    depositAddress,
    txHash: cleanTxHash,
    status: 'completed',
    createdAtMs: nowMs,
  };

  const transaction: TransactionEntry = {
    id: ids.txId,
    userId: profile.uid,
    type: 'deposit',
    title: `GRAM Deposit (${gramStr})`,
    amount: computedCoins,
    currency: 'coins',
    usdValue: usdAmount,
    status: 'completed',
    createdAtMs: nowMs,
  };

  const referrerCommissionCoins = profile.referredBy
    ? Math.max(1, Math.round(computedCoins * 0.05))
    : 0;

  return { profile: nextProfile, deposit, transaction, referrerCommissionCoins };
}

export function calculateReinvestCoins(eggsAmount: number): {
  baseCoins: number;
  bonusCoins: number;
  totalCoins: number;
} {
  const safeEggs = Math.max(0, Math.floor(eggsAmount));
  const baseCoins = Math.max(1, Math.round(safeEggs * 0.07));
  const bonusCoins = Math.max(1, Math.round(baseCoins * 0.2));
  return {
    baseCoins,
    bonusCoins,
    totalCoins: baseCoins + bonusCoins,
  };
}

export function reinvestEggs(
  profile: UserFarmProfile,
  eggsAmount: number,
  nowMs: number,
): { profile: UserFarmProfile; transaction: TransactionEntry; coinsReceived: number } | { error: string } {
  const safeEggs = Math.floor(eggsAmount);
  if (safeEggs < MIN_REINVEST_EGGS) {
    return { error: `Minimum reinvest amount is ${MIN_REINVEST_EGGS} eggs.` };
  }
  if (safeEggs > profile.eggs) {
    return { error: 'Not enough eggs in your balance.' };
  }
  const { totalCoins } = calculateReinvestCoins(safeEggs);
  const nextProfile: UserFarmProfile = {
    ...profile,
    eggs: profile.eggs - safeEggs,
    coins: profile.coins + totalCoins,
  };

  const transaction: TransactionEntry = {
    id: `tx_reinv_${nowMs}`,
    userId: profile.uid,
    type: 'reinvest',
    title: `Reinvested ${safeEggs.toLocaleString()} eggs (+20%)`,
    amount: totalCoins,
    currency: 'coins',
    usdValue: coinsToUsd(totalCoins),
    status: 'completed',
    createdAtMs: nowMs,
  };

  return { profile: nextProfile, transaction, coinsReceived: totalCoins };
}

export function validateWithdrawalInput(
  profile: Pick<UserFarmProfile, 'eggs'>,
  eggsAmount: number,
  walletAddress: string,
): string | null {
  const trimmed = walletAddress.trim();
  if (trimmed.length < 6) {
    return 'Enter a valid TON wallet address (at least 6 characters, e.g. UQ...).';
  }
  if (!Number.isFinite(eggsAmount) || Math.floor(eggsAmount) < MIN_WITHDRAW_EGGS) {
    return `Minimum withdrawal is ${MIN_WITHDRAW_EGGS} eggs.`;
  }
  if (Math.floor(eggsAmount) > profile.eggs) {
    return 'Insufficient egg balance for this withdrawal.';
  }
  return null;
}

export function executeWithdrawal(
  profile: UserFarmProfile,
  eggsAmount: number,
  walletAddress: string,
  memo: string,
  nowMs: number,
): { profile: UserFarmProfile; withdrawal: WithdrawalOrder; transaction: TransactionEntry } | { error: string } {
  const err = validateWithdrawalInput(profile, eggsAmount, walletAddress);
  if (err) return { error: err };

  const safeEggs = Math.floor(eggsAmount);
  const usdValue = eggsToUsd(safeEggs);
  const gramAmount = eggsToGram(safeEggs).toFixed(6);
  const cleanAddress = walletAddress.trim();
  const cleanMemo = memo.trim().slice(0, 64);

  const nextProfile: UserFarmProfile = {
    ...profile,
    eggs: profile.eggs - safeEggs,
    totalWithdrawnUsd: Number((profile.totalWithdrawnUsd + usdValue).toFixed(4)),
  };

  const withdrawal: WithdrawalOrder = {
    id: `wd_${nowMs}`,
    txId: `tx_wd_${nowMs}`,
    userId: profile.uid,
    eggsAmount: safeEggs,
    gramAmount,
    usdValue,
    walletAddress: cleanAddress,
    memo: cleanMemo,
    network: 'GRAM_TON',
    status: 'pending',
    createdAtMs: nowMs,
  };

  const transaction: TransactionEntry = {
    id: `tx_wd_${nowMs}`,
    userId: profile.uid,
    type: 'withdraw',
    title: `Withdraw ${gramAmount} GRAM`,
    amount: -safeEggs,
    currency: 'eggs',
    usdValue,
    status: 'pending',
    createdAtMs: nowMs,
  };

  return { profile: nextProfile, withdrawal, transaction };
}

export function claimDailyStreak(
  profile: UserFarmProfile,
  todayStr: string,
  nowMs: number,
): { profile: UserFarmProfile; transaction: TransactionEntry; rewardCoins: number } | { error: string } {
  if (profile.lastDailyClaimDate === todayStr) {
    return { error: 'Daily login already claimed today. Come back tomorrow!' };
  }
  const nextStreak = profile.dailyStreak >= 7 ? 1 : profile.dailyStreak + 1;
  const rewardCoins = DAILY_STREAK_REWARDS[nextStreak - 1] ?? 30;

  const nextProfile: UserFarmProfile = {
    ...profile,
    coins: profile.coins + rewardCoins,
    dailyStreak: nextStreak,
    lastDailyClaimDate: todayStr,
  };

  const transaction: TransactionEntry = {
    id: `tx_daily_${nowMs}`,
    userId: profile.uid,
    type: 'task',
    title: `Daily Login Day ${nextStreak}`,
    amount: rewardCoins,
    currency: 'coins',
    usdValue: coinsToUsd(rewardCoins),
    status: 'completed',
    createdAtMs: nowMs,
  };

  return { profile: nextProfile, transaction, rewardCoins };
}

export function claimPromoCode(
  profile: UserFarmProfile,
  rawCode: string,
  nowMs: number,
  dynamicPromos: DynamicPromoCode[] = [],
): { profile: UserFarmProfile; transaction: TransactionEntry; rewardCoins: number; label: string; dynamicPromoCode?: string } | { error: string } {
  const code = rawCode.trim().toUpperCase();
  if (!code) {
    return { error: 'Enter a promo code first.' };
  }
  if (profile.claimedPromoCodes.includes(code)) {
    return { error: `Promo code ${code} was already claimed.` };
  }

  const dynamicMatch = dynamicPromos.find((p) => p.code.trim().toUpperCase() === code);
  if (dynamicMatch) {
    if (!dynamicMatch.isActive) {
      return { error: `Promo code ${code} is paused.` };
    }
    if (dynamicMatch.expiresAtMs > 0 && nowMs > dynamicMatch.expiresAtMs) {
      return { error: `Promo code ${code} has expired.` };
    }
    if (dynamicMatch.maxUses > 0 && dynamicMatch.usedCount >= dynamicMatch.maxUses) {
      return { error: `Promo code ${code} reached its maximum redemption limit.` };
    }

    const nextProfile: UserFarmProfile = {
      ...profile,
      coins: profile.coins + dynamicMatch.coins,
      claimedPromoCodes: [...profile.claimedPromoCodes, code].slice(-50),
    };

    const transaction: TransactionEntry = {
      id: `tx_promo_${nowMs}`,
      userId: profile.uid,
      type: 'promo',
      title: `Promo code ${code}`,
      amount: dynamicMatch.coins,
      currency: 'coins',
      usdValue: coinsToUsd(dynamicMatch.coins),
      status: 'completed',
      createdAtMs: nowMs,
    };

    return {
      profile: nextProfile,
      transaction,
      rewardCoins: dynamicMatch.coins,
      label: dynamicMatch.label,
      dynamicPromoCode: code,
    };
  }

  const promo = PROMO_CODES[code];
  if (!promo) {
    return { error: 'Invalid promo code. Get latest codes in @AIRDROP_GALAXYS.' };
  }

  const nextProfile: UserFarmProfile = {
    ...profile,
    coins: profile.coins + promo.coins,
    claimedPromoCodes: [...profile.claimedPromoCodes, code].slice(-50),
  };

  const transaction: TransactionEntry = {
    id: `tx_promo_${nowMs}`,
    userId: profile.uid,
    type: 'promo',
    title: `Promo code ${code}`,
    amount: promo.coins,
    currency: 'coins',
    usdValue: coinsToUsd(promo.coins),
    status: 'completed',
    createdAtMs: nowMs,
  };

  return { profile: nextProfile, transaction, rewardCoins: promo.coins, label: promo.label };
}

export function completeTask(
  profile: UserFarmProfile,
  taskId: string,
  nowMs: number,
  customTasks: TaskDefinition[] = [],
): { profile: UserFarmProfile; transaction: TransactionEntry; rewardCoins: number } | { error: string } {
  const allTasks = mergeTaskDefinitions(customTasks);
  const task = allTasks.find((t) => t.id === taskId);
  if (!task) {
    return { error: 'Task not found.' };
  }
  if (profile.completedTaskIds.includes(taskId)) {
    return { error: 'Task already completed.' };
  }

  const nextProfile: UserFarmProfile = {
    ...profile,
    coins: profile.coins + task.rewardCoins,
    completedTaskIds: [...profile.completedTaskIds, taskId].slice(-50),
  };

  const transaction: TransactionEntry = {
    id: `tx_task_${nowMs}`,
    userId: profile.uid,
    type: 'task',
    title: `Task: ${task.title.slice(0, 50)}`,
    amount: task.rewardCoins,
    currency: 'coins',
    usdValue: coinsToUsd(task.rewardCoins),
    status: 'completed',
    createdAtMs: nowMs,
  };

  return { profile: nextProfile, transaction, rewardCoins: task.rewardCoins };
}

export function watchAdStep(
  profile: UserFarmProfile,
  nowMs: number,
): { profile: UserFarmProfile; transaction?: TransactionEntry; unlockedChicken: boolean } {
  const nextCount = profile.watchedAdsCount + 1;
  if (nextCount >= 10) {
    const hadNoChickens = calculateTotalChickens(profile) === 0;
    const nextProfile: UserFarmProfile = {
      ...profile,
      watchedAdsCount: 0,
      leghornCount: profile.leghornCount + 1,
      lastCollectedAt: hadNoChickens ? nowMs : profile.lastCollectedAt,
    };
    const transaction: TransactionEntry = {
      id: `tx_ad_${nowMs}`,
      userId: profile.uid,
      type: 'task',
      title: '10/10 Ads: Free White Leghorn',
      amount: 1000,
      currency: 'coins',
      usdValue: 0.1,
      status: 'completed',
      createdAtMs: nowMs,
    };
    return { profile: nextProfile, transaction, unlockedChicken: true };
  }

  return {
    profile: {
      ...profile,
      watchedAdsCount: nextCount,
    },
    unlockedChicken: false,
  };
}

export function upgradeBasket(
  profile: UserFarmProfile,
  nowMs: number,
): { profile: UserFarmProfile; transaction: TransactionEntry } | { error: string } {
  const currentIdx = BASKET_TIERS.findIndex((t) => t.hours === profile.basketTierHours);
  const nextTier = BASKET_TIERS[currentIdx + 1];
  if (!nextTier) {
    return { error: 'Egg basket is already at maximum capacity (24 h).' };
  }
  if (profile.coins < nextTier.upgradeCost) {
    return { error: `Need ${nextTier.upgradeCost.toLocaleString()} coins to upgrade basket.` };
  }

  const nextProfile: UserFarmProfile = {
    ...profile,
    coins: profile.coins - nextTier.upgradeCost,
    basketTierHours: nextTier.hours,
    basketCapacity: nextTier.capacity,
  };

  const transaction: TransactionEntry = {
    id: `tx_basket_${nowMs}`,
    userId: profile.uid,
    type: 'upgrade_basket',
    title: `Upgraded basket (${nextTier.hours} h)`,
    amount: -nextTier.upgradeCost,
    currency: 'coins',
    usdValue: coinsToUsd(nextTier.upgradeCost),
    status: 'completed',
    createdAtMs: nowMs,
  };

  return { profile: nextProfile, transaction };
}

const AVATAR_COLORS = ['#EF4444', '#10B981', '#0284C7', '#D97706', '#7C3AED', '#E11D48'];

export function createReferralCodeFromUid(uid: string): string {
  const cleaned = uid.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const suffix = cleaned.slice(-6).padStart(6, 'X');
  return `CL-${suffix}`;
}

export function createDefaultProfile(
  uid: string,
  displayName: string,
  handle: string,
  nowMs: number,
  photoUrl = '',
): {
  profile: UserFarmProfile;
  transactions: TransactionEntry[];
  withdrawals: WithdrawalOrder[];
  deposits: DepositOrder[];
} {
  const colorIdx = uid.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % AVATAR_COLORS.length;
  const profile: UserFarmProfile = {
    uid,
    displayName: displayName || `Farmer ${uid.slice(-4).toUpperCase()}`,
    handle: handle || `@farmer_${uid.slice(-4).toLowerCase()}`,
    photoUrl: photoUrl.slice(0, 512),
    avatarColor: AVATAR_COLORS[colorIdx],
    level: 1,
    xp: 0,
    coins: SIGNUP_BONUS_COINS,
    eggs: 0,
    totalEggsCollected: 0,
    totalCashEarnedUsd: 0,
    totalWithdrawnUsd: 0,
    basketCapacity: 300,
    basketTierHours: 8,
    leghornCount: 0,
    rhodeCount: 0,
    orpingtonCount: 0,
    australorpCount: 0,
    boughtThisWeek: 0,
    dailyStreak: 0,
    lastDailyClaimDate: '',
    completedTaskIds: [],
    claimedPromoCodes: [],
    watchedAdsCount: 0,
    referralCode: createReferralCodeFromUid(uid),
    referredBy: '',
    referralActivated: false,
    referralCount: 0,
    referralCoinsEarned: 0,
    firstDepositBonusUsed: false,
    language: 'en',
    lastCollectedAt: nowMs,
    createdAtMs: nowMs,
    feedBoostUntilMs: 0,
    lastGoldenEggAtMs: 0,
    goldenEggsFound: 0,
    claimedAchievementIds: [],
    claimedReferralMilestones: [],
  };

  const transactions: TransactionEntry[] = [
    {
      id: `tx_welcome_${nowMs}`,
      userId: uid,
      type: 'task',
      title: 'Sign-Up Bonus (+1,000 coins)',
      amount: SIGNUP_BONUS_COINS,
      currency: 'coins',
      usdValue: 0.1,
      status: 'completed',
      createdAtMs: nowMs,
    },
  ];

  return { profile, transactions, withdrawals: [], deposits: [] };
}

export function buildLeaderboardRankings(
  entries: LeaderboardEntry[],
  currentUser: UserFarmProfile,
): {
  topBuyers: LeaderboardEntry[];
  topInviters: LeaderboardEntry[];
  topEggs: LeaderboardEntry[];
  userBuyerRank: number;
  userPercentile: number;
  pointsToTop10: number;
} {
  const userPoints = calculateBuyerPoints(currentUser);
  const userChickens = calculateTotalChickens(currentUser);

  const mergedMap = new Map<string, LeaderboardEntry>();
  for (const item of entries) {
    mergedMap.set(item.uid, { ...item, isCurrentUser: item.uid === currentUser.uid });
  }
  mergedMap.set(currentUser.uid, {
    uid: currentUser.uid,
    displayName: currentUser.displayName,
    handle: currentUser.handle,
    photoUrl: currentUser.photoUrl,
    avatarColor: currentUser.avatarColor,
    referralCode: currentUser.referralCode,
    buyerPoints: userPoints,
    inviterCount: currentUser.referralCount,
    eggs: currentUser.eggs,
    totalEggsCollected: currentUser.totalEggsCollected,
    chickensCount: userChickens,
    isCurrentUser: true,
  });

  const all = Array.from(mergedMap.values());
  const topBuyers = [...all].sort((a, b) => b.buyerPoints - a.buyerPoints || b.eggs - a.eggs).slice(0, 10);
  const topInviters = [...all].sort((a, b) => b.inviterCount - a.inviterCount || b.buyerPoints - a.buyerPoints).slice(0, 10);
  const topEggs = [...all].sort((a, b) => b.eggs - a.eggs || b.totalEggsCollected - a.totalEggsCollected).slice(0, 10);

  const sortedAllBuyers = [...all].sort((a, b) => b.buyerPoints - a.buyerPoints || b.eggs - a.eggs);
  const idx = sortedAllBuyers.findIndex((e) => e.uid === currentUser.uid);
  const userBuyerRank = idx === -1 ? sortedAllBuyers.length : idx + 1;
  const tenthPoints = topBuyers[9]?.buyerPoints ?? 0;
  const pointsToTop10 = topBuyers.length < 10 ? 0 : Math.max(0, tenthPoints + 1 - userPoints);
  const userPercentile = Math.max(1, Math.min(99, Math.round((userBuyerRank / Math.max(1, all.length)) * 100)));

  return {
    topBuyers,
    topInviters,
    topEggs,
    userBuyerRank,
    userPercentile,
    pointsToTop10,
  };
}

export function activateFeedBooster(
  profile: UserFarmProfile,
  nowMs: number,
): { profile: UserFarmProfile; transaction: TransactionEntry } | { error: string } {
  if (calculateTotalChickens(profile) <= 0) {
    return { error: 'Buy at least 1 chicken first to start mining before activating 2× Feed.' };
  }
  if (isFeedBoosterActive(profile, nowMs)) {
    return { error: '2× Laying Feed booster is already active on your farm!' };
  }
  if (profile.coins < FEED_BOOSTER_COST_COINS) {
    return {
      error: `Need ${FEED_BOOSTER_COST_COINS.toLocaleString()} coins for 2× Laying Feed.`,
    };
  }

  const nextProfile: UserFarmProfile = {
    ...profile,
    coins: profile.coins - FEED_BOOSTER_COST_COINS,
    feedBoostUntilMs: nowMs + FEED_BOOSTER_DURATION_MS,
  };

  const transaction: TransactionEntry = {
    id: `tx_boost_${nowMs}`,
    userId: profile.uid,
    type: 'booster',
    title: '2× Laying Feed (1h Boost)',
    amount: -FEED_BOOSTER_COST_COINS,
    currency: 'coins',
    usdValue: coinsToUsd(FEED_BOOSTER_COST_COINS),
    status: 'completed',
    createdAtMs: nowMs,
  };

  return { profile: nextProfile, transaction };
}

export function isGoldenEggReady(
  profile: Pick<UserFarmProfile, 'lastGoldenEggAtMs'>,
  nowMs: number,
): boolean {
  const last = Number(profile.lastGoldenEggAtMs ?? 0);
  return nowMs - last >= GOLDEN_EGG_COOLDOWN_MS;
}

export function claimGoldenEggDrop(
  profile: UserFarmProfile,
  nowMs: number,
):
  | {
      profile: UserFarmProfile;
      transaction: TransactionEntry;
      bonusCoins: number;
      xpGained: number;
    }
  | { error: string } {
  if (calculateTotalChickens(profile) <= 0) {
    return { error: 'Buy at least 1 chicken first to start mining!' };
  }
  if (!isGoldenEggReady(profile, nowMs)) {
    const secsLeft = Math.ceil(
      (GOLDEN_EGG_COOLDOWN_MS - (nowMs - Number(profile.lastGoldenEggAtMs ?? 0))) / 1000,
    );
    return { error: `Golden egg recharging (${Math.max(1, secsLeft)}s left).` };
  }

  const { level, xp } = addXp(profile.level, profile.xp, GOLDEN_EGG_REWARD_XP);
  const nextProfile: UserFarmProfile = {
    ...profile,
    coins: profile.coins + GOLDEN_EGG_REWARD_COINS,
    level,
    xp,
    lastGoldenEggAtMs: nowMs,
    goldenEggsFound: (profile.goldenEggsFound ?? 0) + 1,
  };

  const transaction: TransactionEntry = {
    id: `tx_gold_${nowMs}`,
    userId: profile.uid,
    type: 'golden_egg',
    title: 'Golden Egg Tap Drop',
    amount: GOLDEN_EGG_REWARD_COINS,
    currency: 'coins',
    usdValue: coinsToUsd(GOLDEN_EGG_REWARD_COINS),
    status: 'completed',
    createdAtMs: nowMs,
  };

  return {
    profile: nextProfile,
    transaction,
    bonusCoins: GOLDEN_EGG_REWARD_COINS,
    xpGained: GOLDEN_EGG_REWARD_XP,
  };
}

export interface AchievementDefinition {
  id: string;
  title: string;
  description: string;
  rewardCoins: number;
  target: number;
  getCurrent: (profile: UserFarmProfile) => number;
}

export const ACHIEVEMENT_DEFINITIONS: AchievementDefinition[] = [
  {
    id: 'first_harvest',
    title: 'First Harvest',
    description: 'Collect 100 total eggs',
    rewardCoins: 75,
    target: 100,
    getCurrent: (p) => p.totalEggsCollected,
  },
  {
    id: 'flock_5',
    title: 'Coop Builder',
    description: 'Own 5+ total chickens',
    rewardCoins: 150,
    target: 5,
    getCurrent: (p) => calculateTotalChickens(p),
  },
  {
    id: 'streak_3',
    title: 'Loyal Farmer',
    description: 'Reach a 3-day login streak',
    rewardCoins: 120,
    target: 3,
    getCurrent: (p) => p.dailyStreak,
  },
  {
    id: 'basket_pro',
    title: 'Bigger Basket',
    description: 'Upgrade basket to 12h+',
    rewardCoins: 250,
    target: 12,
    getCurrent: (p) => p.basketTierHours,
  },
  {
    id: 'friend_1',
    title: 'Farm Recruiter',
    description: 'Activate 1+ invited friend',
    rewardCoins: 200,
    target: 1,
    getCurrent: (p) => p.referralCount,
  },
  {
    id: 'egg_tycoon',
    title: 'Egg Tycoon',
    description: 'Collect 5,000 total eggs',
    rewardCoins: 500,
    target: 5000,
    getCurrent: (p) => p.totalEggsCollected,
  },
];

export interface AchievementStatus extends AchievementDefinition {
  current: number;
  unlocked: boolean;
  claimed: boolean;
}

export function getAchievementsProgress(profile: UserFarmProfile): AchievementStatus[] {
  const claimedSet = new Set(profile.claimedAchievementIds ?? []);
  return ACHIEVEMENT_DEFINITIONS.map((def) => {
    const current = Math.max(0, def.getCurrent(profile));
    return {
      ...def,
      current,
      unlocked: current >= def.target,
      claimed: claimedSet.has(def.id),
    };
  });
}

export function claimAchievement(
  profile: UserFarmProfile,
  achievementId: string,
  nowMs: number,
):
  | { profile: UserFarmProfile; transaction: TransactionEntry; rewardCoins: number; title: string }
  | { error: string } {
  const status = getAchievementsProgress(profile).find((a) => a.id === achievementId);
  if (!status) {
    return { error: 'Achievement not found.' };
  }
  if (!status.unlocked) {
    return { error: `Keep going — reach ${status.target.toLocaleString()} to unlock ${status.title}.` };
  }
  if (status.claimed) {
    return { error: `${status.title} reward was already claimed.` };
  }

  const nextProfile: UserFarmProfile = {
    ...profile,
    coins: profile.coins + status.rewardCoins,
    claimedAchievementIds: [...(profile.claimedAchievementIds ?? []), achievementId].slice(-50),
  };

  const transaction: TransactionEntry = {
    id: `tx_ach_${achievementId}_${nowMs}`.slice(0, 64),
    userId: profile.uid,
    type: 'achievement',
    title: `Achievement: ${status.title}`.slice(0, 80),
    amount: status.rewardCoins,
    currency: 'coins',
    usdValue: coinsToUsd(status.rewardCoins),
    status: 'completed',
    createdAtMs: nowMs,
  };

  return { profile: nextProfile, transaction, rewardCoins: status.rewardCoins, title: status.title };
}

export interface ReferralMilestoneCrate {
  targetActive: number;
  title: string;
  rewardCoins: number;
  bonusLeghorns: number;
}

export const REFERRAL_MILESTONE_CRATES: ReferralMilestoneCrate[] = [
  { targetActive: 3, title: 'Bronze Squad Crate', rewardCoins: 300, bonusLeghorns: 0 },
  { targetActive: 10, title: 'Silver Flock Crate', rewardCoins: 1200, bonusLeghorns: 1 },
  { targetActive: 25, title: 'Golden Tycoon Crate', rewardCoins: 3500, bonusLeghorns: 2 },
];

export function claimReferralMilestone(
  profile: UserFarmProfile,
  targetActive: number,
  activeReferralCount: number,
  nowMs: number,
):
  | { profile: UserFarmProfile; transaction: TransactionEntry; crate: ReferralMilestoneCrate }
  | { error: string } {
  const crate = REFERRAL_MILESTONE_CRATES.find((c) => c.targetActive === targetActive);
  if (!crate) {
    return { error: 'Referral milestone crate not found.' };
  }
  const effectiveActive = Math.max(profile.referralCount, activeReferralCount);
  if (effectiveActive < crate.targetActive) {
    return { error: `Invite ${crate.targetActive - effectiveActive} more active friends to unlock.` };
  }
  const claimed = profile.claimedReferralMilestones ?? [];
  if (claimed.includes(targetActive)) {
    return { error: `${crate.title} already claimed.` };
  }

  const hadNoChickens = calculateTotalChickens(profile) === 0;
  const nextProfile: UserFarmProfile = {
    ...profile,
    coins: profile.coins + crate.rewardCoins,
    leghornCount: profile.leghornCount + crate.bonusLeghorns,
    lastCollectedAt: hadNoChickens && crate.bonusLeghorns > 0 ? nowMs : profile.lastCollectedAt,
    claimedReferralMilestones: [...claimed, targetActive].slice(-20),
  };

  const bonusHenText = crate.bonusLeghorns > 0 ? ` + ${crate.bonusLeghorns} Leghorn` : '';
  const transaction: TransactionEntry = {
    id: `tx_refcrate_${targetActive}_${nowMs}`,
    userId: profile.uid,
    type: 'referral',
    title: `${crate.title}${bonusHenText}`.slice(0, 80),
    amount: crate.rewardCoins,
    currency: 'coins',
    usdValue: coinsToUsd(crate.rewardCoins),
    status: 'completed',
    createdAtMs: nowMs,
  };

  return { profile: nextProfile, transaction, crate };
}

export interface DailyEarningsChartPoint {
  dateKey: string;
  label: string;
  fullDate: string;
  eggsCollected: number;
  coinsEarned: number;
}

export function buildEarningsChartSeries(
  transactions: TransactionEntry[],
  nowMs = Date.now(),
  days = 7,
): DailyEarningsChartPoint[] {
  const safeDays = Math.max(1, Math.min(30, Math.floor(days)));
  const today = new Date(nowMs);
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const buckets = new Map<string, DailyEarningsChartPoint>();
  const orderedKeys: string[] = [];

  for (let offset = safeDays - 1; offset >= 0; offset -= 1) {
    const dayDate = new Date(todayStart);
    dayDate.setDate(todayStart.getDate() - offset);
    const dateKey = toLocalDateKey(dayDate.getTime());
    orderedKeys.push(dateKey);
    buckets.set(dateKey, {
      dateKey,
      label: dayDate.toLocaleDateString('en-US', { weekday: 'short' }),
      fullDate: dayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      eggsCollected: 0,
      coinsEarned: 0,
    });
  }

  for (const tx of transactions) {
    if (!Number.isFinite(tx.createdAtMs) || tx.createdAtMs <= 0) continue;
    const key = toLocalDateKey(tx.createdAtMs);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    if (tx.currency === 'eggs' && tx.amount > 0) {
      bucket.eggsCollected += Math.floor(tx.amount);
    } else if (tx.currency === 'coins' && tx.amount > 0) {
      bucket.coinsEarned += Math.floor(tx.amount);
    }
  }

  return orderedKeys.map((k) => buckets.get(k)!);
}

export function createDefaultSeasonConfig(nowMs = Date.now()): SeasonConfig {
  return {
    seasonNumber: 1,
    title: 'Harvest Cup Season 1',
    prizePoolCoins: 25000,
    endsAtMs: nowMs + 4 * 86_400_000,
    lastWinners: [],
    updatedAtMs: nowMs,
  };
}

