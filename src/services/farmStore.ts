import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromCache,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  buildDeterministicDepositIds,
  calculateBuyerPoints,
  calculateTotalChickens,
  canBanPlayerId,
  createDefaultProfile,
  createDefaultSeasonConfig,
  decodeAchievementsAndAds,
  decodePromoLabelMeta,
  decodeTaskSubtitleMeta,
  DEFAULT_AD_CONFIG,
  DEFAULT_CHANNELS_CONFIG,
  eggsToUsd,
  encodeAchievementsWithAds,
  encodePromoLabelMeta,
  encodeTaskSubtitleMeta,
  formatReferralHandle,
  isAdminPlayerId,
  normalizePlayerBanId,
  normalizeTelegramChannelEntry,
  REFERRED_WELCOME_BONUS_COINS,
  REFERRER_SIGNUP_BONUS_COINS,
  USER_TASK_MAX_REWARD_COINS,
  USER_TASK_MAX_SLOTS,
  USER_TASK_MIN_REWARD_COINS,
  USER_TASK_MIN_SLOTS,
  USER_TASK_MIN_TOTAL_COST_COINS,
} from '../game/economy';
import type {
  AdConfig,
  BannedUserRecord,
  ChannelsConfig,
  ChickenBreedId,
  DepositOrder,
  DynamicPromoCode,
  LeaderboardEntry,
  PromoRewardType,
  ReferralRecord,
  RequiredTelegramChannel,
  SeasonConfig,
  SeasonWinnerRecord,
  TaskDefinition,
  TransactionEntry,
  UserFarmProfile,
  WithdrawalOrder,
  WithdrawRequestRecord,
} from '../types/farm';
import { detectBrowserTelegramIdentity, type DetectedUserIdentity } from '../utils/telegram';

const PLAYER_ID_KEY = 'chickenland_player_id_v1';
const PLAYER_ID_COOKIE = 'chickenland_uid_v1';
const PROFILE_CACHE_PREFIX = 'chickenland_profile_cache_v1_';
const BAN_CACHE_PREFIX = 'chickenland_ban_cache_v1_';

function readCookiePlayerId(): string {
  try {
    if (typeof document === 'undefined') return '';
    const match = document.cookie.match(/(?:^|;\s*)chickenland_uid_v1=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  } catch {
    return '';
  }
}

export function createFreshPlayerId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  const ts = Date.now().toString(36).slice(-4);
  return `player_${ts}${rand}`;
}

export function getStoredPlayerId(): string {
  try {
    const existing =
      localStorage.getItem(PLAYER_ID_KEY) ||
      sessionStorage.getItem(PLAYER_ID_KEY) ||
      readCookiePlayerId();
    if (existing && /^[a-zA-Z0-9_-]{3,64}$/.test(existing)) {
      setStoredPlayerId(existing);
      return existing;
    }
  } catch {
    // Ignore storage errors
  }
  const fresh = createFreshPlayerId();
  setStoredPlayerId(fresh);
  return fresh;
}

export function setStoredPlayerId(playerId: string): void {
  try {
    localStorage.setItem(PLAYER_ID_KEY, playerId);
  } catch {
    // Ignore storage errors
  }
  try {
    sessionStorage.setItem(PLAYER_ID_KEY, playerId);
  } catch {
    // Ignore storage errors
  }
  try {
    if (typeof document !== 'undefined') {
      const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
      const sameSite = isHttps ? 'SameSite=None; Secure' : 'SameSite=Lax';
      document.cookie = `${PLAYER_ID_COOKIE}=${encodeURIComponent(playerId)}; max-age=31536000; path=/; ${sameSite}`;
    }
  } catch {
    // Ignore cookie errors
  }
}

export function loadCachedPlayerProfile(playerId: string): UserFarmProfile | null {
  try {
    if (typeof localStorage === 'undefined' || !playerId) return null;
    const raw = localStorage.getItem(`${PROFILE_CACHE_PREFIX}${playerId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;
    return parseProfileDoc(parsed, playerId);
  } catch {
    return null;
  }
}

export function saveCachedPlayerProfile(profile: UserFarmProfile): void {
  try {
    if (typeof localStorage === 'undefined' || !profile?.uid) return;
    localStorage.setItem(`${PROFILE_CACHE_PREFIX}${profile.uid}`, JSON.stringify(profile));
  } catch {
    // Ignore quota/storage errors
  }
}

export function resolveActivePlayerIdentity(): DetectedUserIdentity {
  const detected = detectBrowserTelegramIdentity();
  if (detected.playerId) {
    setStoredPlayerId(detected.playerId);
    return detected;
  }
  const fallbackId = getStoredPlayerId();
  const shortTag = fallbackId.slice(-4).toUpperCase();
  return {
    playerId: fallbackId,
    displayName: detected.displayName || `Farmer ${shortTag}`,
    handle: detected.handle || `@farmer_${fallbackId.slice(-4).toLowerCase()}`,
    photoUrl: detected.photoUrl || '',
    startParam: detected.startParam || '',
    isTelegramDetected: detected.isTelegramDetected,
  };
}

function isFirestorePermissionDenied(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return String(error || '').toLowerCase().includes('missing or insufficient permissions');
  }
  const rec = error as { code?: unknown; message?: unknown };
  const code = String(rec.code || '').toLowerCase();
  const msg = String(rec.message || '').toLowerCase();
  return code === 'permission-denied' || msg.includes('missing or insufficient permissions');
}

function isTransientOfflineFirestoreError(error: unknown): boolean {
  const rec = error && typeof error === 'object' ? (error as { code?: unknown; message?: unknown }) : null;
  const code = String(rec?.code || '').toLowerCase();
  const msg = String(rec?.message || error || '').toLowerCase();
  return (
    code === 'unavailable' ||
    code === 'failed-precondition' ||
    code === 'deadline-exceeded' ||
    msg.includes('client is offline') ||
    msg.includes('failed to get document') ||
    msg.includes('network') ||
    msg.includes('unavailable')
  );
}

function logSubscriptionError(path: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`[Firestore subscription error] ${path}: ${message}`);
}

function safeNonNegativeNum(value: unknown, fallback = 0): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function toFirestoreProfilePayload(profile: UserFarmProfile, isCreate: boolean) {
  const cumulativeAds = Math.max(
    0,
    Math.floor(safeNonNegativeNum(profile.totalAdsWatched ?? profile.watchedAdsCount, 0)),
  );
  const base = {
    uid: profile.uid,
    displayName: (profile.displayName || '').trim().slice(0, 60) || 'Farmer',
    handle: (profile.handle || '').trim().slice(0, 40) || '@farmer',
    photoUrl: (profile.photoUrl || '').slice(0, 512),
    avatarColor: (profile.avatarColor || '#EF4444').slice(0, 20),
    level: Math.max(1, Math.min(999, Math.floor(safeNonNegativeNum(profile.level, 1)))),
    xp: safeNonNegativeNum(profile.xp, 0),
    coins: safeNonNegativeNum(profile.coins, 0),
    eggs: safeNonNegativeNum(profile.eggs, 0),
    totalEggsCollected: safeNonNegativeNum(profile.totalEggsCollected, 0),
    totalCashEarnedUsd: safeNonNegativeNum(profile.totalCashEarnedUsd, 0),
    totalWithdrawnUsd: safeNonNegativeNum(profile.totalWithdrawnUsd, 0),
    basketCapacity: Math.max(300, safeNonNegativeNum(profile.basketCapacity, 300)),
    basketTierHours: Math.max(8, Math.min(72, safeNonNegativeNum(profile.basketTierHours, 8))),
    leghornCount: Math.floor(safeNonNegativeNum(profile.leghornCount, 0)),
    rhodeCount: Math.floor(safeNonNegativeNum(profile.rhodeCount, 0)),
    orpingtonCount: Math.floor(safeNonNegativeNum(profile.orpingtonCount, 0)),
    australorpCount: Math.floor(safeNonNegativeNum(profile.australorpCount, 0)),
    boughtThisWeek: Math.floor(safeNonNegativeNum(profile.boughtThisWeek, 0)),
    dailyStreak: Math.max(0, Math.min(7, Math.floor(safeNonNegativeNum(profile.dailyStreak, 0)))),
    lastDailyClaimDate: String(profile.lastDailyClaimDate || '').slice(0, 20),
    completedTaskIds: (profile.completedTaskIds ?? []).slice(0, 50),
    claimedPromoCodes: (profile.claimedPromoCodes ?? []).slice(0, 50),
    watchedAdsCount: Math.max(0, Math.min(10, Math.floor(safeNonNegativeNum(profile.watchedAdsCount, 0)))),
    referralCode: (profile.referralCode || `CL-${profile.uid.slice(-6).toUpperCase()}`).slice(0, 32),
    referredBy: (profile.referredBy || '').slice(0, 64),
    referralActivated: Boolean(profile.referralActivated),
    referralCount: Math.floor(safeNonNegativeNum(profile.referralCount, 0)),
    referralCoinsEarned: safeNonNegativeNum(profile.referralCoinsEarned, 0),
    firstDepositBonusUsed: Boolean(profile.firstDepositBonusUsed),
    language: (profile.language || 'en').slice(0, 16),
    lastCollectedAt: safeNonNegativeNum(profile.lastCollectedAt, Date.now()),
    createdAtMs: safeNonNegativeNum(profile.createdAtMs, Date.now()),
    feedBoostUntilMs: Math.max(0, safeNonNegativeNum(profile.feedBoostUntilMs, 0)),
    lastGoldenEggAtMs: Math.max(0, safeNonNegativeNum(profile.lastGoldenEggAtMs, 0)),
    goldenEggsFound: Math.max(0, Math.floor(safeNonNegativeNum(profile.goldenEggsFound, 0))),
    claimedAchievementIds: encodeAchievementsWithAds(
      profile.claimedAchievementIds ?? [],
      cumulativeAds,
    ),
    claimedReferralMilestones: (profile.claimedReferralMilestones ?? []).slice(0, 20),
    updatedAt: serverTimestamp(),
  };

  if (isCreate) {
    return {
      ...base,
      createdAt: serverTimestamp(),
    };
  }
  return base;
}

function toLeaderboardPayload(profile: UserFarmProfile) {
  return {
    uid: profile.uid,
    displayName: (profile.displayName || '').trim().slice(0, 60) || 'Farmer',
    handle: (profile.handle || '').trim().slice(0, 40) || '@farmer',
    photoUrl: (profile.photoUrl || '').slice(0, 512),
    avatarColor: (profile.avatarColor || '#EF4444').slice(0, 20),
    referralCode: (profile.referralCode || `CL-${profile.uid.slice(-6).toUpperCase()}`).slice(0, 32),
    buyerPoints: Math.max(0, calculateBuyerPoints(profile)),
    inviterCount: Math.max(0, Math.floor(safeNonNegativeNum(profile.referralCount, 0))),
    eggs: Math.max(0, safeNonNegativeNum(profile.eggs, 0)),
    totalEggsCollected: Math.max(0, safeNonNegativeNum(profile.totalEggsCollected, 0)),
    chickensCount: Math.max(0, calculateTotalChickens(profile)),
    updatedAt: serverTimestamp(),
  };
}

function parseProfileDoc(d: Record<string, unknown>, fallbackId: string): UserFarmProfile {
  const { claimedAchievementIds, totalAdsWatched } = decodeAchievementsAndAds(
    d.claimedAchievementIds,
    d.totalAdsWatched,
    d.watchedAdsCount,
  );
  return {
    uid: String(d.uid || fallbackId),
    displayName: String(d.displayName || 'Farmer'),
    handle: String(d.handle || '@farmer'),
    photoUrl: String(d.photoUrl || ''),
    avatarColor: String(d.avatarColor || '#EF4444'),
    level: Number(d.level ?? 1),
    xp: Number(d.xp ?? 0),
    coins: Number(d.coins ?? 0),
    eggs: Number(d.eggs ?? 0),
    totalEggsCollected: Number(d.totalEggsCollected ?? 0),
    totalCashEarnedUsd: Number(d.totalCashEarnedUsd ?? 0),
    totalWithdrawnUsd: Number(d.totalWithdrawnUsd ?? 0),
    basketCapacity: Number(d.basketCapacity ?? 300),
    basketTierHours: Number(d.basketTierHours ?? 8),
    leghornCount: Number(d.leghornCount ?? 0),
    rhodeCount: Number(d.rhodeCount ?? 0),
    orpingtonCount: Number(d.orpingtonCount ?? 0),
    australorpCount: Number(d.australorpCount ?? 0),
    boughtThisWeek: Number(d.boughtThisWeek ?? 0),
    dailyStreak: Number(d.dailyStreak ?? 0),
    lastDailyClaimDate: String(d.lastDailyClaimDate ?? ''),
    completedTaskIds: Array.isArray(d.completedTaskIds) ? (d.completedTaskIds as string[]) : [],
    claimedPromoCodes: Array.isArray(d.claimedPromoCodes) ? (d.claimedPromoCodes as string[]) : [],
    watchedAdsCount: Number(d.watchedAdsCount ?? 0),
    totalAdsWatched,
    referralCode: String(d.referralCode ?? `CL-${fallbackId.slice(-6).toUpperCase()}`),
    referredBy: String(d.referredBy ?? ''),
    referralActivated: Boolean(d.referralActivated),
    referralCount: Number(d.referralCount ?? 0),
    referralCoinsEarned: Number(d.referralCoinsEarned ?? 0),
    firstDepositBonusUsed: Boolean(d.firstDepositBonusUsed),
    language: (d.language as UserFarmProfile['language']) ?? 'en',
    lastCollectedAt: Number(d.lastCollectedAt ?? Date.now()),
    createdAtMs: Number(d.createdAtMs ?? Date.now()),
    feedBoostUntilMs: Number(d.feedBoostUntilMs ?? 0),
    lastGoldenEggAtMs: Number(d.lastGoldenEggAtMs ?? 0),
    goldenEggsFound: Number(d.goldenEggsFound ?? 0),
    claimedAchievementIds,
    claimedReferralMilestones: Array.isArray(d.claimedReferralMilestones)
      ? (d.claimedReferralMilestones as number[])
      : [],
  };
}

export async function ensurePlayerInFirestore(
  playerId: string,
  detected?: { displayName?: string; handle?: string; photoUrl?: string; isTelegramDetected?: boolean },
): Promise<{ profile: UserFarmProfile; isNewPlayer: boolean; fromCache?: boolean }> {
  const playerRef = doc(db, 'players', playerId);
  try {
    let snap;
    try {
      snap = await getDocFromServer(playerRef);
    } catch (serverErr) {
      if (isTransientOfflineFirestoreError(serverErr)) {
        try {
          const cachedSnap = await getDocFromCache(playerRef);
          if (cachedSnap.exists()) {
            const cachedProfile = parseProfileDoc(cachedSnap.data(), playerId);
            saveCachedPlayerProfile(cachedProfile);
            return { profile: cachedProfile, isNewPlayer: false, fromCache: true };
          }
        } catch {
          // Cache miss
        }
        const localFallback = loadCachedPlayerProfile(playerId);
        if (localFallback) {
          return { profile: localFallback, isNewPlayer: false, fromCache: true };
        }
      }
      throw serverErr;
    }

    if (snap.exists()) {
      const existing = parseProfileDoc(snap.data(), playerId);
      saveCachedPlayerProfile(existing);
      if (detected?.isTelegramDetected) {
        const nextName = (detected.displayName || existing.displayName).slice(0, 60);
        const nextHandle = (detected.handle || existing.handle).slice(0, 40);
        const nextPhoto = (detected.photoUrl ?? existing.photoUrl).slice(0, 512);
        if (
          nextName !== existing.displayName ||
          nextHandle !== existing.handle ||
          nextPhoto !== existing.photoUrl
        ) {
          const synced: UserFarmProfile = {
            ...existing,
            displayName: nextName,
            handle: nextHandle,
            photoUrl: nextPhoto,
          };
          const batch = writeBatch(db);
          batch.update(playerRef, toFirestoreProfilePayload(synced, false));
          batch.set(doc(db, 'leaderboard', playerId), toLeaderboardPayload(synced));
          await batch.commit();
          saveCachedPlayerProfile(synced);
          return { profile: synced, isNewPlayer: false };
        }
      }
      return { profile: existing, isNewPlayer: false };
    }

    const nowMs = Date.now();
    const shortTag = playerId.slice(-4).toUpperCase();
    const displayName = detected?.displayName?.trim() || `Farmer ${shortTag}`;
    const handle = detected?.handle?.trim() || `@farmer_${playerId.slice(-4).toLowerCase()}`;
    const photoUrl = detected?.photoUrl?.trim() || '';
    const seed = createDefaultProfile(playerId, displayName, handle, nowMs, photoUrl);

    const batch = writeBatch(db);
    batch.set(playerRef, toFirestoreProfilePayload(seed.profile, true));
    batch.set(doc(db, 'leaderboard', playerId), toLeaderboardPayload(seed.profile));

    for (const tx of seed.transactions) {
      const txId = tx.id.replace(/[^a-zA-Z0-9_-]/g, '_');
      batch.set(doc(db, 'players', playerId, 'transactions', txId), {
        userId: playerId,
        type: tx.type,
        title: tx.title.slice(0, 80),
        amount: tx.amount,
        currency: tx.currency,
        usdValue: tx.usdValue,
        status: tx.status,
        createdAtMs: tx.createdAtMs,
        createdAt: serverTimestamp(),
      });
    }

    await batch.commit();
    saveCachedPlayerProfile(seed.profile);
    return { profile: seed.profile, isNewPlayer: true };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `players/${playerId}`);
  }
}

export async function applyReferralCodeInFirestore(
  currentProfile: UserFarmProfile,
  rawCodeOrId: string,
): Promise<{ profile: UserFarmProfile; transaction: TransactionEntry; referrerName: string } | { error: string }> {
  const rawTrimmed = rawCodeOrId.trim();
  const strippedParam = rawTrimmed.replace(/^(?:ref|r)_/i, '').trim();
  const codeUpper = rawTrimmed.toUpperCase();
  if (!rawTrimmed || rawTrimmed.length < 3) {
    return { error: 'Enter a valid referral ID or code.' };
  }
  if (currentProfile.referredBy) {
    return { error: 'You have already used a referral link on this account.' };
  }

  const currentCanonicalUid = normalizePlayerBanId(currentProfile.uid) || currentProfile.uid;
  const candidateUid =
    normalizePlayerBanId(strippedParam) || normalizePlayerBanId(rawTrimmed);
  if (
    codeUpper === currentProfile.referralCode.toUpperCase() ||
    rawTrimmed === currentProfile.uid ||
    strippedParam === currentProfile.uid ||
    (candidateUid && candidateUid === currentCanonicalUid)
  ) {
    return { error: 'You cannot refer yourself.' };
  }

  try {
    let referrerUid = '';
    let referrerName = 'Farmer';

    // 1. Resolve directly by auto-detected Telegram ID / User ID (e.g. ?startapp=7508911853 or player_...)
    const candidateIds = Array.from(
      new Set(
        [candidateUid, strippedParam, rawTrimmed].filter(
          (id): id is string => Boolean(id && /^[a-zA-Z0-9_-]{3,64}$/.test(id)),
        ),
      ),
    );

    for (const id of candidateIds) {
      const playerSnap = await getDoc(doc(db, 'players', id));
      if (playerSnap.exists()) {
        referrerUid = playerSnap.id;
        referrerName = String(playerSnap.data().displayName || 'Farmer');
        break;
      }
      const lbSnap = await getDoc(doc(db, 'leaderboard', id));
      if (lbSnap.exists()) {
        referrerUid = lbSnap.id;
        referrerName = String(lbSnap.data().displayName || 'Farmer');
        break;
      }
    }

    // 2. Fallback to legacy CL-XXXXXX referralCode lookup
    if (!referrerUid) {
      const q = query(
        collection(db, 'leaderboard'),
        where('referralCode', '==', codeUpper),
        limit(1),
      );
      const matches = await getDocs(q);
      if (!matches.empty) {
        const referrerSnap = matches.docs[0];
        const referrerData = referrerSnap.data();
        referrerUid = String(referrerData.uid || referrerSnap.id);
        referrerName = String(referrerData.displayName || 'Farmer');
      }
    }

    if (!referrerUid) {
      return { error: `Referral ID "${rawTrimmed}" not found.` };
    }

    if (referrerUid === currentProfile.uid) {
      return { error: 'You cannot refer yourself.' };
    }

    const nowMs = Date.now();
    const nextProfile: UserFarmProfile = {
      ...currentProfile,
      referredBy: referrerUid,
      coins: currentProfile.coins + REFERRED_WELCOME_BONUS_COINS,
    };

    const userTx: TransactionEntry = {
      id: `tx_ref_join_${nowMs}`,
      userId: currentProfile.uid,
      type: 'referral',
      title: `Joined via ${referrerName}'s referral`,
      amount: REFERRED_WELCOME_BONUS_COINS,
      currency: 'coins',
      usdValue: 0.01,
      status: 'completed',
      createdAtMs: nowMs,
    };

    const batch = writeBatch(db);
    batch.update(doc(db, 'players', currentProfile.uid), toFirestoreProfilePayload(nextProfile, false));
    batch.set(doc(db, 'leaderboard', currentProfile.uid), toLeaderboardPayload(nextProfile));
    batch.set(doc(db, 'players', currentProfile.uid, 'transactions', userTx.id), {
      userId: currentProfile.uid,
      type: userTx.type,
      title: userTx.title,
      amount: userTx.amount,
      currency: userTx.currency,
      usdValue: userTx.usdValue,
      status: userTx.status,
      createdAtMs: userTx.createdAtMs,
      createdAt: serverTimestamp(),
    });

    // Referrals start as Pending until the invited player buys their 1st chicken using welcome bonus coins
    batch.set(doc(db, 'players', referrerUid, 'referrals', currentProfile.uid), {
      referrerUid,
      referredUid: currentProfile.uid,
      referredName: currentProfile.displayName.slice(0, 60),
      referredHandle: currentProfile.handle.slice(0, 40),
      status: 'pending',
      coinsEarned: 0,
      toppedUpUsd: 0,
      createdAtMs: nowMs,
      createdAt: serverTimestamp(),
    });

    await batch.commit();
    return { profile: nextProfile, transaction: userTx, referrerName };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `referrals/${rawTrimmed}`);
  }
}

export async function commitPlayerMutation(params: {
  profile: UserFarmProfile;
  transaction?: TransactionEntry;
  deposit?: DepositOrder;
  withdrawal?: WithdrawalOrder;
  referrerCommissionCoins?: number;
  referralEggCommission?: number;
  activateReferral?: boolean;
}): Promise<boolean> {
  const uid = params.profile.uid;
  saveCachedPlayerProfile(params.profile);

  if (params.activateReferral && params.profile.referredBy) {
    const refUid = params.profile.referredBy;
    const txId = params.transaction?.id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const nowMs = params.transaction?.createdAtMs ?? Date.now();

    const refDocRef = doc(db, 'players', refUid, 'referrals', uid);
    const referrerPlayerRef = doc(db, 'players', refUid);
    const referrerLbRef = doc(db, 'leaderboard', refUid);

    try {
      await runTransaction(db, async (transaction) => {
        const [refSnap, referrerPlayerSnap, referrerLbSnap] = await Promise.all([
          transaction.get(refDocRef),
          transaction.get(referrerPlayerRef),
          transaction.get(referrerLbRef),
        ]);

        transaction.update(doc(db, 'players', uid), toFirestoreProfilePayload(params.profile, false));
        transaction.set(doc(db, 'leaderboard', uid), toLeaderboardPayload(params.profile));

        if (params.transaction && txId) {
          transaction.set(doc(db, 'players', uid, 'transactions', txId), {
            userId: uid,
            type: params.transaction.type,
            title: params.transaction.title.slice(0, 80),
            amount: params.transaction.amount,
            currency: params.transaction.currency,
            usdValue: params.transaction.usdValue,
            status: params.transaction.status,
            createdAtMs: params.transaction.createdAtMs,
            createdAt: serverTimestamp(),
          });
        }

        if (refSnap.exists() && refSnap.data().status === 'pending' && referrerPlayerSnap.exists()) {
          const rp = referrerPlayerSnap.data();
          const nextCoins = Number(rp.coins ?? 0) + REFERRER_SIGNUP_BONUS_COINS;
          const nextRefCount = Number(rp.referralCount ?? 0) + 1;
          const nextRefCoinsEarned = Number(rp.referralCoinsEarned ?? 0) + REFERRER_SIGNUP_BONUS_COINS;

          transaction.update(refDocRef, {
            status: 'active',
            coinsEarned: REFERRER_SIGNUP_BONUS_COINS,
          });

          transaction.update(referrerPlayerRef, {
            coins: nextCoins,
            referralCount: nextRefCount,
            referralCoinsEarned: nextRefCoinsEarned,
            updatedAt: serverTimestamp(),
          });

          if (referrerLbSnap.exists()) {
            transaction.update(referrerLbRef, {
              inviterCount: nextRefCount,
              updatedAt: serverTimestamp(),
            });
          }

          transaction.set(doc(db, 'players', refUid, 'transactions', `tx_ref_earned_${uid}_${nowMs}`.slice(0, 64)), {
            userId: refUid,
            type: 'referral',
            title: `Referral bonus (+${REFERRER_SIGNUP_BONUS_COINS} coins): ${params.profile.displayName}`.slice(0, 80),
            amount: REFERRER_SIGNUP_BONUS_COINS,
            currency: 'coins',
            usdValue: Number((REFERRER_SIGNUP_BONUS_COINS / 10000).toFixed(4)),
            status: 'completed',
            createdAtMs: nowMs,
            createdAt: serverTimestamp(),
          });
        }
      });
      return true;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `players/${uid}`);
    }
  }

  if (
    params.referralEggCommission &&
    params.referralEggCommission > 0 &&
    params.profile.referredBy
  ) {
    const refUid = params.profile.referredBy;
    const eggCommission = Math.max(1, Math.floor(params.referralEggCommission));
    const txId = params.transaction?.id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const nowMs = params.transaction?.createdAtMs ?? Date.now();
    const referrerPlayerRef = doc(db, 'players', refUid);
    const referrerLbRef = doc(db, 'leaderboard', refUid);

    try {
      await runTransaction(db, async (transaction) => {
        const [referrerPlayerSnap, referrerLbSnap] = await Promise.all([
          transaction.get(referrerPlayerRef),
          transaction.get(referrerLbRef),
        ]);

        transaction.update(doc(db, 'players', uid), toFirestoreProfilePayload(params.profile, false));
        transaction.set(doc(db, 'leaderboard', uid), toLeaderboardPayload(params.profile));

        if (params.transaction && txId) {
          transaction.set(doc(db, 'players', uid, 'transactions', txId), {
            userId: uid,
            type: params.transaction.type,
            title: params.transaction.title.slice(0, 80),
            amount: params.transaction.amount,
            currency: params.transaction.currency,
            usdValue: params.transaction.usdValue,
            status: params.transaction.status,
            createdAtMs: params.transaction.createdAtMs,
            createdAt: serverTimestamp(),
          });
        }

        if (referrerPlayerSnap.exists()) {
          const rp = referrerPlayerSnap.data();
          const nextEggs = Number(rp.eggs ?? 0) + eggCommission;
          const nextTotalEggs = Number(rp.totalEggsCollected ?? 0) + eggCommission;

          transaction.update(referrerPlayerRef, {
            eggs: nextEggs,
            totalEggsCollected: nextTotalEggs,
            updatedAt: serverTimestamp(),
          });

          if (referrerLbSnap.exists()) {
            transaction.update(referrerLbRef, {
              eggs: nextEggs,
              totalEggsCollected: nextTotalEggs,
              updatedAt: serverTimestamp(),
            });
          }

          const refTxId = `tx_regg_${uid.replace(/[^a-zA-Z0-9_-]/g, '').slice(-12)}_${nowMs}`.slice(0, 64);
          const refFriendHandle = formatReferralHandle(params.profile.handle, uid).slice(0, 32);
          const refFriendName = (params.profile.displayName || 'Farmer').trim().slice(0, 30);
          transaction.set(doc(db, 'players', refUid, 'transactions', refTxId), {
            userId: refUid,
            type: 'referral',
            title: `5% eggs · ${refFriendHandle} (${refFriendName})`.slice(0, 80),
            amount: eggCommission,
            currency: 'eggs',
            usdValue: eggsToUsd(eggCommission),
            status: 'completed',
            createdAtMs: nowMs,
            createdAt: serverTimestamp(),
          });
        }
      });
      return true;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `players/${uid}`);
    }
  }

  if (params.deposit) {
    const dep = params.deposit;
    const depId = dep.id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const txId = (params.transaction?.id || `tx_dep_${dep.createdAtMs}`).replace(/[^a-zA-Z0-9_-]/g, '_');
    const depRef = doc(db, 'players', uid, 'deposits', depId);
    const cleanTxHash = (dep.txHash || '').trim().slice(0, 128);
    const txLedgerRef =
      cleanTxHash.length >= 4
        ? doc(db, 'processed_tx_hashes', buildTxHashLedgerId(cleanTxHash))
        : null;
    const playerRef = doc(db, 'players', uid);
    const lbRef = doc(db, 'leaderboard', uid);
    const hasCommission = Boolean(params.profile.referredBy && (params.referrerCommissionCoins ?? 0) > 0);
    const refUid = params.profile.referredBy;
    const refPlayerRef = hasCommission ? doc(db, 'players', refUid) : null;
    const refRelRef = hasCommission ? doc(db, 'players', refUid, 'referrals', uid) : null;

    try {
      let applied = false;
      await runTransaction(db, async (transaction) => {
        const [depSnap, txLedgerSnap, playerSnap, refPlayerSnap, refRelSnap] = await Promise.all([
          transaction.get(depRef),
          txLedgerRef ? transaction.get(txLedgerRef) : Promise.resolve(null),
          transaction.get(playerRef),
          refPlayerRef ? transaction.get(refPlayerRef) : Promise.resolve(null),
          refRelRef ? transaction.get(refRelRef) : Promise.resolve(null),
        ]);

        if (depSnap.exists() || txLedgerSnap?.exists()) {
          applied = false;
          return;
        }
        applied = true;

        const currentCoins = playerSnap.exists() ? Number(playerSnap.data().coins ?? 0) : params.profile.coins;
        const syncedProfile: UserFarmProfile = {
          ...params.profile,
          coins: currentCoins + dep.coinsAmount,
          firstDepositBonusUsed: true,
        };

        transaction.update(playerRef, toFirestoreProfilePayload(syncedProfile, false));
        transaction.set(lbRef, toLeaderboardPayload(syncedProfile));

        if (params.transaction) {
          transaction.set(doc(db, 'players', uid, 'transactions', txId), {
            userId: uid,
            type: params.transaction.type,
            title: params.transaction.title.slice(0, 80),
            amount: params.transaction.amount,
            currency: params.transaction.currency,
            usdValue: params.transaction.usdValue,
            status: params.transaction.status,
            createdAtMs: params.transaction.createdAtMs,
            createdAt: serverTimestamp(),
          });
        }

        transaction.set(depRef, {
          userId: uid,
          coinsAmount: dep.coinsAmount,
          bonusCoins: dep.bonusCoins,
          usdAmount: dep.usdAmount,
          network: dep.network,
          cryptoAmount: dep.cryptoAmount,
          depositAddress: dep.depositAddress,
          txHash: dep.txHash,
          status: dep.status,
          createdAtMs: dep.createdAtMs,
          createdAt: serverTimestamp(),
        });

        if (txLedgerRef && cleanTxHash.length >= 4) {
          transaction.set(txLedgerRef, {
            txHash: cleanTxHash,
            playerId: uid,
            coinsAmount: Math.min(15000, Math.max(1000, Math.round(dep.coinsAmount))),
            createdAtMs: dep.createdAtMs,
            createdAt: serverTimestamp(),
          });
        }

        if (hasCommission && refPlayerRef && refRelRef && refPlayerSnap?.exists()) {
          const commission = params.referrerCommissionCoins!;
          const refCoins = Number(refPlayerSnap.data().coins ?? 0);
          const refEarned = Number(refPlayerSnap.data().referralCoinsEarned ?? 0);
          const ids = buildDeterministicDepositIds(dep.txHash || depId);

          transaction.update(refPlayerRef, {
            coins: refCoins + commission,
            referralCoinsEarned: refEarned + commission,
            updatedAt: serverTimestamp(),
          });

          if (refRelSnap?.exists()) {
            transaction.update(refRelRef, {
              status: 'active',
              coinsEarned: Number(refRelSnap.data().coinsEarned ?? 0) + commission,
              toppedUpUsd: Number(refRelSnap.data().toppedUpUsd ?? 0) + dep.usdAmount,
            });
          }

          transaction.set(doc(db, 'players', refUid, 'transactions', ids.refCommissionTxId), {
            userId: refUid,
            type: 'referral',
            title: `5% commission from ${params.profile.displayName}`.slice(0, 80),
            amount: commission,
            currency: 'coins',
            usdValue: Number((commission / 10000).toFixed(3)),
            status: 'completed',
            createdAtMs: dep.createdAtMs,
            createdAt: serverTimestamp(),
          });
        }
      });
      return applied;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `players/${uid}`);
    }
  }

  const playerRef = doc(db, 'players', uid);
  const existingSnap = await getDoc(playerRef).catch(() => null);
  const playerDocExists = Boolean(existingSnap?.exists());

  const batch = writeBatch(db);

  if (playerDocExists) {
    batch.update(playerRef, toFirestoreProfilePayload(params.profile, false));
  } else {
    batch.set(playerRef, toFirestoreProfilePayload(params.profile, true));
  }
  batch.set(doc(db, 'leaderboard', uid), toLeaderboardPayload(params.profile));

  if (params.transaction) {
    const txId = params.transaction.id.replace(/[^a-zA-Z0-9_-]/g, '_');
    batch.set(doc(db, 'players', uid, 'transactions', txId), {
      userId: uid,
      type: params.transaction.type,
      title: params.transaction.title.slice(0, 80),
      amount: params.transaction.amount,
      currency: params.transaction.currency,
      usdValue: params.transaction.usdValue,
      status: params.transaction.status,
      createdAtMs: params.transaction.createdAtMs,
      createdAt: serverTimestamp(),
    });
  }

  if (params.withdrawal) {
    const wdId = params.withdrawal.id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const txId = (
      params.transaction?.id ||
      params.withdrawal.txId ||
      `tx_wd_${params.withdrawal.createdAtMs}`
    ).replace(/[^a-zA-Z0-9_-]/g, '_');
    batch.set(doc(db, 'players', uid, 'withdrawals', wdId), {
      userId: uid,
      txId,
      eggsAmount: params.withdrawal.eggsAmount,
      gramAmount: params.withdrawal.gramAmount,
      usdValue: params.withdrawal.usdValue,
      walletAddress: params.withdrawal.walletAddress,
      memo: params.withdrawal.memo,
      network: params.withdrawal.network,
      status: params.withdrawal.status,
      adminNote: '',
      reviewedAtMs: 0,
      createdAtMs: params.withdrawal.createdAtMs,
      createdAt: serverTimestamp(),
    });
    batch.set(doc(db, 'withdraw_requests', wdId), {
      withdrawalId: wdId,
      txId,
      userId: uid,
      displayName: params.profile.displayName.slice(0, 60) || 'Farmer',
      handle: params.profile.handle.slice(0, 40) || '@farmer',
      eggsAmount: params.withdrawal.eggsAmount,
      gramAmount: params.withdrawal.gramAmount,
      usdValue: params.withdrawal.usdValue,
      walletAddress: params.withdrawal.walletAddress,
      memo: params.withdrawal.memo,
      network: params.withdrawal.network,
      status: 'pending',
      adminNote: '',
      createdAtMs: params.withdrawal.createdAtMs,
      reviewedAtMs: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `players/${uid}`);
  }
}

export function subscribeToPlayer(
  playerId: string,
  callbacks: {
    onProfile: (profile: UserFarmProfile) => void;
    onTransactions: (items: TransactionEntry[]) => void;
    onReferralTransactions?: (items: TransactionEntry[]) => void;
    onDeposits: (items: DepositOrder[]) => void;
    onWithdrawals: (items: WithdrawalOrder[]) => void;
    onReferrals: (items: ReferralRecord[]) => void;
  },
): () => void {
  const unsubProfile = onSnapshot(
    doc(db, 'players', playerId),
    (snap) => {
      if (snap.exists()) {
        const parsed = parseProfileDoc(snap.data(), playerId);
        saveCachedPlayerProfile(parsed);
        callbacks.onProfile(parsed);
      }
    },
    (err) => logSubscriptionError(`players/${playerId}`, err),
  );

  const txQuery = query(
    collection(db, 'players', playerId, 'transactions'),
    orderBy('createdAtMs', 'desc'),
    limit(60),
  );
  const unsubTx = onSnapshot(
    txQuery,
    (snap) => {
      callbacks.onTransactions(
        snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: docSnap.id,
            userId: d.userId,
            type: d.type,
            title: d.title,
            amount: d.amount,
            currency: d.currency,
            usdValue: d.usdValue,
            status: d.status,
            createdAtMs: d.createdAtMs,
          };
        }),
      );
    },
    (err) => logSubscriptionError(`players/${playerId}/transactions`, err),
  );

  const refTxQuery = query(
    collection(db, 'players', playerId, 'transactions'),
    where('type', '==', 'referral'),
    limit(60),
  );
  const unsubRefTx = callbacks.onReferralTransactions
    ? onSnapshot(
        refTxQuery,
        (snap) => {
          callbacks.onReferralTransactions?.(
            snap.docs.map((docSnap) => {
              const d = docSnap.data();
              return {
                id: docSnap.id,
                userId: d.userId,
                type: d.type,
                title: d.title,
                amount: d.amount,
                currency: d.currency,
                usdValue: d.usdValue,
                status: d.status,
                createdAtMs: d.createdAtMs,
              };
            }),
          );
        },
        (err) => logSubscriptionError(`players/${playerId}/transactions(referral)`, err),
      )
    : () => {};

  const depQuery = query(
    collection(db, 'players', playerId, 'deposits'),
    orderBy('createdAtMs', 'desc'),
    limit(40),
  );
  const unsubDep = onSnapshot(
    depQuery,
    (snap) => {
      callbacks.onDeposits(
        snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: docSnap.id,
            userId: d.userId,
            coinsAmount: d.coinsAmount,
            bonusCoins: d.bonusCoins,
            usdAmount: d.usdAmount,
            network: d.network,
            cryptoAmount: d.cryptoAmount,
            depositAddress: d.depositAddress,
            txHash: d.txHash ?? '',
            status: d.status,
            createdAtMs: d.createdAtMs,
          };
        }),
      );
    },
    (err) => logSubscriptionError(`players/${playerId}/deposits`, err),
  );

  const wdQuery = query(
    collection(db, 'players', playerId, 'withdrawals'),
    orderBy('createdAtMs', 'desc'),
    limit(40),
  );
  const unsubWd = onSnapshot(
    wdQuery,
    (snap) => {
      callbacks.onWithdrawals(
        snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: docSnap.id,
            txId: d.txId ? String(d.txId) : undefined,
            userId: d.userId,
            eggsAmount: d.eggsAmount,
            gramAmount: d.gramAmount,
            usdValue: d.usdValue,
            walletAddress: d.walletAddress,
            memo: d.memo ?? '',
            network: d.network,
            status: d.status,
            adminNote: d.adminNote ? String(d.adminNote) : undefined,
            reviewedAtMs: d.reviewedAtMs ? Number(d.reviewedAtMs) : undefined,
            createdAtMs: d.createdAtMs,
          };
        }),
      );
    },
    (err) => logSubscriptionError(`players/${playerId}/withdrawals`, err),
  );

  const refQuery = query(
    collection(db, 'players', playerId, 'referrals'),
    orderBy('createdAtMs', 'desc'),
    limit(50),
  );
  const unsubRef = onSnapshot(
    refQuery,
    (snap) => {
      callbacks.onReferrals(
        snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: docSnap.id,
            referrerUid: d.referrerUid,
            referredUid: d.referredUid,
            referredName: d.referredName,
            referredHandle: d.referredHandle,
            status: d.status === 'pending' ? 'pending' : 'active',
            coinsEarned: d.coinsEarned ?? 0,
            toppedUpUsd: d.toppedUpUsd ?? 0,
            createdAtMs: d.createdAtMs ?? 0,
          };
        }),
      );
    },
    (err) => logSubscriptionError(`players/${playerId}/referrals`, err),
  );

  return () => {
    unsubProfile();
    unsubTx();
    unsubRefTx();
    unsubDep();
    unsubWd();
    unsubRef();
  };
}

export function subscribeToLeaderboard(
  onUpdate: (entries: LeaderboardEntry[]) => void,
): () => void {
  const lbQuery = query(
    collection(db, 'leaderboard'),
    orderBy('buyerPoints', 'desc'),
    limit(50),
  );
  return onSnapshot(
    lbQuery,
    (snap) => {
      onUpdate(
        snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            uid: String(d.uid),
            displayName: String(d.displayName || 'Farmer'),
            handle: String(d.handle || '@farmer'),
            photoUrl: String(d.photoUrl || ''),
            avatarColor: String(d.avatarColor || '#EF4444'),
            referralCode: String(d.referralCode || ''),
            buyerPoints: Number(d.buyerPoints ?? 0),
            inviterCount: Number(d.inviterCount ?? 0),
            eggs: Number(d.eggs ?? 0),
            totalEggsCollected: Number(d.totalEggsCollected ?? 0),
            chickensCount: Number(d.chickensCount ?? 0),
          };
        }),
      );
    },
    (err) => logSubscriptionError('leaderboard', err),
  );
}

export function subscribeToAllWithdrawRequests(
  onUpdate: (items: WithdrawRequestRecord[]) => void,
): () => void {
  const q = query(
    collection(db, 'withdraw_requests'),
    orderBy('createdAtMs', 'desc'),
    limit(100),
  );
  return onSnapshot(
    q,
    (snap) => {
      onUpdate(
        snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: docSnap.id,
            txId: String(d.txId || `tx_wd_${d.createdAtMs || 0}`),
            userId: String(d.userId || ''),
            displayName: String(d.displayName || 'Farmer'),
            handle: String(d.handle || '@farmer'),
            eggsAmount: Number(d.eggsAmount ?? 0),
            gramAmount: String(d.gramAmount || '0'),
            usdValue: Number(d.usdValue ?? 0),
            walletAddress: String(d.walletAddress || ''),
            memo: String(d.memo || ''),
            network: 'GRAM_TON',
            status: (d.status as WithdrawRequestRecord['status']) || 'pending',
            adminNote: String(d.adminNote || ''),
            createdAtMs: Number(d.createdAtMs ?? 0),
            reviewedAtMs: Number(d.reviewedAtMs ?? 0),
          };
        }),
      );
    },
    (err) => logSubscriptionError('withdraw_requests', err),
  );
}

export async function reviewWithdrawalInFirestore(params: {
  request: WithdrawRequestRecord;
  decision: 'approved' | 'rejected';
  adminNote?: string;
}): Promise<void> {
  const { request, decision } = params;
  const cleanNote = String(params.adminNote || '').trim().slice(0, 160);
  const nowMs = Date.now();
  const reqRef = doc(db, 'withdraw_requests', request.id);
  const playerWdRef = doc(db, 'players', request.userId, 'withdrawals', request.id);
  const playerTxRef = doc(db, 'players', request.userId, 'transactions', request.txId);
  const playerRef = doc(db, 'players', request.userId);
  const lbRef = doc(db, 'leaderboard', request.userId);

  try {
    await runTransaction(db, async (transaction) => {
      const reqSnap = await transaction.get(reqRef);
      if (!reqSnap.exists()) {
        throw new Error('Withdrawal request no longer exists.');
      }
      if (reqSnap.data().status !== 'pending') {
        throw new Error(`Withdrawal already ${reqSnap.data().status}.`);
      }

      const [wdSnap, txSnap, playerSnap, lbSnap] = await Promise.all([
        transaction.get(playerWdRef),
        transaction.get(playerTxRef),
        decision === 'rejected' ? transaction.get(playerRef) : Promise.resolve(null),
        decision === 'rejected' ? transaction.get(lbRef) : Promise.resolve(null),
      ]);

      transaction.update(reqRef, {
        status: decision,
        adminNote: cleanNote,
        reviewedAtMs: nowMs,
        updatedAt: serverTimestamp(),
      });

      if (wdSnap.exists()) {
        transaction.update(playerWdRef, {
          status: decision,
          adminNote: cleanNote,
          reviewedAtMs: nowMs,
        });
      }

      if (txSnap.exists()) {
        transaction.update(playerTxRef, {
          status: decision,
        });
      }

      if (decision === 'rejected' && playerSnap && playerSnap.exists()) {
        const currentEggs = Number(playerSnap.data().eggs ?? 0);
        const currentWithdrawnUsd = Number(playerSnap.data().totalWithdrawnUsd ?? 0);
        const nextEggs = currentEggs + request.eggsAmount;
        const nextWithdrawnUsd = Math.max(
          0,
          Number((currentWithdrawnUsd - request.usdValue).toFixed(4)),
        );

        transaction.update(playerRef, {
          eggs: nextEggs,
          totalWithdrawnUsd: nextWithdrawnUsd,
          updatedAt: serverTimestamp(),
        });

        if (lbSnap && lbSnap.exists()) {
          transaction.update(lbRef, {
            eggs: nextEggs,
            updatedAt: serverTimestamp(),
          });
        }
      }
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `withdraw_requests/${request.id}`);
  }
}

function parseCustomTaskDoc(id: string, d: Record<string, unknown>): TaskDefinition {
  const decoded = decodeTaskSubtitleMeta(d.subtitle ? String(d.subtitle) : undefined);
  const totalSlots =
    d.totalSlots !== undefined ? Number(d.totalSlots) : decoded.totalSlots;
  const claimedCount =
    d.claimedCount !== undefined
      ? Number(d.claimedCount)
      : (decoded.claimedCount ?? 0);
  const creatorUid = d.creatorUid ? String(d.creatorUid) : decoded.creatorUid;
  const paidCoins =
    d.paidCoins !== undefined ? Number(d.paidCoins) : decoded.paidCoins;

  return {
    id,
    category: (d.category as TaskDefinition['category']) || 'partner',
    title: String(d.title || 'Bonus task'),
    subtitle: decoded.subtitle,
    rewardCoins: Number(d.rewardCoins ?? 50),
    icon: String(d.icon || 'link'),
    actionUrl: String(d.actionUrl || ''),
    ...(totalSlots !== undefined ? { totalSlots } : {}),
    claimedCount,
    ...(creatorUid ? { creatorUid } : {}),
    ...(paidCoins !== undefined ? { paidCoins } : {}),
    isCustom: true,
    isActive: d.isActive !== false,
    createdAtMs: Number(d.createdAtMs ?? 0),
  };
}

export function subscribeToCustomTasks(
  onUpdate: (items: TaskDefinition[]) => void,
): () => void {
  const q = query(
    collection(db, 'tasks'),
    orderBy('createdAtMs', 'desc'),
    limit(100),
  );
  return onSnapshot(
    q,
    (snap) => {
      onUpdate(snap.docs.map((docSnap) => parseCustomTaskDoc(docSnap.id, docSnap.data())));
    },
    (err) => logSubscriptionError('tasks', err),
  );
}

export async function fetchCustomTasksFromFirestore(): Promise<TaskDefinition[]> {
  const q = query(
    collection(db, 'tasks'),
    orderBy('createdAtMs', 'desc'),
    limit(100),
  );
  try {
    const snap = await getDocsFromServer(q);
    return snap.docs.map((docSnap) => parseCustomTaskDoc(docSnap.id, docSnap.data()));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'tasks');
  }
}

export async function createCustomTaskInFirestore(input: {
  title: string;
  subtitle?: string;
  category: TaskDefinition['category'];
  rewardCoins: number;
  icon: string;
  actionUrl: string;
  totalSlots?: number;
}): Promise<TaskDefinition> {
  const nowMs = Date.now();
  const rand = Math.random().toString(36).slice(2, 6);
  const id = `task_${nowMs}_${rand}`;
  const cleanTitle = input.title.trim().slice(0, 80);
  const displaySubtitle = (input.subtitle || '').trim().slice(0, 120);
  const cleanReward = Math.max(1, Math.min(1_000_000, Math.round(input.rewardCoins)));
  const cleanIcon = input.icon.trim().slice(0, 24) || 'link';
  const cleanUrl = input.actionUrl.trim().slice(0, 256);
  const cleanTotalSlots = Math.max(0, Math.min(1_000_000, Math.round(input.totalSlots ?? 0)));
  const encodedSubtitle = encodeTaskSubtitleMeta({
    subtitle: displaySubtitle,
    totalSlots: cleanTotalSlots,
    claimedCount: 0,
  });

  try {
    await setDoc(doc(db, 'tasks', id), {
      id,
      category: input.category,
      title: cleanTitle,
      ...(encodedSubtitle ? { subtitle: encodedSubtitle } : {}),
      rewardCoins: cleanReward,
      icon: cleanIcon,
      actionUrl: cleanUrl,
      isActive: true,
      createdAtMs: nowMs,
      createdAt: serverTimestamp(),
    });
    return {
      id,
      category: input.category,
      title: cleanTitle,
      ...(displaySubtitle ? { subtitle: displaySubtitle } : {}),
      rewardCoins: cleanReward,
      icon: cleanIcon,
      actionUrl: cleanUrl,
      totalSlots: cleanTotalSlots,
      claimedCount: 0,
      isCustom: true,
      isActive: true,
      createdAtMs: nowMs,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `tasks/${id}`);
  }
}

export async function createPaidCustomTaskInFirestore(params: {
  profile: UserFarmProfile;
  transaction: TransactionEntry;
  paidCoins: number;
  taskInput: {
    title: string;
    subtitle?: string;
    category: TaskDefinition['category'];
    rewardCoins: number;
    icon: string;
    actionUrl: string;
    totalSlots: number;
  };
}): Promise<{ task: TaskDefinition; profile: UserFarmProfile } | { error: string }> {
  const uid = params.profile.uid;
  const nowMs = params.transaction.createdAtMs || Date.now();
  const rand = Math.random().toString(36).slice(2, 6);
  const taskId = `task_${nowMs}_${rand}`;
  const cleanTitle = params.taskInput.title.trim().slice(0, 80);
  const displaySubtitle = (params.taskInput.subtitle || '').trim().slice(0, 120);
  const cleanReward = Math.max(
    USER_TASK_MIN_REWARD_COINS,
    Math.min(USER_TASK_MAX_REWARD_COINS, Math.round(params.taskInput.rewardCoins)),
  );
  const cleanIcon = params.taskInput.icon.trim().slice(0, 24) || 'link';
  const cleanUrl = params.taskInput.actionUrl.trim().slice(0, 256);
  const cleanTotalSlots = Math.max(
    USER_TASK_MIN_SLOTS,
    Math.min(USER_TASK_MAX_SLOTS, Math.round(params.taskInput.totalSlots)),
  );
  const paidCoins = Math.max(USER_TASK_MIN_TOTAL_COST_COINS, Math.round(params.paidCoins));
  const encodedSubtitle = encodeTaskSubtitleMeta({
    subtitle: displaySubtitle,
    totalSlots: cleanTotalSlots,
    claimedCount: 0,
    creatorUid: uid,
    paidCoins,
  });
  const txId = params.transaction.id.replace(/[^a-zA-Z0-9_-]/g, '_');

  const playerRef = doc(db, 'players', uid);
  const lbRef = doc(db, 'leaderboard', uid);
  const taskRef = doc(db, 'tasks', taskId);
  const txRef = doc(db, 'players', uid, 'transactions', txId);

  try {
    const result = await runTransaction(db, async (tx) => {
      const playerSnap = await tx.get(playerRef);
      if (!playerSnap.exists()) {
        return { error: 'Player profile not synced yet.' } as const;
      }
      const liveCoins = Number(playerSnap.data().coins ?? 0);
      if (liveCoins < USER_TASK_MIN_TOTAL_COST_COINS || liveCoins < paidCoins) {
        return {
          error: `Need at least ${Math.max(USER_TASK_MIN_TOTAL_COST_COINS, paidCoins).toLocaleString()} coins to publish this task (you have ${liveCoins.toLocaleString()}).`,
        } as const;
      }

      const syncedProfile: UserFarmProfile = {
        ...params.profile,
        coins: liveCoins - paidCoins,
      };

      tx.update(playerRef, toFirestoreProfilePayload(syncedProfile, false));
      tx.set(lbRef, toLeaderboardPayload(syncedProfile));
      tx.set(txRef, {
        userId: uid,
        type: params.transaction.type,
        title: params.transaction.title.slice(0, 80),
        amount: params.transaction.amount,
        currency: params.transaction.currency,
        usdValue: params.transaction.usdValue,
        status: params.transaction.status,
        createdAtMs: params.transaction.createdAtMs,
        createdAt: serverTimestamp(),
      });
      tx.set(taskRef, {
        id: taskId,
        category: params.taskInput.category,
        title: cleanTitle,
        ...(encodedSubtitle ? { subtitle: encodedSubtitle } : {}),
        rewardCoins: cleanReward,
        icon: cleanIcon,
        actionUrl: cleanUrl,
        isActive: true,
        createdAtMs: nowMs,
        createdAt: serverTimestamp(),
      });

      const task: TaskDefinition = {
        id: taskId,
        category: params.taskInput.category,
        title: cleanTitle,
        ...(displaySubtitle ? { subtitle: displaySubtitle } : {}),
        rewardCoins: cleanReward,
        icon: cleanIcon,
        actionUrl: cleanUrl,
        totalSlots: cleanTotalSlots,
        claimedCount: 0,
        creatorUid: uid,
        paidCoins,
        isCustom: true,
        isActive: true,
        createdAtMs: nowMs,
      };

      return { task, profile: syncedProfile } as const;
    });

    return result;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `tasks/${taskId}`);
  }
}

export async function incrementTaskClaimCountInFirestore(taskId: string): Promise<void> {
  const ref = doc(db, 'tasks', taskId);
  try {
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists()) return;
      const d = snap.data();
      const parsed = parseCustomTaskDoc(snap.id, d);
      const total = Number(parsed.totalSlots ?? 0);
      if (!Number.isFinite(total) || total <= 0) {
        return;
      }
      const current = Math.max(0, Math.floor(Number(parsed.claimedCount ?? 0)));
      if (current >= total) return;

      const nextClaimed = current + 1;
      if (d.totalSlots !== undefined) {
        transaction.update(ref, { claimedCount: nextClaimed });
        return;
      }

      const nextSubtitle = encodeTaskSubtitleMeta({
        subtitle: parsed.subtitle,
        totalSlots: total,
        claimedCount: nextClaimed,
        creatorUid: parsed.creatorUid,
        paidCoins: parsed.paidCoins,
      });
      if (nextSubtitle) {
        transaction.update(ref, { subtitle: nextSubtitle });
      }
    });
  } catch (error) {
    if (isFirestorePermissionDenied(error)) {
      return;
    }
    handleFirestoreError(error, OperationType.UPDATE, `tasks/${taskId}`);
  }
}

export async function toggleCustomTaskInFirestore(taskId: string, isActive: boolean): Promise<void> {
  try {
    await updateDoc(doc(db, 'tasks', taskId), { isActive });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `tasks/${taskId}`);
  }
}

export async function deleteCustomTaskInFirestore(taskId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'tasks', taskId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `tasks/${taskId}`);
  }
}

export function subscribeToAdConfig(onUpdate: (config: AdConfig) => void): () => void {
  return onSnapshot(
    doc(db, 'app_config', 'ads'),
    (snap) => {
      if (!snap.exists()) {
        onUpdate(DEFAULT_AD_CONFIG);
        return;
      }
      const d = snap.data();
      onUpdate({
        provider: (d.provider as AdConfig['provider']) || 'countdown',
        adsgramBlockId: String(d.adsgramBlockId || ''),
        gigapubProjectId: String(d.gigapubProjectId || ''),
        monetagZoneId: String(d.monetagZoneId || ''),
        customTitle: String(d.customTitle || DEFAULT_AD_CONFIG.customTitle),
        customDescription: String(d.customDescription || DEFAULT_AD_CONFIG.customDescription),
        customUrl: String(d.customUrl || ''),
        watchSeconds: Math.max(3, Math.min(60, Number(d.watchSeconds ?? 5))),
        bannerEnabled: Boolean(d.bannerEnabled),
        bannerTitle: String(d.bannerTitle || DEFAULT_AD_CONFIG.bannerTitle),
        bannerSubtitle: String(d.bannerSubtitle || DEFAULT_AD_CONFIG.bannerSubtitle),
        bannerCtaText: String(d.bannerCtaText || DEFAULT_AD_CONFIG.bannerCtaText),
        bannerUrl: String(d.bannerUrl || DEFAULT_AD_CONFIG.bannerUrl),
        updatedAtMs: Number(d.updatedAtMs ?? 0),
      });
    },
    (err) => logSubscriptionError('app_config/ads', err),
  );
}

export async function saveAdConfigInFirestore(
  config: Omit<AdConfig, 'updatedAtMs'>,
): Promise<AdConfig> {
  const nowMs = Date.now();
  const payload: AdConfig = {
    provider: config.provider,
    adsgramBlockId: config.adsgramBlockId.trim().slice(0, 64),
    gigapubProjectId: (config.gigapubProjectId || '').trim().slice(0, 64),
    monetagZoneId: config.monetagZoneId.trim().slice(0, 64),
    customTitle: config.customTitle.trim().slice(0, 80) || DEFAULT_AD_CONFIG.customTitle,
    customDescription: config.customDescription.trim().slice(0, 200),
    customUrl: config.customUrl.trim().slice(0, 256),
    watchSeconds: Math.max(3, Math.min(60, Math.round(config.watchSeconds || 5))),
    bannerEnabled: Boolean(config.bannerEnabled),
    bannerTitle: config.bannerTitle.trim().slice(0, 80) || DEFAULT_AD_CONFIG.bannerTitle,
    bannerSubtitle: config.bannerSubtitle.trim().slice(0, 160),
    bannerCtaText: config.bannerCtaText.trim().slice(0, 24) || 'Open',
    bannerUrl: config.bannerUrl.trim().slice(0, 256),
    updatedAtMs: nowMs,
  };

  try {
    await setDoc(doc(db, 'app_config', 'ads'), {
      ...payload,
      updatedAt: serverTimestamp(),
    });
    return payload;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'app_config/ads');
  }
}

export function buildTxHashLedgerId(txHash: string): string {
  const clean = txHash.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  return `tx_${clean.slice(0, 56)}`;
}

export async function recordProcessedTxHashInFirestore(
  txHash: string,
  playerId: string,
  coinsAmount: number,
): Promise<void> {
  const cleanHash = txHash.trim().slice(0, 128);
  if (cleanHash.length < 4) return;
  const txKey = buildTxHashLedgerId(cleanHash);
  const clampedCoins = Math.min(15000, Math.max(1000, Math.round(coinsAmount)));
  try {
    await runTransaction(db, async (transaction) => {
      const ref = doc(db, 'processed_tx_hashes', txKey);
      const snap = await transaction.get(ref);
      if (snap.exists()) return;
      transaction.set(ref, {
        txHash: cleanHash,
        playerId,
        coinsAmount: clampedCoins,
        createdAtMs: Date.now(),
        createdAt: serverTimestamp(),
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `processed_tx_hashes/${txKey}`);
  }
}

export function subscribeToPromoCodes(
  onUpdate: (codes: DynamicPromoCode[]) => void,
): () => void {
  const q = query(
    collection(db, 'promo_codes'),
    orderBy('createdAtMs', 'desc'),
    limit(50),
  );
  return onSnapshot(
    q,
    (snap) => {
      onUpdate(
        snap.docs.map((docSnap) => {
          const d = docSnap.data();
          const decoded = decodePromoLabelMeta(
            String(d.label || 'Gift Drop'),
            Number(d.coins ?? 50),
          );
          return {
            code: String(d.code || docSnap.id),
            label: decoded.label,
            coins: decoded.coins,
            rewardType: decoded.rewardType,
            eggs: decoded.eggs,
            chickenBreed: decoded.chickenBreed,
            chickenQty: decoded.chickenQty,
            maxUses: Number(d.maxUses ?? 0),
            usedCount: Number(d.usedCount ?? 0),
            expiresAtMs: Number(d.expiresAtMs ?? 0),
            isActive: d.isActive !== false,
            createdAtMs: Number(d.createdAtMs ?? 0),
          };
        }),
      );
    },
    (err) => logSubscriptionError('promo_codes', err),
  );
}

export async function createPromoCodeInFirestore(input: {
  code: string;
  label: string;
  coins: number;
  rewardType?: PromoRewardType;
  eggs?: number;
  chickenBreed?: ChickenBreedId;
  chickenQty?: number;
  maxUses: number;
  expiresInHours: number;
}): Promise<DynamicPromoCode> {
  const cleanCode = input.code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 32);
  if (cleanCode.length < 3) {
    throw new Error('Gift code must be at least 3 letters/numbers.');
  }
  const nowMs = Date.now();
  const { encodedLabel, firestoreCoins } = encodePromoLabelMeta({
    label: input.label.trim() || `${cleanCode} Gift`,
    rewardType: input.rewardType,
    coins: input.coins,
    eggs: input.eggs,
    chickenBreed: input.chickenBreed,
    chickenQty: input.chickenQty,
  });
  const decoded = decodePromoLabelMeta(encodedLabel, firestoreCoins);
  const cleanMaxUses = Math.max(0, Math.min(1_000_000, Math.round(input.maxUses)));
  const cleanExpiresAtMs =
    input.expiresInHours > 0 ? nowMs + Math.round(input.expiresInHours * 3_600_000) : 0;

  try {
    await setDoc(doc(db, 'promo_codes', cleanCode), {
      code: cleanCode,
      label: encodedLabel,
      coins: firestoreCoins,
      maxUses: cleanMaxUses,
      usedCount: 0,
      expiresAtMs: cleanExpiresAtMs,
      isActive: true,
      createdAtMs: nowMs,
      createdAt: serverTimestamp(),
    });
    return {
      code: cleanCode,
      label: decoded.label,
      coins: decoded.coins,
      rewardType: decoded.rewardType,
      eggs: decoded.eggs,
      chickenBreed: decoded.chickenBreed,
      chickenQty: decoded.chickenQty,
      maxUses: cleanMaxUses,
      usedCount: 0,
      expiresAtMs: cleanExpiresAtMs,
      isActive: true,
      createdAtMs: nowMs,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `promo_codes/${cleanCode}`);
  }
}

export async function togglePromoCodeInFirestore(
  code: string,
  isActive: boolean,
): Promise<void> {
  const cleanCode = code.trim().toUpperCase();
  try {
    await updateDoc(doc(db, 'promo_codes', cleanCode), { isActive });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `promo_codes/${cleanCode}`);
  }
}

export async function deletePromoCodeInFirestore(code: string): Promise<void> {
  const cleanCode = code.trim().toUpperCase();
  try {
    await deleteDoc(doc(db, 'promo_codes', cleanCode));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `promo_codes/${cleanCode}`);
  }
}

export async function incrementPromoCodeUseInFirestore(code: string): Promise<void> {
  const cleanCode = code.trim().toUpperCase();
  const ref = doc(db, 'promo_codes', cleanCode);
  try {
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists()) return;
      const d = snap.data();
      const maxUses = Number(d.maxUses ?? 0);
      const currentUsed = Number(d.usedCount ?? 0);
      if (maxUses > 0 && currentUsed >= maxUses) return;
      transaction.update(ref, { usedCount: currentUsed + 1 });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `promo_codes/${cleanCode}`);
  }
}

export function subscribeToSeasonConfig(
  onUpdate: (config: SeasonConfig) => void,
): () => void {
  return onSnapshot(
    doc(db, 'app_config', 'season'),
    (snap) => {
      if (!snap.exists()) {
        onUpdate(createDefaultSeasonConfig());
        return;
      }
      const d = snap.data();
      const winners = Array.isArray(d.lastWinners)
        ? (d.lastWinners as SeasonWinnerRecord[]).slice(0, 15)
        : [];
      onUpdate({
        seasonNumber: Math.max(1, Number(d.seasonNumber ?? 1)),
        title: String(d.title || 'Harvest Cup Season 1'),
        prizePoolCoins: Math.max(0, Number(d.prizePoolCoins ?? 25000)),
        endsAtMs: Number(d.endsAtMs ?? Date.now() + 4 * 86_400_000),
        lastWinners: winners,
        updatedAtMs: Number(d.updatedAtMs ?? 0),
      });
    },
    (err) => logSubscriptionError('app_config/season', err),
  );
}

export function subscribeToChannelsConfig(
  onUpdate: (config: ChannelsConfig) => void,
): () => void {
  return onSnapshot(
    doc(db, 'app_config', 'channels'),
    (snap) => {
      if (!snap.exists()) {
        onUpdate(DEFAULT_CHANNELS_CONFIG);
        return;
      }
      const d = snap.data();
      const rawList = Array.isArray(d.channels) ? d.channels : [];
      const parsedChannels: RequiredTelegramChannel[] = rawList
        .map((item, idx) =>
          item && typeof item === 'object'
            ? normalizeTelegramChannelEntry(item as Partial<RequiredTelegramChannel>, idx)
            : null,
        )
        .filter((item): item is RequiredTelegramChannel => Boolean(item))
        .slice(0, 10);

      onUpdate({
        enabled: d.enabled !== false,
        channels: parsedChannels,
        updatedAtMs: Number(d.updatedAtMs ?? 0),
      });
    },
    (err) => logSubscriptionError('app_config/channels', err),
  );
}

export async function saveChannelsConfigInFirestore(
  config: Omit<ChannelsConfig, 'updatedAtMs'>,
): Promise<ChannelsConfig> {
  const nowMs = Date.now();
  const normalizedChannels: RequiredTelegramChannel[] = (config.channels ?? [])
    .map((ch, idx) => normalizeTelegramChannelEntry(ch, idx))
    .filter((ch): ch is RequiredTelegramChannel => Boolean(ch))
    .slice(0, 10);

  const payload: ChannelsConfig = {
    enabled: Boolean(config.enabled),
    channels: normalizedChannels,
    updatedAtMs: nowMs,
  };

  try {
    await setDoc(doc(db, 'app_config', 'channels'), {
      ...payload,
      updatedAt: serverTimestamp(),
    });
    return payload;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'app_config/channels');
  }
}

export async function saveSeasonConfigInFirestore(
  config: Omit<SeasonConfig, 'updatedAtMs'>,
): Promise<SeasonConfig> {
  const nowMs = Date.now();
  const payload: SeasonConfig = {
    seasonNumber: Math.max(1, Math.min(9999, Math.round(config.seasonNumber || 1))),
    title: config.title.trim().slice(0, 80) || `Harvest Cup Season ${config.seasonNumber || 1}`,
    prizePoolCoins: Math.max(0, Math.min(10_000_000, Math.round(config.prizePoolCoins || 0))),
    endsAtMs: Math.max(0, Math.round(config.endsAtMs || nowMs + 4 * 86_400_000)),
    lastWinners: (config.lastWinners ?? []).slice(0, 15),
    updatedAtMs: nowMs,
  };

  try {
    await setDoc(doc(db, 'app_config', 'season'), {
      ...payload,
      updatedAt: serverTimestamp(),
    });
    return payload;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'app_config/season');
  }
}

export async function distributeSeasonPrizesInFirestore(params: {
  entries: LeaderboardEntry[];
  season: SeasonConfig;
  nextDurationDays?: number;
}): Promise<SeasonConfig> {
  const { entries, season } = params;
  const nowMs = Date.now();
  const pool = Math.max(0, Math.round(season.prizePoolCoins));
  const sortedBuyers = [...entries]
    .sort((a, b) => b.buyerPoints - a.buyerPoints || b.eggs - a.eggs)
    .slice(0, 3);
  const shares = [0.5, 0.3, 0.2];
  const winners: SeasonWinnerRecord[] = [];

  for (let i = 0; i < sortedBuyers.length; i += 1) {
    const entry = sortedBuyers[i];
    const prizeCoins = Math.round(pool * (shares[i] ?? 0));
    if (prizeCoins <= 0) continue;
    winners.push({
      uid: entry.uid,
      displayName: entry.displayName.slice(0, 60),
      handle: entry.handle.slice(0, 40),
      category: 'buyers',
      rank: i + 1,
      prizeCoins,
    });
  }

  try {
    for (const w of winners) {
      const playerRef = doc(db, 'players', w.uid);
      const snap = await getDoc(playerRef);
      if (!snap.exists()) continue;
      const currentProfile = parseProfileDoc(snap.data(), w.uid);
      const nextProfile: UserFarmProfile = {
        ...currentProfile,
        coins: currentProfile.coins + w.prizeCoins,
      };
      const txId = `tx_season_${season.seasonNumber}_${w.rank}_${nowMs}`.slice(0, 64);
      const batch = writeBatch(db);
      batch.update(playerRef, toFirestoreProfilePayload(nextProfile, false));
      batch.set(doc(db, 'players', w.uid, 'transactions', txId), {
        userId: w.uid,
        type: 'season_prize',
        title: `Season #${season.seasonNumber} Rank #${w.rank} Prize`.slice(0, 80),
        amount: w.prizeCoins,
        currency: 'coins',
        usdValue: Number((w.prizeCoins / 10000).toFixed(3)),
        status: 'completed',
        createdAtMs: nowMs,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
    }

    const nextSeasonNum = season.seasonNumber + 1;
    const durationDays = Math.max(1, Math.min(90, params.nextDurationDays ?? 7));
    const nextSeason: SeasonConfig = {
      seasonNumber: nextSeasonNum,
      title: `Harvest Cup Season ${nextSeasonNum}`,
      prizePoolCoins: pool,
      endsAtMs: nowMs + durationDays * 86_400_000,
      lastWinners: winners,
      updatedAtMs: nowMs,
    };

    await setDoc(doc(db, 'app_config', 'season'), {
      ...nextSeason,
      updatedAt: serverTimestamp(),
    });
    return nextSeason;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'app_config/season');
  }
}

function parseBannedUserDoc(id: string, d: Record<string, unknown>): BannedUserRecord {
  return {
    uid: String(d.uid || id),
    displayName: String(d.displayName || ''),
    handle: String(d.handle || ''),
    reason: String(d.reason || ''),
    bannedBy: String(d.bannedBy || ''),
    bannedAtMs: Number(d.bannedAtMs ?? 0),
  };
}

export function loadCachedBanRecord(playerId: string): BannedUserRecord | null {
  try {
    if (typeof localStorage === 'undefined' || !playerId || isAdminPlayerId(playerId)) {
      return null;
    }
    const canonical = normalizePlayerBanId(playerId) || playerId;
    const raw =
      localStorage.getItem(`${BAN_CACHE_PREFIX}${canonical}`) ||
      localStorage.getItem(`${BAN_CACHE_PREFIX}${playerId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BannedUserRecord;
    return parsed?.uid ? parsed : null;
  } catch {
    return null;
  }
}

export function saveCachedBanRecord(
  playerId: string,
  ban: BannedUserRecord | null,
): void {
  try {
    if (typeof localStorage === 'undefined' || !playerId) return;
    const canonical = normalizePlayerBanId(playerId) || playerId;
    if (!ban) {
      localStorage.removeItem(`${BAN_CACHE_PREFIX}${canonical}`);
      localStorage.removeItem(`${BAN_CACHE_PREFIX}${playerId}`);
      return;
    }
    localStorage.setItem(`${BAN_CACHE_PREFIX}${canonical}`, JSON.stringify(ban));
  } catch {
    // Ignore storage errors
  }
}

export function subscribeToPlayerBanStatus(
  playerId: string,
  onUpdate: (ban: BannedUserRecord | null) => void,
): () => void {
  if (!playerId || isAdminPlayerId(playerId)) {
    saveCachedBanRecord(playerId, null);
    onUpdate(null);
    return () => {};
  }
  const canonicalId = normalizePlayerBanId(playerId) || playerId;
  return onSnapshot(
    doc(db, 'banned_users', canonicalId),
    (snap) => {
      if (!snap.exists()) {
        saveCachedBanRecord(canonicalId, null);
        onUpdate(null);
        return;
      }
      const parsed = parseBannedUserDoc(snap.id, snap.data());
      saveCachedBanRecord(canonicalId, parsed);
      onUpdate(parsed);
    },
    (err) => logSubscriptionError(`banned_users/${canonicalId}`, err),
  );
}

export function subscribeToRecentPlayers(
  onUpdate: (players: UserFarmProfile[]) => void,
  maxLimit = 50,
): () => void {
  const safeLimit = Math.max(1, Math.min(50, Math.floor(maxLimit)));
  const q = query(
    collection(db, 'players'),
    orderBy('createdAtMs', 'desc'),
    limit(safeLimit),
  );
  return onSnapshot(
    q,
    (snap) => {
      onUpdate(snap.docs.map((docSnap) => parseProfileDoc(docSnap.data(), docSnap.id)));
    },
    (err) => logSubscriptionError('players', err),
  );
}

export function subscribeToBannedUsers(
  onUpdate: (items: BannedUserRecord[]) => void,
): () => void {
  const q = query(
    collection(db, 'banned_users'),
    orderBy('bannedAtMs', 'desc'),
    limit(100),
  );
  return onSnapshot(
    q,
    (snap) => {
      onUpdate(
        snap.docs.map((docSnap) => parseBannedUserDoc(docSnap.id, docSnap.data())),
      );
    },
    (err) => logSubscriptionError('banned_users', err),
  );
}

export async function banPlayerInFirestore(params: {
  targetId: string;
  displayName?: string;
  handle?: string;
  reason?: string;
  bannedBy: string;
}): Promise<BannedUserRecord> {
  if (!isAdminPlayerId(params.bannedBy)) {
    throw new Error('Only authorized Owner Admin ID can block or ban players.');
  }
  const check = canBanPlayerId(params.targetId);
  if (!check.ok) {
    throw new Error(check.error);
  }
  const canonicalId = check.canonicalId;
  const nowMs = Date.now();
  const payload: BannedUserRecord = {
    uid: canonicalId,
    displayName: String(params.displayName || '').trim().slice(0, 60),
    handle: String(params.handle || '').trim().slice(0, 40),
    reason: (String(params.reason || '').trim() || 'Blocked by Administrator').slice(0, 160),
    bannedBy: params.bannedBy.trim().slice(0, 64),
    bannedAtMs: nowMs,
  };

  const ref = doc(db, 'banned_users', canonicalId);
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists()) {
        tx.update(ref, {
          displayName: payload.displayName,
          handle: payload.handle,
          reason: payload.reason,
          bannedBy: payload.bannedBy,
          bannedAtMs: payload.bannedAtMs,
        });
      } else {
        tx.set(ref, {
          ...payload,
          createdAt: serverTimestamp(),
        });
      }
    });
    return payload;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `banned_users/${canonicalId}`);
  }
}

export async function unbanPlayerInFirestore(targetId: string): Promise<void> {
  const canonicalId = normalizePlayerBanId(targetId) || String(targetId || '').trim();
  if (!canonicalId) {
    throw new Error('Invalid Player ID.');
  }
  try {
    await deleteDoc(doc(db, 'banned_users', canonicalId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `banned_users/${canonicalId}`);
  }
}

