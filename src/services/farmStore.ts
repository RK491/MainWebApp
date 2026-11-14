import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
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
  createDefaultProfile,
  createDefaultSeasonConfig,
  DEFAULT_AD_CONFIG,
  eggsToUsd,
  formatReferralHandle,
  REFERRED_WELCOME_BONUS_COINS,
  REFERRER_SIGNUP_BONUS_COINS,
} from '../game/economy';
import type {
  AdConfig,
  DepositOrder,
  DynamicPromoCode,
  LeaderboardEntry,
  ReferralRecord,
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
    const existing = localStorage.getItem(PLAYER_ID_KEY) || readCookiePlayerId();
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
    if (typeof document !== 'undefined') {
      document.cookie = `${PLAYER_ID_COOKIE}=${encodeURIComponent(playerId)}; max-age=31536000; path=/; SameSite=Lax`;
    }
  } catch {
    // Ignore cookie errors
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

function toFirestoreProfilePayload(profile: UserFarmProfile, isCreate: boolean) {
  const base = {
    uid: profile.uid,
    displayName: profile.displayName.slice(0, 60),
    handle: profile.handle.slice(0, 40),
    photoUrl: (profile.photoUrl || '').slice(0, 512),
    avatarColor: profile.avatarColor.slice(0, 20),
    level: profile.level,
    xp: profile.xp,
    coins: profile.coins,
    eggs: profile.eggs,
    totalEggsCollected: profile.totalEggsCollected,
    totalCashEarnedUsd: profile.totalCashEarnedUsd,
    totalWithdrawnUsd: profile.totalWithdrawnUsd,
    basketCapacity: profile.basketCapacity,
    basketTierHours: profile.basketTierHours,
    leghornCount: profile.leghornCount,
    rhodeCount: profile.rhodeCount,
    orpingtonCount: profile.orpingtonCount,
    australorpCount: profile.australorpCount,
    boughtThisWeek: profile.boughtThisWeek,
    dailyStreak: profile.dailyStreak,
    lastDailyClaimDate: profile.lastDailyClaimDate,
    completedTaskIds: profile.completedTaskIds.slice(0, 50),
    claimedPromoCodes: profile.claimedPromoCodes.slice(0, 50),
    watchedAdsCount: profile.watchedAdsCount,
    referralCode: profile.referralCode.slice(0, 32),
    referredBy: profile.referredBy.slice(0, 64),
    referralActivated: Boolean(profile.referralActivated),
    referralCount: profile.referralCount,
    referralCoinsEarned: profile.referralCoinsEarned,
    firstDepositBonusUsed: profile.firstDepositBonusUsed,
    language: profile.language,
    lastCollectedAt: profile.lastCollectedAt,
    createdAtMs: profile.createdAtMs,
    feedBoostUntilMs: Math.max(0, Number(profile.feedBoostUntilMs ?? 0)),
    lastGoldenEggAtMs: Math.max(0, Number(profile.lastGoldenEggAtMs ?? 0)),
    goldenEggsFound: Math.max(0, Math.floor(Number(profile.goldenEggsFound ?? 0))),
    claimedAchievementIds: (profile.claimedAchievementIds ?? []).slice(0, 50),
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
    displayName: profile.displayName.slice(0, 60),
    handle: profile.handle.slice(0, 40),
    photoUrl: (profile.photoUrl || '').slice(0, 512),
    avatarColor: profile.avatarColor.slice(0, 20),
    referralCode: profile.referralCode.slice(0, 32),
    buyerPoints: calculateBuyerPoints(profile),
    inviterCount: profile.referralCount,
    eggs: profile.eggs,
    totalEggsCollected: profile.totalEggsCollected,
    chickensCount: calculateTotalChickens(profile),
    updatedAt: serverTimestamp(),
  };
}

function parseProfileDoc(d: Record<string, unknown>, fallbackId: string): UserFarmProfile {
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
    claimedAchievementIds: Array.isArray(d.claimedAchievementIds)
      ? (d.claimedAchievementIds as string[])
      : [],
    claimedReferralMilestones: Array.isArray(d.claimedReferralMilestones)
      ? (d.claimedReferralMilestones as number[])
      : [],
  };
}

export async function ensurePlayerInFirestore(
  playerId: string,
  detected?: { displayName?: string; handle?: string; photoUrl?: string; isTelegramDetected?: boolean },
): Promise<{ profile: UserFarmProfile; isNewPlayer: boolean }> {
  const playerRef = doc(db, 'players', playerId);
  try {
    const snap = await getDoc(playerRef);
    if (snap.exists()) {
      const existing = parseProfileDoc(snap.data(), playerId);
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
    return { profile: seed.profile, isNewPlayer: true };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `players/${playerId}`);
  }
}

export async function applyReferralCodeInFirestore(
  currentProfile: UserFarmProfile,
  rawCode: string,
): Promise<{ profile: UserFarmProfile; transaction: TransactionEntry; referrerName: string } | { error: string }> {
  const code = rawCode.trim().toUpperCase();
  if (!code || code.length < 3) {
    return { error: 'Enter a valid referral code (e.g. CL-XXXXXX).' };
  }
  if (currentProfile.referredBy) {
    return { error: 'You have already used a referral code on this account.' };
  }
  if (code === currentProfile.referralCode.toUpperCase()) {
    return { error: 'You cannot refer yourself.' };
  }

  try {
    const q = query(
      collection(db, 'leaderboard'),
      where('referralCode', '==', code),
      limit(1),
    );
    const matches = await getDocs(q);
    if (matches.empty) {
      return { error: `Referral code "${code}" not found.` };
    }

    const referrerSnap = matches.docs[0];
    const referrerData = referrerSnap.data();
    const referrerUid = String(referrerData.uid);
    const referrerName = String(referrerData.displayName || 'Farmer');

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
    handleFirestoreError(error, OperationType.WRITE, `referrals/${code}`);
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

  const batch = writeBatch(db);

  batch.update(doc(db, 'players', uid), toFirestoreProfilePayload(params.profile, false));
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
        callbacks.onProfile(parseProfileDoc(snap.data(), playerId));
      }
    },
    (err) => handleFirestoreError(err, OperationType.GET, `players/${playerId}`),
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
    (err) => handleFirestoreError(err, OperationType.LIST, `players/${playerId}/transactions`),
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
        (err) => handleFirestoreError(err, OperationType.LIST, `players/${playerId}/transactions`),
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
    (err) => handleFirestoreError(err, OperationType.LIST, `players/${playerId}/deposits`),
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
    (err) => handleFirestoreError(err, OperationType.LIST, `players/${playerId}/withdrawals`),
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
    (err) => handleFirestoreError(err, OperationType.LIST, `players/${playerId}/referrals`),
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
    (err) => handleFirestoreError(err, OperationType.LIST, 'leaderboard'),
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
    (err) => handleFirestoreError(err, OperationType.LIST, 'withdraw_requests'),
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
      onUpdate(
        snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: docSnap.id,
            category: (d.category as TaskDefinition['category']) || 'partner',
            title: String(d.title || 'Bonus task'),
            rewardCoins: Number(d.rewardCoins ?? 50),
            icon: String(d.icon || 'link'),
            actionUrl: String(d.actionUrl || ''),
            isCustom: true,
            isActive: d.isActive !== false,
            createdAtMs: Number(d.createdAtMs ?? 0),
          };
        }),
      );
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'tasks'),
  );
}

export async function createCustomTaskInFirestore(input: {
  title: string;
  category: TaskDefinition['category'];
  rewardCoins: number;
  icon: string;
  actionUrl: string;
}): Promise<TaskDefinition> {
  const nowMs = Date.now();
  const rand = Math.random().toString(36).slice(2, 6);
  const id = `task_${nowMs}_${rand}`;
  const cleanTitle = input.title.trim().slice(0, 80);
  const cleanReward = Math.max(1, Math.min(1_000_000, Math.round(input.rewardCoins)));
  const cleanIcon = input.icon.trim().slice(0, 24) || 'link';
  const cleanUrl = input.actionUrl.trim().slice(0, 256);

  try {
    await setDoc(doc(db, 'tasks', id), {
      id,
      category: input.category,
      title: cleanTitle,
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
      rewardCoins: cleanReward,
      icon: cleanIcon,
      actionUrl: cleanUrl,
      isCustom: true,
      isActive: true,
      createdAtMs: nowMs,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `tasks/${id}`);
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
    (err) => handleFirestoreError(err, OperationType.GET, 'app_config/ads'),
  );
}

export async function saveAdConfigInFirestore(
  config: Omit<AdConfig, 'updatedAtMs'>,
): Promise<AdConfig> {
  const nowMs = Date.now();
  const payload: AdConfig = {
    provider: config.provider,
    adsgramBlockId: config.adsgramBlockId.trim().slice(0, 64),
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
          return {
            code: String(d.code || docSnap.id),
            label: String(d.label || 'Promo Bonus'),
            coins: Number(d.coins ?? 50),
            maxUses: Number(d.maxUses ?? 0),
            usedCount: Number(d.usedCount ?? 0),
            expiresAtMs: Number(d.expiresAtMs ?? 0),
            isActive: d.isActive !== false,
            createdAtMs: Number(d.createdAtMs ?? 0),
          };
        }),
      );
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'promo_codes'),
  );
}

export async function createPromoCodeInFirestore(input: {
  code: string;
  label: string;
  coins: number;
  maxUses: number;
  expiresInHours: number;
}): Promise<DynamicPromoCode> {
  const cleanCode = input.code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 32);
  if (cleanCode.length < 3) {
    throw new Error('Promo code must be at least 3 letters/numbers.');
  }
  const nowMs = Date.now();
  const cleanLabel = input.label.trim().slice(0, 60) || `${cleanCode} Bonus`;
  const cleanCoins = Math.max(1, Math.min(1_000_000, Math.round(input.coins)));
  const cleanMaxUses = Math.max(0, Math.min(1_000_000, Math.round(input.maxUses)));
  const cleanExpiresAtMs =
    input.expiresInHours > 0 ? nowMs + Math.round(input.expiresInHours * 3_600_000) : 0;

  try {
    await setDoc(doc(db, 'promo_codes', cleanCode), {
      code: cleanCode,
      label: cleanLabel,
      coins: cleanCoins,
      maxUses: cleanMaxUses,
      usedCount: 0,
      expiresAtMs: cleanExpiresAtMs,
      isActive: true,
      createdAtMs: nowMs,
      createdAt: serverTimestamp(),
    });
    return {
      code: cleanCode,
      label: cleanLabel,
      coins: cleanCoins,
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
    (err) => handleFirestoreError(err, OperationType.GET, 'app_config/season'),
  );
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


