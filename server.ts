import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase/app';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore';
import {
  DEFAULT_CHANNELS_CONFIG,
  DEFAULT_GRAM_DEPOSIT_ADDRESS,
  DEFAULT_GRAM_JETTON_MASTER,
  extractTelegramNumericUserId,
  getActiveRequiredChannels,
  isAdminPlayerId,
  isTelegramMemberStatusJoined,
  MAX_DEPOSIT_COINS,
  MIN_DEPOSIT_COINS,
  normalizeTelegramChannelEntry,
  PRIMARY_ADMIN_TELEGRAM_ID,
  PROMO_CODES,
} from './src/game/economy.ts';
import type { ChannelsConfig, RequiredTelegramChannel } from './src/types/farm.ts';
import {
  buildAcceptedDepositMemos,
  friendlyTonAddressToRaw,
  getPrimaryDepositMemo,
  matchGramTransfersFromTonApiEvents,
  matchGramTransfersFromTonCenter,
  normalizeTxHash,
  OFFICIAL_GRAM_RAW_MASTER,
  type RejectedGramTransfer,
  type TonApiEvent,
  type TonCenterJettonTransfer,
} from './src/game/tonGram.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function initServerFirestore(): Firestore | null {
  try {
    const candidates = [
      path.resolve(__dirname, 'firebase-applet-config.json'),
      path.resolve(__dirname, '..', 'firebase-applet-config.json'),
      path.resolve(process.cwd(), 'firebase-applet-config.json'),
    ];
    const configPath = candidates.find((p) => fs.existsSync(p));
    if (!configPath) return null;
    const raw = fs.readFileSync(configPath, 'utf8');
    const cfg = JSON.parse(raw) as Record<string, string>;
    const app = initializeApp(cfg, 'chickenland-server');
    return getFirestore(app, cfg.firestoreDatabaseId);
  } catch {
    return null;
  }
}

const serverDb = initServerFirestore();

function normalizeTelegramChannel(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '@AG_PAYOUTS';
  const match = trimmed.match(/^https?:\/\/t\.me\/([a-zA-Z0-9_]+)/i);
  if (match) return `@${match[1]}`;
  return trimmed.startsWith('@') || /^-?\d+$/.test(trimmed) ? trimmed : `@${trimmed}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const PORT = Number(process.env.PORT || 3000);
const GRAM_DEPOSIT_ADDRESS =
  process.env.GRAM_DEPOSIT_ADDRESS || DEFAULT_GRAM_DEPOSIT_ADDRESS;
const GRAM_JETTON_MASTER =
  process.env.GRAM_JETTON_MASTER || DEFAULT_GRAM_JETTON_MASTER;
const TELEGRAM_PAYOUT_CHANNEL = normalizeTelegramChannel(
  process.env.TELEGRAM_PAYOUT_CHANNEL || '@AG_PAYOUTS',
);
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TONCENTER_API_KEY = (process.env.TONCENTER_API_KEY || '').trim();
const ADMIN_TELEGRAM_IDS = (process.env.ADMIN_TELEGRAM_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const SESSION_SIGNING_SECRET = crypto
  .createHash('sha256')
  .update(`chickenland_session_v2:${PRIMARY_ADMIN_TELEGRAM_ID}:${TELEGRAM_BOT_TOKEN}`)
  .digest('hex');

function signSessionToken(payload: Record<string, unknown>, ttlMs = 12 * 3_600_000): string {
  const body = {
    ...payload,
    iat: Date.now(),
    exp: Date.now() + ttlMs,
  };
  const encoded = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_SIGNING_SECRET)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

function verifySessionToken(token: string): Record<string, unknown> | null {
  try {
    const [encoded, sig] = token.trim().split('.');
    if (!encoded || !sig) return null;
    const expected = crypto
      .createHmac('sha256', SESSION_SIGNING_SECRET)
      .update(encoded)
      .digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (typeof parsed.exp === 'number' && Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

function verifyTelegramInitData(
  rawInitData: string,
  botToken: string,
): { valid: boolean; playerId?: string; user?: Record<string, unknown>; reason?: string } {
  const trimmed = rawInitData.trim();
  if (!trimmed || !botToken) {
    return { valid: false, reason: 'missing_init_data_or_token' };
  }
  const params = new URLSearchParams(trimmed);
  const hash = params.get('hash') || '';
  if (!hash) {
    return { valid: false, reason: 'missing_hash' };
  }

  const authDateSec = Number(params.get('auth_date') || 0);
  if (authDateSec > 0 && Math.floor(Date.now() / 1000) - authDateSec > 86_400) {
    return { valid: false, reason: 'expired_auth_date' };
  }

  const entries: string[] = [];
  params.forEach((value, key) => {
    if (key !== 'hash') {
      entries.push(`${key}=${value}`);
    }
  });
  entries.sort();
  const dataCheckString = entries.join('\n');

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();
  const computedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  const a = Buffer.from(computedHash.toLowerCase(), 'utf8');
  const b = Buffer.from(hash.toLowerCase(), 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valid: false, reason: 'hash_mismatch' };
  }

  let parsedUser: Record<string, unknown> | undefined;
  const userJson = params.get('user');
  if (userJson) {
    try {
      parsedUser = JSON.parse(userJson) as Record<string, unknown>;
    } catch {
      parsedUser = undefined;
    }
  }
  const rawId = parsedUser?.id ? String(parsedUser.id).replace(/[^a-zA-Z0-9_-]/g, '') : '';
  return {
    valid: true,
    playerId: rawId ? `tg_${rawId}` : undefined,
    user: parsedUser,
  };
}

function buildTxLedgerId(txHash: string): string {
  const clean = txHash.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  return `tx_${clean.slice(0, 56)}`;
}

let cachedRawDepositAddress: string | null = null;
const processedServerTxHashes = new Set<string>();

async function loadFirestoreClaimedTxHashes(): Promise<string[]> {
  if (!serverDb) return [];
  try {
    const q = query(
      collection(serverDb, 'processed_tx_hashes'),
      orderBy('createdAtMs', 'desc'),
      limit(50),
    );
    const snap = await getDocs(q);
    const hashes: string[] = [];
    for (const d of snap.docs) {
      const h = String(d.data().txHash || '').trim();
      if (h) {
        hashes.push(h);
        processedServerTxHashes.add(h.toLowerCase());
        const norm = normalizeTxHash(h);
        if (norm) processedServerTxHashes.add(norm);
      }
    }
    return hashes;
  } catch {
    return [];
  }
}

async function persistServerTxHashToFirestore(
  txHash: string,
  playerId: string,
  coinsAmount: number,
): Promise<boolean> {
  if (!serverDb) return true;
  const cleanHash = txHash.trim().slice(0, 128);
  if (cleanHash.length < 4) return true;
  const txKey = buildTxLedgerId(cleanHash);
  const clampedCoins = Math.min(MAX_DEPOSIT_COINS, Math.max(MIN_DEPOSIT_COINS, Math.round(coinsAmount)));
  try {
    let inserted = false;
    await runTransaction(serverDb, async (transaction) => {
      const ref = doc(serverDb, 'processed_tx_hashes', txKey);
      const snap = await transaction.get(ref);
      if (snap.exists()) {
        inserted = false;
        return;
      }
      inserted = true;
      transaction.set(ref, {
        txHash: cleanHash,
        playerId,
        coinsAmount: clampedCoins,
        createdAtMs: Date.now(),
        createdAt: serverTimestamp(),
      });
    });
    return inserted;
  } catch {
    return true;
  }
}

async function resolveRawDepositAddress(): Promise<string> {
  if (cachedRawDepositAddress) return cachedRawDepositAddress;
  const decoded = friendlyTonAddressToRaw(GRAM_DEPOSIT_ADDRESS);
  if (decoded) {
    cachedRawDepositAddress = decoded;
    return decoded;
  }
  try {
    const res = await fetch(
      `https://tonapi.io/v2/accounts/${encodeURIComponent(GRAM_DEPOSIT_ADDRESS)}`,
      { signal: AbortSignal.timeout(6000) },
    );
    if (res.ok) {
      const data = (await res.json()) as { address?: string };
      if (data.address) {
        cachedRawDepositAddress = data.address;
        return data.address;
      }
    }
  } catch {
    // Fallback handled below
  }
  return '';
}

async function loadChannelsConfigFromFirestore(): Promise<ChannelsConfig> {
  if (!serverDb) return DEFAULT_CHANNELS_CONFIG;
  try {
    const snap = await getDoc(doc(serverDb, 'app_config', 'channels'));
    if (!snap.exists()) return DEFAULT_CHANNELS_CONFIG;
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

    return {
      enabled: d.enabled !== false,
      channels: parsedChannels,
      updatedAtMs: Number(d.updatedAtMs ?? 0),
    };
  } catch {
    return DEFAULT_CHANNELS_CONFIG;
  }
}

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/config', async (_req, res) => {
    const channelsCfg = await loadChannelsConfigFromFirestore();
    const activeChannels = getActiveRequiredChannels(channelsCfg);
    res.json({
      gramDepositAddress: GRAM_DEPOSIT_ADDRESS,
      gramJettonMaster: GRAM_JETTON_MASTER,
      minDepositCoins: MIN_DEPOSIT_COINS,
      maxDepositCoins: MAX_DEPOSIT_COINS,
      payoutChannel: TELEGRAM_PAYOUT_CHANNEL,
      channelCheckEnabled: channelsCfg.enabled,
      requiredChannels: activeChannels.map((c) => c.handle),
      telegramBotConfigured: Boolean(TELEGRAM_BOT_TOKEN),
      persistentLedgerEnabled: Boolean(serverDb),
    });
  });

  app.post('/api/telegram/check-channels', async (req, res) => {
    const body = req.body as {
      initData?: string;
      playerId?: string;
      requiredChannels?: Array<Partial<RequiredTelegramChannel>>;
    };
    const rawInitData = String(body.initData || '').trim();
    const rawPlayerId = String(body.playerId || '').trim();

    const channelsCfg = await loadChannelsConfigFromFirestore();
    let targetChannels = getActiveRequiredChannels(channelsCfg);
    if (!serverDb && Array.isArray(body.requiredChannels) && channelsCfg.enabled) {
      targetChannels = body.requiredChannels
        .map((ch, idx) => normalizeTelegramChannelEntry(ch, idx))
        .filter((ch): ch is RequiredTelegramChannel => Boolean(ch && ch.enabled !== false))
        .slice(0, 10);
    }

    let numericUserId: string | null = null;
    if (rawInitData && TELEGRAM_BOT_TOKEN) {
      const verifiedInit = verifyTelegramInitData(rawInitData, TELEGRAM_BOT_TOKEN);
      if (verifiedInit.valid && verifiedInit.playerId) {
        numericUserId = extractTelegramNumericUserId(verifiedInit.playerId);
      }
    }
    if (!numericUserId) {
      numericUserId = extractTelegramNumericUserId(rawPlayerId);
    }

    if (!channelsCfg.enabled || targetChannels.length === 0) {
      res.json({
        ok: true,
        allJoined: true,
        verificationMode: 'disabled',
        telegramUserId: numericUserId,
        channels: [],
        checkedAtMs: Date.now(),
      });
      return;
    }

    if (!numericUserId) {
      res.json({
        ok: true,
        allJoined: false,
        verificationMode: 'guest_browser',
        telegramUserId: null,
        channels: targetChannels.map((ch) => ({
          ...ch,
          joined: false,
          status: 'no_telegram_user',
          error: 'Open inside Telegram Mini App to verify membership',
        })),
        checkedAtMs: Date.now(),
      });
      return;
    }

    if (!TELEGRAM_BOT_TOKEN) {
      res.json({
        ok: true,
        allJoined: false,
        verificationMode: 'bot_unconfigured',
        telegramUserId: numericUserId,
        channels: targetChannels.map((ch) => ({
          ...ch,
          joined: false,
          status: 'bot_unconfigured',
          error: 'TELEGRAM_BOT_TOKEN not configured on server',
        })),
        checkedAtMs: Date.now(),
      });
      return;
    }

    const checks = await Promise.all(
      targetChannels.map(async (ch) => {
        try {
          const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getChatMember?chat_id=${encodeURIComponent(
            ch.handle,
          )}&user_id=${encodeURIComponent(numericUserId)}`;
          const tgRes = await fetch(url, { signal: AbortSignal.timeout(7000) });
          const tgData = (await tgRes.json()) as {
            ok?: boolean;
            description?: string;
            result?: {
              status?: string;
              is_member?: boolean;
            };
          };

          if (!tgData.ok || !tgData.result) {
            return {
              ...ch,
              joined: false,
              status: 'api_error',
              error: tgData.description || 'Make sure the bot is admin in this channel',
            };
          }

          const status = String(tgData.result.status || 'left');
          const joined = isTelegramMemberStatusJoined(status, tgData.result.is_member);
          return {
            ...ch,
            joined,
            status,
          };
        } catch (err) {
          return {
            ...ch,
            joined: false,
            status: 'network_error',
            error: err instanceof Error ? err.message : 'Telegram API timeout',
          };
        }
      }),
    );

    const allJoined = checks.every((c) => c.joined);
    res.json({
      ok: true,
      allJoined,
      verificationMode: 'telegram_bot',
      telegramUserId: numericUserId,
      channels: checks,
      checkedAtMs: Date.now(),
    });
  });

  app.post('/api/auth/verify-telegram', (req, res) => {
    const body = req.body as { initData?: string };
    const rawInitData = String(body.initData || '').trim();
    if (!rawInitData || !TELEGRAM_BOT_TOKEN) {
      res.json({ ok: true, verified: false, mode: 'guest' });
      return;
    }

    const check = verifyTelegramInitData(rawInitData, TELEGRAM_BOT_TOKEN);
    if (!check.valid || !check.playerId) {
      res.status(401).json({
        ok: false,
        verified: false,
        error: 'Invalid Telegram initData signature.',
      });
      return;
    }

    const sessionToken = signSessionToken({
      role: 'player',
      playerId: check.playerId,
    });
    res.json({
      ok: true,
      verified: true,
      mode: 'telegram',
      playerId: check.playerId,
      user: check.user,
      sessionToken,
    });
  });

  app.post('/api/admin/auth', (req, res) => {
    const body = req.body as {
      playerId?: string;
      initData?: string;
      token?: string;
    };
    const rawPlayerId = String(body.playerId || '').trim();
    const rawInitData = String(body.initData || '').trim();
    const authHeader = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    const candidateToken = String(body.token || authHeader || '').trim();

    if (candidateToken) {
      const verified = verifySessionToken(candidateToken);
      if (verified?.role === 'admin' && isAdminPlayerId(verified.playerId, ADMIN_TELEGRAM_IDS)) {
        res.json({ ok: true, method: 'token', token: candidateToken });
        return;
      }
    }

    let resolvedPlayerId = rawPlayerId;
    if (rawInitData && TELEGRAM_BOT_TOKEN) {
      const verifiedInit = verifyTelegramInitData(rawInitData, TELEGRAM_BOT_TOKEN);
      if (verifiedInit.valid && verifiedInit.playerId) {
        resolvedPlayerId = verifiedInit.playerId;
      }
    }

    if (isAdminPlayerId(resolvedPlayerId, ADMIN_TELEGRAM_IDS)) {
      const token = signSessionToken({
        role: 'admin',
        playerId: resolvedPlayerId,
        method: 'telegram_id',
      });
      res.json({ ok: true, method: 'telegram_id', token });
      return;
    }

    res.status(403).json({
      ok: false,
      error: `Restricted to Telegram Admin ID ${PRIMARY_ADMIN_TELEGRAM_ID}.`,
    });
  });

  app.post('/api/economy/validate-promo', async (req, res) => {
    const body = req.body as { code?: string };
    const code = String(body.code || '').trim().toUpperCase();
    if (!code || code.length < 2) {
      res.status(400).json({ valid: false, error: 'Promo code is required.' });
      return;
    }

    if (serverDb) {
      try {
        const snap = await getDoc(doc(serverDb, 'promo_codes', code));
        if (snap.exists()) {
          const d = snap.data();
          const maxUses = Number(d.maxUses ?? 0);
          const usedCount = Number(d.usedCount ?? 0);
          const expiresAtMs = Number(d.expiresAtMs ?? 0);
          if (d.isActive === false) {
            res.json({ valid: false, error: `Promo code ${code} is paused.` });
            return;
          }
          if (expiresAtMs > 0 && Date.now() > expiresAtMs) {
            res.json({ valid: false, error: `Promo code ${code} has expired.` });
            return;
          }
          if (maxUses > 0 && usedCount >= maxUses) {
            res.json({ valid: false, error: `Promo code ${code} reached max redemptions.` });
            return;
          }
          res.json({
            valid: true,
            source: 'dynamic',
            code,
            coins: Number(d.coins ?? 0),
            label: String(d.label || 'Promo Bonus'),
          });
          return;
        }
      } catch {
        // Fall through to static promo catalog
      }
    }

    const staticMatch = PROMO_CODES[code];
    if (staticMatch) {
      res.json({
        valid: true,
        source: 'builtin',
        code,
        coins: staticMatch.coins,
        label: staticMatch.label,
      });
      return;
    }

    res.json({ valid: false, error: 'Invalid promo code.' });
  });

  app.post('/api/deposits/check-gram', async (req, res) => {
    const body = req.body as {
      playerId?: string;
      claimedTxHashes?: string[];
    };

    const playerId = String(body.playerId || '').trim();
    const memo = playerId ? getPrimaryDepositMemo(playerId) : '';
    const acceptedMemos = playerId ? buildAcceptedDepositMemos(playerId) : [];
    const clientClaimed = Array.isArray(body.claimedTxHashes)
      ? body.claimedTxHashes.map((s) => String(s))
      : [];
    const dbClaimed = await loadFirestoreClaimedTxHashes();
    const allClaimed = [...clientClaimed, ...dbClaimed, ...Array.from(processedServerTxHashes)];

    if (!playerId || acceptedMemos.length === 0) {
      res.status(400).json({ error: 'Valid User ID memo is required for automatic deposit detection.' });
      return;
    }

    try {
      const rawDepositAddress = await resolveRawDepositAddress();
      const rawJettonMaster =
        friendlyTonAddressToRaw(GRAM_JETTON_MASTER) || OFFICIAL_GRAM_RAW_MASTER;
      const events: TonApiEvent[] = [];
      const rejected: RejectedGramTransfer[] = [];

      try {
        const listRes = await fetch(
          `https://tonapi.io/v2/accounts/${encodeURIComponent(GRAM_DEPOSIT_ADDRESS)}/events?limit=25`,
          { signal: AbortSignal.timeout(7000) },
        );
        if (listRes.ok) {
          const payload = (await listRes.json()) as { events?: TonApiEvent[] };
          events.push(...(payload.events || []));
        }
      } catch {
        // Continue to TON Center fallback
      }

      let matched = matchGramTransfersFromTonApiEvents({
        events,
        rawDepositAddress,
        memo,
        acceptedMemos,
        claimedTxHashes: allClaimed,
        gramJettonRawOrFriendly: GRAM_JETTON_MASTER,
        onRejected: (info) => rejected.push(info),
      });

      if (matched.length === 0 && TONCENTER_API_KEY) {
        try {
          const tcUrl = `https://toncenter.com/api/v3/jetton/transfers?owner_address=${encodeURIComponent(
            GRAM_DEPOSIT_ADDRESS,
          )}&jetton_master=${encodeURIComponent(GRAM_JETTON_MASTER)}&direction=in&limit=25`;
          const tcRes = await fetch(tcUrl, {
            headers: { 'X-API-Key': TONCENTER_API_KEY },
            signal: AbortSignal.timeout(7000),
          });
          if (tcRes.ok) {
            const tcPayload = (await tcRes.json()) as {
              jetton_transfers?: TonCenterJettonTransfer[];
            };
            matched = matchGramTransfersFromTonCenter({
              transfers: tcPayload.jetton_transfers || [],
              rawDepositAddress,
              memo,
              acceptedMemos,
              claimedTxHashes: allClaimed,
              gramJettonMasterRaw: rawJettonMaster,
              onRejected: (info) => rejected.push(info),
            });
          }
        } catch {
          // Ignore TON Center transient errors
        }
      }

      const freshlyMatched = [];
      for (const m of matched) {
        processedServerTxHashes.add(m.txHash.toLowerCase());
        const norm = normalizeTxHash(m.txHash);
        if (norm) processedServerTxHashes.add(norm);
        const isNewOnLedger = await persistServerTxHashToFirestore(
          m.txHash,
          playerId,
          m.coinsToCredit,
        );
        if (isNewOnLedger) {
          freshlyMatched.push(m);
        }
      }

      let scannerWarning: string | undefined;
      if (freshlyMatched.length === 0 && rejected.length > 0) {
        if (rejected.some((r) => r.reason === 'pending')) {
          scannerWarning =
            'Payment detected on TON and awaiting blockchain finality — coins will credit once confirmed.';
        } else if (rejected.some((r) => r.reason === 'below_min')) {
          scannerWarning = `Transfer detected, but it is below the ${MIN_DEPOSIT_COINS.toLocaleString()} coins minimum deposit.`;
        } else if (rejected.some((r) => r.reason === 'above_max')) {
          scannerWarning = `Transfer detected, but it exceeds the ${MAX_DEPOSIT_COINS.toLocaleString()} coins maximum deposit.`;
        } else if (rejected.some((r) => r.reason === 'spam' || r.reason === 'fake_token')) {
          scannerWarning =
            'Ignored unverified or spam token transfer — only official GRAM Jetton transfers are accepted.';
        }
      }

      res.json({
        checkedAt: Date.now(),
        depositAddress: GRAM_DEPOSIT_ADDRESS,
        found: freshlyMatched.length > 0,
        transfers: freshlyMatched,
        ...(scannerWarning ? { scannerWarning } : {}),
      });
    } catch {
      res.json({
        checkedAt: Date.now(),
        depositAddress: GRAM_DEPOSIT_ADDRESS,
        found: false,
        transfers: [],
        scannerWarning: 'TON network check timed out; retrying automatically.',
      });
    }
  });

  app.post('/api/withdraw/notify', async (req, res) => {
    const body = req.body as {
      displayName?: string;
      handle?: string;
      playerId?: string;
      eggsAmount?: number;
      gramAmount?: string;
      usdValue?: number;
      walletAddress?: string;
      memo?: string;
      status?: 'pending' | 'approved' | 'rejected';
      adminNote?: string;
    };

    const displayName = escapeHtml(String(body.displayName || 'Farmer').slice(0, 60));
    const handle = escapeHtml(String(body.handle || '@farmer').slice(0, 40));
    const eggsAmount = Number(body.eggsAmount || 0);
    const gramAmount = escapeHtml(String(body.gramAmount || '0'));
    const usdValue = Number(body.usdValue || 0).toFixed(4);
    const walletAddress = escapeHtml(String(body.walletAddress || '').slice(0, 128));
    const memo = escapeHtml(String(body.memo || '').slice(0, 64));
    const adminNote = escapeHtml(String(body.adminNote || '').slice(0, 120));
    const status = body.status === 'approved' || body.status === 'rejected' ? body.status : 'pending';

    if (!TELEGRAM_BOT_TOKEN) {
      res.json({
        ok: true,
        sent: false,
        channel: TELEGRAM_PAYOUT_CHANNEL,
        reason: 'TELEGRAM_BOT_TOKEN not configured on server',
      });
      return;
    }

    const statusLine =
      status === 'approved'
        ? '✅ <b>Status:</b> Approved &amp; Paid'
        : status === 'rejected'
          ? '❌ <b>Status:</b> Rejected (Eggs Refunded)'
          : '⏳ <b>Status:</b> Pending Admin Approval';

    const lines = [
      status === 'approved'
        ? '💸 <b>Alpha Gram Payout Approved</b>'
        : status === 'rejected'
          ? '⚠️ <b>Alpha Gram Payout Rejected</b>'
          : '🐔 <b>Alpha Gram Payout Request</b>',
      '',
      `👤 <b>User:</b> ${displayName} (${handle})`,
      `🥚 <b>Eggs:</b> ${eggsAmount.toLocaleString()}`,
      `💎 <b>Amount:</b> ${gramAmount} GRAM ($${usdValue})`,
      `🏦 <b>TON Wallet:</b> <code>${walletAddress}</code>`,
      ...(memo ? [`📝 <b>Memo:</b> <code>${memo}</code>`] : []),
      ...(adminNote ? [`💬 <b>Admin Note:</b> ${adminNote}`] : []),
      statusLine,
    ];

    try {
      const tgRes = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: TELEGRAM_PAYOUT_CHANNEL,
            text: lines.join('\n'),
            parse_mode: 'HTML',
          }),
          signal: AbortSignal.timeout(7000),
        },
      );
      const tgData = (await tgRes.json()) as { ok?: boolean; description?: string };
      res.json({
        ok: true,
        sent: Boolean(tgData.ok),
        channel: TELEGRAM_PAYOUT_CHANNEL,
        reason: tgData.ok ? undefined : tgData.description || 'Telegram API error',
      });
    } catch (err) {
      res.json({
        ok: true,
        sent: false,
        channel: TELEGRAM_PAYOUT_CHANNEL,
        reason: err instanceof Error ? err.message : 'Telegram request failed',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const httpServer = http.createServer(app);
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: { server: httpServer },
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log(`Alpha Gram server running on http://0.0.0.0:${PORT}`);
    });
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Alpha Gram server running on http://0.0.0.0:${PORT}`);
    });
  }
}

startServer();
