import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { isIP } from 'node:net';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase/app';
import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  startAfter,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Query,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
} from 'firebase/firestore';
import {
  ADMIN_PASSCODE_VAULT_UID,
  buildReferralBotNotificationMessage,
  DEFAULT_CHANNELS_CONFIG,
  DEFAULT_GRAM_DEPOSIT_ADDRESS,
  DEFAULT_GRAM_JETTON_MASTER,
  DEFAULT_WITHDRAW_APPROVE_TEMPLATE,
  extractTelegramNumericUserId,
  getActiveRequiredChannels,
  isAdminPlayerId,
  isTelegramMemberStatusJoined,
  MAX_DEPOSIT_COINS,
  MIN_DEPOSIT_COINS,
  normalizeTelegramChannelEntry,
  normalizeTelegramChannelHandle,
  PRIMARY_ADMIN_TELEGRAM_ID,
  PROMO_CODES,
  REFERRER_SIGNUP_BONUS_COINS,
  renderWithdrawApproveMessage,
} from './src/game/economy.ts';
import type {
  ChannelCheckDiagnosticLog,
  ChannelsConfig,
  RequiredTelegramChannel,
  SystemDiagnosticsSnapshot,
  SystemServerLogEntry,
  WithdrawApproveMessageTemplate,
} from './src/types/farm.ts';
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
import {
  DEFAULT_TELEGRAM_BOT_USERNAME,
  DEFAULT_TELEGRAM_MINIAPP_SHORT_NAME,
  normalizeTelegramBotUsername,
  normalizeTelegramMiniAppShortName,
} from './src/utils/telegram.ts';

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

function redactBotToken(message: string): string {
  if (!TELEGRAM_BOT_TOKEN) return message;
  return String(message || '').replaceAll(TELEGRAM_BOT_TOKEN, '[redacted]');
}

function isValidSafeId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{3,64}$/.test(id.trim());
}

function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 169 && b === 254) return true; // Link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && (b === 0 || b === 168)) return true;
  if (a === 198 && (b === 18 || b === 19)) return true; // Benchmarking
  if (a >= 224) return true; // Multicast & reserved
  return false;
}

function isPrivateOrReservedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('::ffff:')) {
    const v4 = lower.slice(7);
    if (isIP(v4) === 4) return isPrivateOrReservedIpv4(v4);
    return true;
  }
  if (/^(fc|fd|fe8|fe9|fea|feb|ff)/i.test(lower)) return true;
  return false;
}

function isSafePublicHttpsUrl(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 512) return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    const rawHost = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!rawHost) return false;
    // Block decimal / hex / octal shorthand IP literals
    if (/^\d+$/.test(rawHost) || /^0x[0-9a-f.]+$/i.test(rawHost)) return false;
    const ipType = isIP(rawHost);
    if (ipType === 4) return !isPrivateOrReservedIpv4(rawHost);
    if (ipType === 6) return !isPrivateOrReservedIpv6(rawHost);
    if (!rawHost.includes('.')) return false;
    if (
      rawHost === 'localhost' ||
      rawHost.endsWith('.local') ||
      rawHost.endsWith('.internal') ||
      rawHost.endsWith('.localhost')
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function getClientIp(req: express.Request): string {
  const sockIp = String(req.socket?.remoteAddress || 'unknown').trim().slice(0, 64);
  const rawFwd = String(req.headers['x-forwarded-for'] || '').split(',')[0]?.trim();
  if (rawFwd && isIP(rawFwd)) {
    return `${rawFwd.slice(0, 48)}`;
  }
  return sockIp;
}

const rateLimitBuckets = new Map<string, number[]>();

function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const cutoff = now - windowMs;
  const recent = (rateLimitBuckets.get(key) || []).filter((ts) => ts > cutoff);
  if (recent.length >= maxRequests) {
    const oldest = recent[0] ?? now;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    rateLimitBuckets.set(key, recent);
    return { allowed: false, retryAfterSec };
  }
  recent.push(now);
  rateLimitBuckets.set(key, recent);
  if (rateLimitBuckets.size > 5000) {
    for (const [k, list] of rateLimitBuckets.entries()) {
      if (list.every((ts) => ts <= cutoff)) {
        rateLimitBuckets.delete(k);
      }
    }
  }
  return { allowed: true, retryAfterSec: 0 };
}

const PORT = Number(process.env.PORT || 3000);
const GRAM_DEPOSIT_ADDRESS =
  process.env.GRAM_DEPOSIT_ADDRESS || DEFAULT_GRAM_DEPOSIT_ADDRESS;
const GRAM_JETTON_MASTER =
  process.env.GRAM_JETTON_MASTER || DEFAULT_GRAM_JETTON_MASTER;
const TELEGRAM_PAYOUT_CHANNEL = normalizeTelegramChannel(
  process.env.TELEGRAM_PAYOUT_CHANNEL || '@AG_PAYOUTS',
);
const TELEGRAM_BOT_TOKEN = (
  process.env.TELEGRAM_BOT_TOKEN ||
  process.env.BOT_TOKEN ||
  process.env.TG_BOT_TOKEN ||
  ''
)
  .trim()
  .replace(/^['"]|['"]$/g, '')
  .replace(/^bot(?=\d+:)/i, '');
const TELEGRAM_BOT_USERNAME_ENV = normalizeTelegramBotUsername(
  process.env.TELEGRAM_BOT_USERNAME || process.env.VITE_TELEGRAM_BOT_USERNAME || '',
);
const TELEGRAM_MINIAPP_SHORT_NAME =
  normalizeTelegramMiniAppShortName(
    process.env.TELEGRAM_MINIAPP_SHORT_NAME ||
      process.env.VITE_TELEGRAM_MINIAPP_SHORT_NAME ||
      '',
  ) || DEFAULT_TELEGRAM_MINIAPP_SHORT_NAME;
const TONCENTER_API_KEY = (process.env.TONCENTER_API_KEY || '').trim();
const ADMIN_TELEGRAM_IDS = (process.env.ADMIN_TELEGRAM_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// ============================================================================
// ADMIN PASSCODE CONFIGURATION (LOCKED IN CODE)
// Passcode is strictly locked in `/server.ts` -> `DEFAULT_ADMIN_PASSCODE` ('924429').
// Admin Panel passcode modifications are disabled.
// ============================================================================
export const DEFAULT_ADMIN_PASSCODE = '924429';

async function getFreshDoc(ref: DocumentReference<DocumentData>): Promise<DocumentSnapshot<DocumentData>> {
  try {
    return await getDocFromServer(ref);
  } catch {
    return getDoc(ref);
  }
}

async function loadActiveAdminSecurity(): Promise<{
  custom: null;
  source: 'default';
  updatedAtMs: number;
}> {
  return {
    custom: null,
    source: 'default',
    updatedAtMs: 0,
  };
}

function normalizePasscodeInput(raw: string): string {
  const withoutSpaces = String(raw || '').replace(/[\s\u200B-\u200D\uFEFF]+/g, '');
  let out = '';
  for (const ch of withoutSpaces) {
    const code = ch.charCodeAt(0);
    // Full-width digits ０-９
    if (code >= 0xff10 && code <= 0xff19) {
      out += String(code - 0xff10);
    // Arabic-Indic digits ٠-٩
    } else if (code >= 0x0660 && code <= 0x0669) {
      out += String(code - 0x0660);
    // Extended Arabic-Indic digits ۰-۹
    } else if (code >= 0x06f0 && code <= 0x06f9) {
      out += String(code - 0x06f0);
    // Devanagari digits ०-९
    } else if (code >= 0x0966 && code <= 0x096f) {
      out += String(code - 0x0966);
    } else {
      out += ch;
    }
  }
  return out;
}

async function verifyAdminPasscodeAsync(provided: string): Promise<{
  ok: boolean;
  source: 'default';
  updatedAtMs: number;
}> {
  const cleanProvided = normalizePasscodeInput(provided);
  if (!cleanProvided) {
    return { ok: false, source: 'default', updatedAtMs: 0 };
  }
  const a = Buffer.from(cleanProvided, 'utf8');
  const b = Buffer.from(DEFAULT_ADMIN_PASSCODE, 'utf8');
  return {
    ok: a.length === b.length && crypto.timingSafeEqual(a, b),
    source: 'default',
    updatedAtMs: 0,
  };
}

const SESSION_SECRET_FILE = path.resolve(__dirname, '.data', 'session_secret.key');

function resolveSessionSigningSecret(): string {
  const envSecret = (process.env.SESSION_SECRET || '').trim();
  if (envSecret.length >= 32) {
    return envSecret;
  }
  if (TELEGRAM_BOT_TOKEN) {
    return crypto
      .createHmac('sha256', 'alphagram-session-signing-v1')
      .update(`${TELEGRAM_BOT_TOKEN}:${DEFAULT_ADMIN_PASSCODE}`)
      .digest('hex');
  }
  try {
    if (fs.existsSync(SESSION_SECRET_FILE)) {
      const existing = fs.readFileSync(SESSION_SECRET_FILE, 'utf8').trim();
      if (existing.length >= 32) {
        return existing;
      }
    }
    const fresh = crypto.randomBytes(32).toString('hex');
    const dir = path.dirname(SESSION_SECRET_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(SESSION_SECRET_FILE, fresh, { encoding: 'utf8', mode: 0o600 });
    return fresh;
  } catch {
    return crypto.randomBytes(32).toString('hex');
  }
}

const SESSION_SIGNING_SECRET = resolveSessionSigningSecret();

let cachedBotUsername = TELEGRAM_BOT_USERNAME_ENV || '';
let lastBotLookupAttemptMs = 0;

async function resolveTelegramBotUsername(): Promise<string> {
  if (TELEGRAM_BOT_USERNAME_ENV) return TELEGRAM_BOT_USERNAME_ENV;
  if (cachedBotUsername) return cachedBotUsername;

  const now = Date.now();
  if (!TELEGRAM_BOT_TOKEN || now - lastBotLookupAttemptMs < 10 * 60 * 1000) {
    return DEFAULT_TELEGRAM_BOT_USERNAME;
  }

  lastBotLookupAttemptMs = now;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        ok?: boolean;
        result?: { username?: string };
      };
      const detected = normalizeTelegramBotUsername(data?.result?.username);
      if (data?.ok && detected) {
        cachedBotUsername = detected;
        return detected;
      }
    }
  } catch {
    // Fallback to default bot username
  }

  return DEFAULT_TELEGRAM_BOT_USERNAME;
}

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
  options?: { allowClockSkew?: boolean },
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

  const authDateSec = Number(params.get('auth_date') || 0);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!options?.allowClockSkew) {
    if (
      !Number.isFinite(authDateSec) ||
      authDateSec <= 0 ||
      nowSec - authDateSec > 86_400 ||
      authDateSec > nowSec + 300
    ) {
      return { valid: false, reason: 'expired_or_invalid_auth_date' };
    }
  } else if (!Number.isFinite(authDateSec) || authDateSec <= 0) {
    return { valid: false, reason: 'expired_or_invalid_auth_date' };
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

function resolveVerifiedAdminActor(params: {
  req: express.Request;
  token?: string;
  initData?: string;
  extraAdminIds: readonly string[];
}): string | null {
  const authHeader = String(params.req.headers.authorization || '')
    .replace(/^Bearer\s+/i, '')
    .trim();
  const candidateToken = String(params.token || authHeader || '').trim();
  if (candidateToken) {
    const verified = verifySessionToken(candidateToken);
    if (
      verified?.role === 'admin' &&
      typeof verified.playerId === 'string' &&
      isAdminPlayerId(verified.playerId, params.extraAdminIds)
    ) {
      return verified.playerId;
    }
  }

  const rawInitData = String(params.initData || '').trim();
  if (rawInitData && TELEGRAM_BOT_TOKEN) {
    const verifiedInit = verifyTelegramInitData(rawInitData, TELEGRAM_BOT_TOKEN, {
      allowClockSkew: true,
    });
    if (
      verifiedInit.valid &&
      verifiedInit.playerId &&
      isAdminPlayerId(verifiedInit.playerId, params.extraAdminIds)
    ) {
      return verifiedInit.playerId;
    }
  }

  return null;
}

function resolveVerifiedPlayerActor(params: {
  req: express.Request;
  token?: string;
  initData?: string;
}): string | null {
  const authHeader = String(params.req.headers.authorization || '')
    .replace(/^Bearer\s+/i, '')
    .trim();
  const candidateToken = String(params.token || authHeader || '').trim();
  if (candidateToken) {
    const verified = verifySessionToken(candidateToken);
    if (
      verified &&
      (verified.role === 'player' || verified.role === 'admin') &&
      typeof verified.playerId === 'string' &&
      isValidSafeId(verified.playerId)
    ) {
      return verified.playerId;
    }
  }

  const rawInitData = String(params.initData || '').trim();
  if (rawInitData && TELEGRAM_BOT_TOKEN) {
    const verifiedInit = verifyTelegramInitData(rawInitData, TELEGRAM_BOT_TOKEN, {
      allowClockSkew: true,
    });
    if (verifiedInit.valid && verifiedInit.playerId && isValidSafeId(verifiedInit.playerId)) {
      return verifiedInit.playerId;
    }
  }

  return null;
}

const REMINDERS_FILE = path.resolve(__dirname, '.data', 'reminders.json');

interface PlayerReminderRecord {
  playerId: string;
  telegramChatId: string;
  enabled: boolean;
  basketFullAtMs: number;
  feedBoostUntilMs: number;
  coopFeverUntilMs: number;
  autoHarvestUntilMs: number;
  lastBasketSentForAt: number;
  lastFeedSentForAt: number;
  lastFeverSentForAt: number;
  lastDroneSentForAt: number;
  updatedAtMs: number;
}

const reminderStore = new Map<string, PlayerReminderRecord>();

function loadRemindersFromDisk(): void {
  try {
    if (!fs.existsSync(REMINDERS_FILE)) return;
    const raw = fs.readFileSync(REMINDERS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item && typeof item === 'object' && isValidSafeId(item.playerId)) {
          const rec = item as PlayerReminderRecord;
          if (rec.telegramChatId) {
            reminderStore.set(rec.playerId, rec);
          }
        }
      }
    }
  } catch {
    // Ignore read errors
  }
}

function persistRemindersToDisk(): void {
  try {
    const dir = path.dirname(REMINDERS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const items = Array.from(reminderStore.values()).slice(-2000);
    fs.writeFileSync(REMINDERS_FILE, JSON.stringify(items), 'utf8');
  } catch {
    // Ignore filesystem errors on read-only containers
  }
}

loadRemindersFromDisk();

let reminderSweepRunning = false;
async function processDueReminders(): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || reminderSweepRunning || reminderStore.size === 0) return;
  reminderSweepRunning = true;
  const now = Date.now();
  const maxStaleMs = 4 * 3_600_000;
  let dirty = false;

  try {
    const botUsername = await resolveTelegramBotUsername();
    const miniAppUrl = `https://t.me/${botUsername}/${TELEGRAM_MINIAPP_SHORT_NAME}`;

    const sendReminderDm = async (chatId: string, text: string) => {
      try {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[{ text: '🐔 Open Alpha Gram Farm', url: miniAppUrl }]],
            },
          }),
          signal: AbortSignal.timeout(7000),
        });
      } catch {
        // Ignore transient Telegram failures
      }
    };

    for (const rec of reminderStore.values()) {
      if (!rec.enabled || !rec.telegramChatId) continue;

      const droneActiveAtBasketFull =
        rec.autoHarvestUntilMs > 0 &&
        rec.basketFullAtMs > 0 &&
        rec.autoHarvestUntilMs >= rec.basketFullAtMs;

      if (
        !droneActiveAtBasketFull &&
        rec.basketFullAtMs > 0 &&
        now >= rec.basketFullAtMs &&
        now - rec.basketFullAtMs <= maxStaleMs &&
        rec.lastBasketSentForAt !== rec.basketFullAtMs
      ) {
        rec.lastBasketSentForAt = rec.basketFullAtMs;
        dirty = true;
        await sendReminderDm(
          rec.telegramChatId,
          '🥚 <b>Your Egg Basket is 100% Full!</b>\n\nTap <b>Collect Eggs</b> inside Alpha Gram so your hens keep producing non-stop.',
        );
      }

      if (
        rec.feedBoostUntilMs > 0 &&
        now >= rec.feedBoostUntilMs &&
        now - rec.feedBoostUntilMs <= maxStaleMs &&
        rec.lastFeedSentForAt !== rec.feedBoostUntilMs
      ) {
        rec.lastFeedSentForAt = rec.feedBoostUntilMs;
        dirty = true;
        await sendReminderDm(
          rec.telegramChatId,
          '⚡ <b>2× Laying Feed Boost Expired!</b>\n\nActivate 2× Feed again to double your egg laying rate.',
        );
      }

      if (
        rec.coopFeverUntilMs > 0 &&
        now >= rec.coopFeverUntilMs &&
        now - rec.coopFeverUntilMs <= maxStaleMs &&
        rec.lastFeverSentForAt !== rec.coopFeverUntilMs
      ) {
        rec.lastFeverSentForAt = rec.coopFeverUntilMs;
        dirty = true;
        await sendReminderDm(
          rec.telegramChatId,
          '🔥 <b>Coop Fever 3× Rush Ended!</b>\n\nCollect your boosted harvest and charge up another 25 ads for 3× Golden Rush.',
        );
      }

      if (
        rec.autoHarvestUntilMs > 0 &&
        now >= rec.autoHarvestUntilMs &&
        now - rec.autoHarvestUntilMs <= maxStaleMs &&
        rec.lastDroneSentForAt !== rec.autoHarvestUntilMs
      ) {
        rec.lastDroneSentForAt = rec.autoHarvestUntilMs;
        dirty = true;
        await sendReminderDm(
          rec.telegramChatId,
          '🤖 <b>Auto-Harvest Drone Pass Expired!</b>\n\nRenew your Farm Drone pass to keep auto-harvesting with zero basket cap loss.',
        );
      }
    }
  } finally {
    if (dirty) persistRemindersToDisk();
    reminderSweepRunning = false;
  }
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
    return false;
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

async function loadChannelsConfigWithSourceFromFirestore(): Promise<{
  config: ChannelsConfig;
  fromFirestore: boolean;
}> {
  if (!serverDb) return { config: DEFAULT_CHANNELS_CONFIG, fromFirestore: false };
  try {
    const snap = await getFreshDoc(doc(serverDb, 'app_config', 'channels'));
    if (!snap.exists()) return { config: DEFAULT_CHANNELS_CONFIG, fromFirestore: false };
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
      config: {
        enabled: d.enabled !== false,
        channels: parsedChannels,
        updatedAtMs: Number(d.updatedAtMs ?? 0),
      },
      fromFirestore: true,
    };
  } catch {
    return { config: DEFAULT_CHANNELS_CONFIG, fromFirestore: false };
  }
}

async function loadChannelsConfigFromFirestore(): Promise<ChannelsConfig> {
  const res = await loadChannelsConfigWithSourceFromFirestore();
  return res.config;
}

async function loadExtraAdminIdsFromFirestore(): Promise<string[]> {
  if (!serverDb) return [];
  try {
    const snap = await getFreshDoc(doc(serverDb, 'app_config', 'admins'));
    if (!snap.exists()) return [];
    const d = snap.data();
    return Array.isArray(d.adminIds)
      ? d.adminIds
          .map((id) => String(id).trim())
          .filter((id) => Boolean(id) && id !== ADMIN_PASSCODE_VAULT_UID)
      : [];
  } catch {
    return [];
  }
}

const CHANNEL_CHECK_LOGS_FILE = path.resolve(__dirname, '.data', 'channel_check_logs.json');
const channelCheckLogs: ChannelCheckDiagnosticLog[] = [];

function loadChannelCheckLogsFromDisk(): void {
  try {
    if (!fs.existsSync(CHANNEL_CHECK_LOGS_FILE)) return;
    const raw = fs.readFileSync(CHANNEL_CHECK_LOGS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (const item of parsed.slice(0, 20)) {
        if (item && typeof item === 'object' && typeof item.timestampMs === 'number') {
          channelCheckLogs.push(item as ChannelCheckDiagnosticLog);
        }
      }
    }
  } catch {
    // Non-fatal
  }
}

const serverDiagnosticLogs: SystemServerLogEntry[] = [];

function recordServerLog(
  level: SystemServerLogEntry['level'],
  source: string,
  message: string,
  detail?: string,
): void {
  const entry: SystemServerLogEntry = {
    id: `slog_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestampMs: Date.now(),
    level,
    source: source.slice(0, 40),
    message: redactBotToken(message).slice(0, 220),
    ...(detail ? { detail: redactBotToken(detail).slice(0, 320) } : {}),
  };
  serverDiagnosticLogs.unshift(entry);
  if (serverDiagnosticLogs.length > 60) {
    serverDiagnosticLogs.length = 60;
  }
}

const botHeartbeatState: {
  lastHeartbeatAtMs: number;
  lastHeartbeatOk: boolean;
  latencyMs: number | null;
  username: string | null;
  botId: number | null;
  webhookUrl: string | null;
  pendingUpdateCount: number;
  error: string | null;
} = {
  lastHeartbeatAtMs: 0,
  lastHeartbeatOk: false,
  latencyMs: null,
  username: null,
  botId: null,
  webhookUrl: null,
  pendingUpdateCount: 0,
  error: null,
};

async function probeBotHeartbeat(forceFresh = false): Promise<typeof botHeartbeatState> {
  if (!TELEGRAM_BOT_TOKEN) {
    botHeartbeatState.lastHeartbeatAtMs = Date.now();
    botHeartbeatState.lastHeartbeatOk = false;
    botHeartbeatState.latencyMs = null;
    botHeartbeatState.username = TELEGRAM_BOT_USERNAME_ENV || null;
    botHeartbeatState.botId = null;
    botHeartbeatState.webhookUrl = null;
    botHeartbeatState.pendingUpdateCount = 0;
    botHeartbeatState.error = 'TELEGRAM_BOT_TOKEN not configured on server';
    return botHeartbeatState;
  }

  const now = Date.now();
  if (!forceFresh && botHeartbeatState.lastHeartbeatAtMs > 0 && now - botHeartbeatState.lastHeartbeatAtMs < 15_000) {
    return botHeartbeatState;
  }

  const startedAt = Date.now();
  try {
    const [meRes, whRes] = await Promise.all([
      fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`, {
        signal: AbortSignal.timeout(6000),
      }),
      fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo`, {
        signal: AbortSignal.timeout(6000),
      }).catch(() => null),
    ]);
    const latencyMs = Math.max(1, Date.now() - startedAt);
    const meData = (await meRes.json()) as {
      ok?: boolean;
      description?: string;
      result?: { id?: number; username?: string };
    };

    let webhookUrl: string | null = null;
    let pendingUpdateCount = 0;
    if (whRes && whRes.ok) {
      const whData = (await whRes.json().catch(() => null)) as {
        ok?: boolean;
        result?: { url?: string; pending_update_count?: number };
      } | null;
      if (whData?.ok && whData.result) {
        webhookUrl = whData.result.url || null;
        pendingUpdateCount = Number(whData.result.pending_update_count ?? 0);
      }
    }

    botHeartbeatState.lastHeartbeatAtMs = Date.now();
    botHeartbeatState.latencyMs = latencyMs;
    botHeartbeatState.webhookUrl = webhookUrl;
    botHeartbeatState.pendingUpdateCount = pendingUpdateCount;

    if (meData.ok && meData.result) {
      const cleanUser = normalizeTelegramBotUsername(meData.result.username);
      if (cleanUser) {
        cachedBotUsername = cleanUser;
      }
      botHeartbeatState.lastHeartbeatOk = true;
      botHeartbeatState.username = cleanUser || cachedBotUsername || DEFAULT_TELEGRAM_BOT_USERNAME;
      botHeartbeatState.botId = typeof meData.result.id === 'number' ? meData.result.id : null;
      botHeartbeatState.error = null;
      recordServerLog(
        'info',
        'bot_heartbeat',
        `Bot @${botHeartbeatState.username} online (${latencyMs}ms)`,
        webhookUrl ? `Webhook active · pending=${pendingUpdateCount}` : `Polling mode · pending=${pendingUpdateCount}`,
      );
    } else {
      const errMsg = redactBotToken(meData.description || 'Telegram getMe returned negative');
      botHeartbeatState.lastHeartbeatOk = false;
      botHeartbeatState.error = errMsg;
      recordServerLog('error', 'bot_heartbeat', 'Bot heartbeat failed', errMsg);
    }
  } catch (err) {
    const latencyMs = Math.max(1, Date.now() - startedAt);
    const errMsg = redactBotToken(err instanceof Error ? err.message : 'Telegram Bot API unreachable');
    botHeartbeatState.lastHeartbeatAtMs = Date.now();
    botHeartbeatState.lastHeartbeatOk = false;
    botHeartbeatState.latencyMs = latencyMs;
    botHeartbeatState.error = errMsg;
    recordServerLog('error', 'bot_heartbeat', 'Bot API connection failed', errMsg);
  }
  return botHeartbeatState;
}

function recordChannelCheckDiagnosticLog(
  entry: Omit<ChannelCheckDiagnosticLog, 'id' | 'timestampMs'>,
): ChannelCheckDiagnosticLog {
  const fullEntry: ChannelCheckDiagnosticLog = {
    id: `cclog_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestampMs: Date.now(),
    ...entry,
  };
  channelCheckLogs.unshift(fullEntry);
  if (channelCheckLogs.length > 20) {
    channelCheckLogs.length = 20;
  }
  recordServerLog(
    fullEntry.error ? 'warn' : fullEntry.allJoined ? 'info' : 'warn',
    fullEntry.endpoint,
    `Channel check ${fullEntry.allJoined ? 'PASSED' : 'NEGATIVE'} (mode=${fullEntry.verificationMode}, user=${fullEntry.telegramUserId || 'none'})`,
    fullEntry.error ||
      fullEntry.channels.map((c) => `${c.handle}:${c.joined ? 'joined' : c.status}`).join(', '),
  );
  try {
    const dir = path.dirname(CHANNEL_CHECK_LOGS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CHANNEL_CHECK_LOGS_FILE, JSON.stringify(channelCheckLogs), 'utf8');
  } catch {
    // Non-fatal on read-only containers
  }
  return fullEntry;
}

function getRecentChannelCheckLogs(limitCount = 5): ChannelCheckDiagnosticLog[] {
  return channelCheckLogs.slice(0, Math.max(1, Math.min(20, limitCount)));
}

loadChannelCheckLogsFromDisk();

async function fetchTelegramChatMember(chatId: string, userId: string): Promise<{
  ok: boolean;
  userNotFound?: boolean;
  errorCode?: number;
  description?: string;
  targetChatIdUsed?: string;
  result?: { status?: string; is_member?: boolean };
}> {
  const tryLookup = async (targetChatId: string) => {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getChatMember?chat_id=${encodeURIComponent(
      targetChatId,
    )}&user_id=${encodeURIComponent(userId)}`;
    const tgRes = await fetch(url, { signal: AbortSignal.timeout(7000) });
    return (await tgRes.json()) as {
      ok?: boolean;
      error_code?: number;
      description?: string;
      result?: { status?: string; is_member?: boolean };
    };
  };

  const cleanedInput = String(chatId || '').trim().replace(/\/+$/, '');
  const normalizedHandle = normalizeTelegramChannelHandle(cleanedInput).handle || cleanedInput;
  const primary = await tryLookup(normalizedHandle);
  if (primary.ok && primary.result) {
    return { ok: true, targetChatIdUsed: normalizedHandle, result: primary.result };
  }

  const primaryDesc = String(primary.description || '').toLowerCase();
  if (primaryDesc.includes('user not found') || primaryDesc.includes('user_id_invalid')) {
    return {
      ok: false,
      userNotFound: true,
      errorCode: primary.error_code,
      targetChatIdUsed: normalizedHandle,
      description: redactBotToken(primary.description || ''),
    };
  }

  // Retry with -100 prefix if admin saved positive numeric ID or -groupId for a channel/supergroup
  const needsSupergroupRetry =
    primaryDesc.includes('chat not found') || primaryDesc.includes('upgraded');
  if (needsSupergroupRetry) {
    const supergroupCandidate = /^\d{6,16}$/.test(normalizedHandle)
      ? `-100${normalizedHandle}`
      : /^-\d{6,16}$/.test(normalizedHandle) && !normalizedHandle.startsWith('-100')
        ? `-100${normalizedHandle.slice(1)}`
        : '';
    if (supergroupCandidate) {
      const retried = await tryLookup(supergroupCandidate);
      if (retried.ok && retried.result) {
        return { ok: true, targetChatIdUsed: supergroupCandidate, result: retried.result };
      }
      const retryDesc = String(retried.description || '').toLowerCase();
      if (retryDesc.includes('user not found') || retryDesc.includes('user_id_invalid')) {
        return {
          ok: false,
          userNotFound: true,
          errorCode: retried.error_code,
          targetChatIdUsed: supergroupCandidate,
          description: redactBotToken(retried.description || ''),
        };
      }
      return {
        ok: false,
        errorCode: retried.error_code ?? primary.error_code,
        targetChatIdUsed: supergroupCandidate,
        description: redactBotToken(retried.description || primary.description || ''),
      };
    }
  }

  return {
    ok: false,
    errorCode: primary.error_code,
    targetChatIdUsed: normalizedHandle,
    description: redactBotToken(primary.description || ''),
  };
}

const referralNotifyDedup = new Map<string, number>();
const withdrawNotifyDedup = new Map<string, number>();

const BOT_SUBSCRIBERS_FILE = path.resolve(__dirname, '.data', 'bot_subscribers.json');
const TELEGRAM_OFFSET_FILE = path.resolve(__dirname, '.data', 'telegram_update_offset.txt');
const PAYOUT_TEMPLATE_FILE = path.resolve(__dirname, '.data', 'payout_template.json');

export interface BotSubscriberRecord {
  chatId: string;
  username: string;
  firstName: string;
  source: 'bot_start' | 'bot_message' | 'miniapp';
  isBotBlocked: boolean;
  joinedAtMs: number;
  lastSeenAtMs: number;
}

const botSubscriberMap = new Map<string, BotSubscriberRecord>();
let cachedTelegramUpdateOffset = 0;

function loadBotSubscribersFromDisk(): void {
  try {
    if (fs.existsSync(BOT_SUBSCRIBERS_FILE)) {
      const raw = fs.readFileSync(BOT_SUBSCRIBERS_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === 'object') {
            const chatId = extractTelegramNumericUserId(String(item.chatId || ''));
            if (chatId && isValidSafeId(chatId)) {
              const src =
                item.source === 'bot_start' || item.source === 'bot_message'
                  ? item.source
                  : 'miniapp';
              botSubscriberMap.set(chatId, {
                chatId,
                username: String(item.username || '').slice(0, 40),
                firstName: String(item.firstName || '').slice(0, 60),
                source: src,
                isBotBlocked: Boolean(item.isBotBlocked),
                joinedAtMs: Math.max(0, Number(item.joinedAtMs) || Date.now()),
                lastSeenAtMs: Math.max(0, Number(item.lastSeenAtMs) || Date.now()),
              });
            }
          }
        }
      }
    }
    if (fs.existsSync(TELEGRAM_OFFSET_FILE)) {
      const off = Number(fs.readFileSync(TELEGRAM_OFFSET_FILE, 'utf8').trim());
      if (Number.isFinite(off) && off > 0) {
        cachedTelegramUpdateOffset = Math.floor(off);
      }
    }
  } catch {
    // Non-fatal
  }
}

function persistBotSubscribersToDisk(): void {
  try {
    const dir = path.dirname(BOT_SUBSCRIBERS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const items = Array.from(botSubscriberMap.values()).slice(-10_000);
    fs.writeFileSync(BOT_SUBSCRIBERS_FILE, JSON.stringify(items), 'utf8');
  } catch {
    // Non-fatal on read-only containers
  }
}

function persistTelegramUpdateOffset(nextOffset: number): void {
  cachedTelegramUpdateOffset = nextOffset;
  try {
    const dir = path.dirname(TELEGRAM_OFFSET_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(TELEGRAM_OFFSET_FILE, String(nextOffset), 'utf8');
  } catch {
    // Non-fatal
  }
}

loadBotSubscribersFromDisk();

async function upsertBotSubscriber(params: {
  chatId: string;
  username?: string;
  firstName?: string;
  source?: 'bot_start' | 'bot_message' | 'miniapp';
  isBotBlocked?: boolean;
}): Promise<BotSubscriberRecord | null> {
  const cleanChatId = extractTelegramNumericUserId(params.chatId);
  if (!cleanChatId || !isValidSafeId(cleanChatId) || cleanChatId.length > 32) {
    return null;
  }
  const now = Date.now();
  const prev = botSubscriberMap.get(cleanChatId);
  const nextSource =
    params.source === 'bot_start' || params.source === 'bot_message'
      ? params.source
      : prev?.source || 'miniapp';
  const next: BotSubscriberRecord = {
    chatId: cleanChatId,
    username: String(params.username ?? prev?.username ?? '').replace(/^@+/, '').slice(0, 40),
    firstName: String(params.firstName ?? prev?.firstName ?? '').slice(0, 60),
    source: nextSource,
    isBotBlocked:
      typeof params.isBotBlocked === 'boolean'
        ? params.isBotBlocked
        : Boolean(prev?.isBotBlocked),
    joinedAtMs: prev?.joinedAtMs || now,
    lastSeenAtMs: now,
  };
  botSubscriberMap.set(cleanChatId, next);
  persistBotSubscribersToDisk();

  if (serverDb) {
    try {
      await setDoc(doc(serverDb, 'bot_subscribers', cleanChatId), {
        chatId: next.chatId,
        username: next.username,
        firstName: next.firstName,
        source: next.source,
        isBotBlocked: next.isBotBlocked,
        joinedAtMs: next.joinedAtMs,
        lastSeenAtMs: next.lastSeenAtMs,
        updatedAt: serverTimestamp(),
      });
    } catch {
      // Disk record already saved
    }
  }
  return next;
}

async function markBotSubscriberBlocked(chatId: string, blocked: boolean): Promise<void> {
  const clean = extractTelegramNumericUserId(chatId);
  if (!clean) return;
  const existing = botSubscriberMap.get(clean);
  if (!existing && !blocked) return;
  await upsertBotSubscriber({
    chatId: clean,
    isBotBlocked: blocked,
  });
}

function loadWithdrawApproveTemplateFromDisk(): WithdrawApproveMessageTemplate | null {
  try {
    if (!fs.existsSync(PAYOUT_TEMPLATE_FILE)) return null;
    const raw = fs.readFileSync(PAYOUT_TEMPLATE_FILE, 'utf8');
    const d = JSON.parse(raw) as Partial<WithdrawApproveMessageTemplate>;
    if (!d || typeof d.messageTemplate !== 'string' || !d.messageTemplate.trim()) return null;
    return {
      messageTemplate: d.messageTemplate.slice(0, 1500),
      buttonText: String(d.buttonText ?? DEFAULT_WITHDRAW_APPROVE_TEMPLATE.buttonText).slice(0, 48),
      buttonUrlTemplate:
        String(d.buttonUrlTemplate || DEFAULT_WITHDRAW_APPROVE_TEMPLATE.buttonUrlTemplate).slice(0, 256),
      updatedAtMs: Math.max(0, Number(d.updatedAtMs ?? 0)),
    };
  } catch {
    return null;
  }
}

function persistWithdrawApproveTemplateToDisk(template: WithdrawApproveMessageTemplate): void {
  try {
    const dir = path.dirname(PAYOUT_TEMPLATE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(PAYOUT_TEMPLATE_FILE, JSON.stringify(template), 'utf8');
  } catch {
    // Non-fatal
  }
}

async function loadWithdrawApproveTemplate(): Promise<WithdrawApproveMessageTemplate> {
  const disk = loadWithdrawApproveTemplateFromDisk();
  if (!serverDb) return disk || DEFAULT_WITHDRAW_APPROVE_TEMPLATE;
  try {
    const snap = await getFreshDoc(doc(serverDb, 'app_config', 'payout_template'));
    if (!snap.exists()) return disk || DEFAULT_WITHDRAW_APPROVE_TEMPLATE;
    const d = snap.data();
    const remote: WithdrawApproveMessageTemplate = {
      messageTemplate:
        typeof d.messageTemplate === 'string' && d.messageTemplate.trim()
          ? d.messageTemplate.slice(0, 1500)
          : DEFAULT_WITHDRAW_APPROVE_TEMPLATE.messageTemplate,
      buttonText:
        typeof d.buttonText === 'string'
          ? d.buttonText.slice(0, 48)
          : DEFAULT_WITHDRAW_APPROVE_TEMPLATE.buttonText,
      buttonUrlTemplate:
        typeof d.buttonUrlTemplate === 'string' && d.buttonUrlTemplate.trim()
          ? d.buttonUrlTemplate.trim().slice(0, 256)
          : DEFAULT_WITHDRAW_APPROVE_TEMPLATE.buttonUrlTemplate,
      updatedAtMs: Math.max(0, Number(d.updatedAtMs ?? 0)),
    };
    if (disk && disk.updatedAtMs > remote.updatedAtMs) {
      return disk;
    }
    return remote;
  } catch {
    return disk || DEFAULT_WITHDRAW_APPROVE_TEMPLATE;
  }
}

async function saveWithdrawApproveTemplateServer(
  input: Omit<WithdrawApproveMessageTemplate, 'updatedAtMs'>,
): Promise<WithdrawApproveMessageTemplate> {
  const nowMs = Date.now();
  const template: WithdrawApproveMessageTemplate = {
    messageTemplate:
      String(input.messageTemplate || '').trim().slice(0, 1500) ||
      DEFAULT_WITHDRAW_APPROVE_TEMPLATE.messageTemplate,
    buttonText: String(input.buttonText ?? '').trim().slice(0, 48),
    buttonUrlTemplate:
      String(input.buttonUrlTemplate || '').trim().slice(0, 256) ||
      DEFAULT_WITHDRAW_APPROVE_TEMPLATE.buttonUrlTemplate,
    updatedAtMs: nowMs,
  };
  persistWithdrawApproveTemplateToDisk(template);
  if (serverDb) {
    try {
      await setDoc(doc(serverDb, 'app_config', 'payout_template'), {
        ...template,
        updatedAt: serverTimestamp(),
      });
    } catch {
      // Disk record already persisted
    }
  }
  return template;
}

interface TelegramUpdatePayload {
  update_id?: number;
  message?: {
    text?: string;
    chat?: { id?: number | string; type?: string };
    from?: { id?: number | string; is_bot?: boolean; username?: string; first_name?: string };
  };
  my_chat_member?: {
    chat?: { id?: number | string; type?: string };
    from?: { id?: number | string; username?: string; first_name?: string };
    new_chat_member?: { status?: string };
  };
}

async function processTelegramUpdate(update: TelegramUpdatePayload): Promise<boolean> {
  if (!update || typeof update !== 'object') return false;
  let captured = false;

  const msg = update.message;
  if (msg && msg.from && !msg.from.is_bot && msg.chat?.type === 'private') {
    const rawChatId = String(msg.chat.id ?? msg.from.id ?? '');
    const text = String(msg.text || '').trim();
    const isStart = /^\/start(\s|@|$)/i.test(text);
    const saved = await upsertBotSubscriber({
      chatId: rawChatId,
      username: msg.from.username,
      firstName: msg.from.first_name,
      source: isStart ? 'bot_start' : 'bot_message',
      isBotBlocked: false,
    });
    if (saved) captured = true;

    if (isStart && TELEGRAM_BOT_TOKEN && saved) {
      try {
        const botUsername = await resolveTelegramBotUsername();
        const miniAppUrl = `https://t.me/${botUsername}/${TELEGRAM_MINIAPP_SHORT_NAME}`;
        const greetName = escapeHtml(saved.firstName || 'Farmer');
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: saved.chatId,
            text: `🐔 <b>Welcome to Alpha Gram, ${greetName}!</b>\n\nHatch hens, collect fresh eggs every hour, boost to <b>3× Fever</b>, and withdraw <b>GRAM</b> directly on TON.\n\nTap below to open your farm!`,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[{ text: '🐔 Open Alpha Gram Farm', url: miniAppUrl }]],
            },
          }),
          signal: AbortSignal.timeout(6000),
        });
      } catch {
        // Non-fatal welcome reply failure
      }
    }
  }

  const memberEvt = update.my_chat_member;
  if (memberEvt && memberEvt.chat?.type === 'private' && memberEvt.from) {
    const rawChatId = String(memberEvt.chat.id ?? memberEvt.from.id ?? '');
    const status = String(memberEvt.new_chat_member?.status || '').toLowerCase();
    const blocked = status === 'kicked' || status === 'left';
    const saved = await upsertBotSubscriber({
      chatId: rawChatId,
      username: memberEvt.from.username,
      firstName: memberEvt.from.first_name,
      source: 'bot_message',
      isBotBlocked: blocked,
    });
    if (saved) captured = true;
  }

  return captured;
}

let botPollInFlight = false;
async function pollTelegramBotUpdates(): Promise<{
  ok: boolean;
  webhookActive: boolean;
  newUpdates: number;
  error?: string;
}> {
  if (!TELEGRAM_BOT_TOKEN) {
    return { ok: false, webhookActive: false, newUpdates: 0, error: 'Bot token not configured' };
  }
  if (botPollInFlight) {
    return { ok: true, webhookActive: false, newUpdates: 0 };
  }
  botPollInFlight = true;
  try {
    const infoRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo`, {
      signal: AbortSignal.timeout(6000),
    });
    const infoData = (await infoRes.json()) as {
      ok?: boolean;
      result?: { url?: string };
    };
    if (infoData.ok && infoData.result?.url) {
      return { ok: true, webhookActive: true, newUpdates: 0 };
    }

    const params = new URLSearchParams({
      limit: '100',
      timeout: '0',
      allowed_updates: JSON.stringify(['message', 'my_chat_member']),
    });
    if (cachedTelegramUpdateOffset > 0) {
      params.set('offset', String(cachedTelegramUpdateOffset));
    }
    const updRes = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?${params.toString()}`,
      { signal: AbortSignal.timeout(7000) },
    );
    const updData = (await updRes.json()) as {
      ok?: boolean;
      description?: string;
      result?: TelegramUpdatePayload[];
    };
    if (!updData.ok || !Array.isArray(updData.result)) {
      return {
        ok: false,
        webhookActive: false,
        newUpdates: 0,
        error: redactBotToken(updData.description || 'Failed to poll updates'),
      };
    }

    let highestId = cachedTelegramUpdateOffset - 1;
    let newUpdates = 0;
    for (const u of updData.result) {
      if (typeof u.update_id === 'number' && u.update_id > highestId) {
        highestId = u.update_id;
      }
      if (await processTelegramUpdate(u)) {
        newUpdates += 1;
      }
    }
    if (highestId >= cachedTelegramUpdateOffset) {
      persistTelegramUpdateOffset(highestId + 1);
    }
    botHeartbeatState.lastHeartbeatAtMs = Date.now();
    botHeartbeatState.lastHeartbeatOk = true;
    botHeartbeatState.error = null;
    if (newUpdates > 0) {
      recordServerLog('info', 'bot_poller', `Processed ${newUpdates} new Telegram bot update(s)`);
    }
    return { ok: true, webhookActive: false, newUpdates };
  } catch (err) {
    const errMsg = redactBotToken(err instanceof Error ? err.message : 'Poll failed');
    botHeartbeatState.lastHeartbeatAtMs = Date.now();
    botHeartbeatState.lastHeartbeatOk = false;
    botHeartbeatState.error = errMsg;
    recordServerLog('warn', 'bot_poller', 'Telegram update poll failed', errMsg);
    return {
      ok: false,
      webhookActive: false,
      newUpdates: 0,
      error: errMsg,
    };
  } finally {
    botPollInFlight = false;
  }
}

async function collectBroadcastAudienceDetails(excludeBanned: boolean): Promise<{
  recipients: string[];
  botSubscriberCount: number;
  blockedBotCount: number;
  playerRecipientCount: number;
}> {
  const uniqueChatIds = new Set<string>();
  const bannedSet = new Set<string>();
  const blockedByBotSet = new Set<string>();
  const activeBotSet = new Set<string>();
  const playerSet = new Set<string>();

  for (const sub of botSubscriberMap.values()) {
    if (sub.isBotBlocked) {
      blockedByBotSet.add(sub.chatId);
    } else {
      activeBotSet.add(sub.chatId);
      uniqueChatIds.add(sub.chatId);
    }
  }

  for (const rec of reminderStore.values()) {
    const clean = extractTelegramNumericUserId(rec.telegramChatId);
    if (clean) {
      uniqueChatIds.add(clean);
    }
  }

  if (serverDb) {
    if (excludeBanned) {
      try {
        let lastBanDoc: QueryDocumentSnapshot<DocumentData> | null = null;
        for (let page = 0; page < 25; page += 1) {
          const banQuery: Query<DocumentData> = lastBanDoc
            ? query(collection(serverDb, 'banned_users'), orderBy('bannedAtMs', 'desc'), startAfter(lastBanDoc), limit(100))
            : query(collection(serverDb, 'banned_users'), orderBy('bannedAtMs', 'desc'), limit(100));
          const banSnap: QuerySnapshot<DocumentData> = await getDocs(banQuery);
          if (banSnap.empty) break;
          for (const d of banSnap.docs) {
            const uid = String(d.data()?.uid || d.id || '').trim();
            const num = extractTelegramNumericUserId(uid);
            if (num) bannedSet.add(num);
          }
          if (banSnap.docs.length < 100) break;
          lastBanDoc = banSnap.docs[banSnap.docs.length - 1];
        }
      } catch {
        // Non-fatal
      }
    }

    try {
      let lastSubDoc: QueryDocumentSnapshot<DocumentData> | null = null;
      for (let page = 0; page < 40; page += 1) {
        const subQuery: Query<DocumentData> = lastSubDoc
          ? query(collection(serverDb, 'bot_subscribers'), orderBy('lastSeenAtMs', 'desc'), startAfter(lastSubDoc), limit(100))
          : query(collection(serverDb, 'bot_subscribers'), orderBy('lastSeenAtMs', 'desc'), limit(100));
        const subSnap: QuerySnapshot<DocumentData> = await getDocs(subQuery);
        if (subSnap.empty) break;
        for (const d of subSnap.docs) {
          const chatId = extractTelegramNumericUserId(String(d.data()?.chatId || d.id || ''));
          if (!chatId) continue;
          if (d.data()?.isBotBlocked) {
            blockedByBotSet.add(chatId);
            uniqueChatIds.delete(chatId);
          } else {
            activeBotSet.add(chatId);
            uniqueChatIds.add(chatId);
          }
        }
        if (subSnap.docs.length < 100) break;
        lastSubDoc = subSnap.docs[subSnap.docs.length - 1];
      }
    } catch {
      // Non-fatal
    }

    try {
      let lastDoc: QueryDocumentSnapshot<DocumentData> | null = null;
      for (let page = 0; page < 40; page += 1) {
        const q: Query<DocumentData> = lastDoc
          ? query(collection(serverDb, 'players'), orderBy('createdAtMs', 'asc'), startAfter(lastDoc), limit(50))
          : query(collection(serverDb, 'players'), orderBy('createdAtMs', 'asc'), limit(50));
        const snap: QuerySnapshot<DocumentData> = await getDocs(q);
        if (snap.empty) break;
        for (const docSnap of snap.docs) {
          const uid = String(docSnap.data()?.uid || docSnap.id || '').trim();
          const tgId = extractTelegramNumericUserId(uid);
          if (tgId) {
            playerSet.add(tgId);
            uniqueChatIds.add(tgId);
          }
        }
        if (snap.docs.length < 50) break;
        lastDoc = snap.docs[snap.docs.length - 1];
      }
    } catch {
      // Fallback to leaderboard collection
    }

    try {
      let lastLbDoc: QueryDocumentSnapshot<DocumentData> | null = null;
      for (let page = 0; page < 10; page += 1) {
        const lbQuery: Query<DocumentData> = lastLbDoc
          ? query(collection(serverDb, 'leaderboard'), orderBy('buyerPoints', 'desc'), startAfter(lastLbDoc), limit(50))
          : query(collection(serverDb, 'leaderboard'), orderBy('buyerPoints', 'desc'), limit(50));
        const lbSnap: QuerySnapshot<DocumentData> = await getDocs(lbQuery);
        if (lbSnap.empty) break;
        for (const d of lbSnap.docs) {
          const tgId = extractTelegramNumericUserId(String(d.data()?.uid || d.id || ''));
          if (tgId) {
            playerSet.add(tgId);
            uniqueChatIds.add(tgId);
          }
        }
        if (lbSnap.docs.length < 50) break;
        lastLbDoc = lbSnap.docs[lbSnap.docs.length - 1];
      }
    } catch {
      // Non-fatal
    }
  }

  const recipients = Array.from(uniqueChatIds).filter(
    (id) => !blockedByBotSet.has(id) && (!excludeBanned || !bannedSet.has(id)),
  );

  return {
    recipients,
    botSubscriberCount: activeBotSet.size,
    blockedBotCount: blockedByBotSet.size,
    playerRecipientCount: playerSet.size,
  };
}

async function collectBroadcastRecipients(excludeBanned: boolean): Promise<string[]> {
  const details = await collectBroadcastAudienceDetails(excludeBanned);
  return details.recipients;
}

const ALLOWED_BROADCAST_MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

function parseBroadcastMediaDataUrl(dataUrl: string): {
  ok: true;
  mime: string;
  buffer: Buffer;
  ext: string;
} | { ok: false; error: string } {
  const trimmed = String(dataUrl || '').trim();
  const match = trimmed.match(/^data:([a-z0-9/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) {
    return { ok: false, error: 'Invalid uploaded media payload format.' };
  }
  const mime = match[1].toLowerCase();
  const ext = ALLOWED_BROADCAST_MIME_EXT[mime];
  if (!ext) {
    return {
      ok: false,
      error: `Unsupported media file type (${mime}). Use JPG, PNG, WebP, GIF, or MP4.`,
    };
  }
  const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (buffer.length === 0) {
    return { ok: false, error: 'Uploaded media file is empty.' };
  }
  if (buffer.length > 10 * 1024 * 1024) {
    return { ok: false, error: 'Uploaded media exceeds 10 MB limit.' };
  }
  return { ok: true, mime, buffer, ext };
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // Mount broadcast route with a 15 MB JSON parser BEFORE the global 100 KB limit
  // so device-uploaded images/videos/GIFs are accepted cleanly while all other routes stay 100 KB capped.
  app.post('/api/admin/broadcast', express.json({ limit: '15mb' }), async (req, res) => {
    const ip = getClientIp(req);
    const rl = checkRateLimit(`admin_bcast:${ip}`, 10, 15 * 60_000);
    if (!rl.allowed) {
      res.status(429).json({
        ok: false,
        error: `Broadcast rate limit reached. Retry in ${rl.retryAfterSec}s.`,
      });
      return;
    }

    const body = req.body as {
      token?: string;
      initData?: string;
      title?: string;
      message?: string;
      mediaType?: 'none' | 'photo' | 'video' | 'animation';
      mediaUrl?: string;
      mediaDataUrl?: string;
      mediaFilename?: string;
      buttonText?: string;
      buttonUrl?: string;
      excludeBanned?: boolean;
      testOnlyToAdmin?: boolean;
    };

    const firestoreAdminIds = await loadExtraAdminIdsFromFirestore();
    const effectiveExtraAdmins = [...ADMIN_TELEGRAM_IDS, ...firestoreAdminIds];
    const resolvedPlayerId = resolveVerifiedAdminActor({
      req,
      token: body.token,
      initData: body.initData,
      extraAdminIds: effectiveExtraAdmins,
    });

    if (!resolvedPlayerId) {
      res.status(403).json({ ok: false, error: 'Verified Admin session required to send broadcasts.' });
      return;
    }

    if (!TELEGRAM_BOT_TOKEN) {
      res.status(400).json({ ok: false, error: 'TELEGRAM_BOT_TOKEN is not configured on server.' });
      return;
    }

    const rawTitle = String(body.title || '').trim().slice(0, 100);
    const rawMessage = String(body.message || '').trim().slice(0, 2000);
    if (!rawTitle && !rawMessage) {
      res.status(400).json({ ok: false, error: 'Enter a broadcast title or message.' });
      return;
    }

    const mediaType =
      body.mediaType === 'photo' || body.mediaType === 'video' || body.mediaType === 'animation'
        ? body.mediaType
        : 'none';
    const mediaUrl = String(body.mediaUrl || '').trim();
    const mediaDataUrl = String(body.mediaDataUrl || '').trim();

    let uploadedMedia: { mime: string; buffer: Buffer; ext: string; filename: string } | null = null;
    if (mediaType !== 'none') {
      if (mediaDataUrl) {
        const parsedMedia = parseBroadcastMediaDataUrl(mediaDataUrl);
        if (!parsedMedia.ok) {
          res.status(400).json({ ok: false, error: parsedMedia.error });
          return;
        }
        const safeName =
          String(body.mediaFilename || '')
            .replace(/[^a-zA-Z0-9._-]/g, '_')
            .slice(0, 48) || `broadcast.${parsedMedia.ext}`;
        uploadedMedia = {
          mime: parsedMedia.mime,
          buffer: parsedMedia.buffer,
          ext: parsedMedia.ext,
          filename: safeName,
        };
      } else if (!isSafePublicHttpsUrl(mediaUrl)) {
        res.status(400).json({
          ok: false,
          error: 'Upload a file or enter a valid public HTTPS media URL.',
        });
        return;
      }
    }

    const buttonText = String(body.buttonText || '').trim().slice(0, 32);
    const buttonUrl = String(body.buttonUrl || '').trim();
    if (buttonText && !isSafePublicHttpsUrl(buttonUrl)) {
      res.status(400).json({
        ok: false,
        error: 'CTA button URL must be a valid public HTTPS URL.',
      });
      return;
    }

    const htmlParts: string[] = [];
    if (rawTitle) htmlParts.push(`📢 <b>${escapeHtml(rawTitle)}</b>`);
    if (rawMessage) htmlParts.push(escapeHtml(rawMessage));
    const formattedText = htmlParts.join('\n\n').slice(0, mediaType === 'none' ? 4096 : 1024);

    const botUsername = await resolveTelegramBotUsername();
    const defaultMiniAppUrl = `https://t.me/${botUsername}/${TELEGRAM_MINIAPP_SHORT_NAME}`;
    const replyMarkup =
      buttonText && buttonUrl
        ? { inline_keyboard: [[{ text: buttonText, url: buttonUrl }]] }
        : { inline_keyboard: [[{ text: '🐔 Open Alpha Gram', url: defaultMiniAppUrl }]] };

    const adminNumericId = extractTelegramNumericUserId(resolvedPlayerId);
    const targetChatIds = body.testOnlyToAdmin
      ? (adminNumericId ? [adminNumericId] : [])
      : await collectBroadcastRecipients(body.excludeBanned !== false);

    if (targetChatIds.length === 0) {
      res.json({
        ok: true,
        totalTargets: 0,
        sentCount: 0,
        failedCount: 0,
        blockedCount: 0,
        testOnlyToAdmin: Boolean(body.testOnlyToAdmin),
        sampleError: body.testOnlyToAdmin
          ? 'Your active Admin ID is not a numeric Telegram chat ID.'
          : 'No Telegram bot subscribers or player chat IDs found yet.',
      });
      return;
    }

    let sentCount = 0;
    let failedCount = 0;
    let blockedCount = 0;
    let sampleError = '';
    let cachedTelegramFileId = '';

    const endpoint =
      mediaType === 'photo'
        ? 'sendPhoto'
        : mediaType === 'video'
          ? 'sendVideo'
          : mediaType === 'animation'
            ? 'sendAnimation'
            : 'sendMessage';

    const mediaField =
      mediaType === 'photo'
        ? 'photo'
        : mediaType === 'video'
          ? 'video'
          : 'animation';

    const dispatchSingleBroadcast = async (chatId: string) => {
      if (mediaType !== 'none' && uploadedMedia && !cachedTelegramFileId) {
        const form = new FormData();
        form.append('chat_id', chatId);
        form.append(
          mediaField,
          new Blob([new Uint8Array(uploadedMedia.buffer)], { type: uploadedMedia.mime }),
          uploadedMedia.filename,
        );
        form.append('caption', formattedText);
        form.append('parse_mode', 'HTML');
        form.append('reply_markup', JSON.stringify(replyMarkup));

        const tgRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${endpoint}`, {
          method: 'POST',
          body: form,
          signal: AbortSignal.timeout(20_000),
        });
        return (await tgRes.json()) as {
          ok?: boolean;
          error_code?: number;
          description?: string;
          parameters?: { retry_after?: number };
          result?: {
            photo?: Array<{ file_id?: string }>;
            video?: { file_id?: string };
            animation?: { file_id?: string };
          };
        };
      }

      const mediaValue = cachedTelegramFileId || mediaUrl;
      const payload: Record<string, unknown> =
        mediaType === 'none'
          ? {
              chat_id: chatId,
              text: formattedText,
              parse_mode: 'HTML',
              reply_markup: replyMarkup,
            }
          : {
              chat_id: chatId,
              [mediaField]: mediaValue,
              caption: formattedText,
              parse_mode: 'HTML',
              reply_markup: replyMarkup,
            };

      const tgRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
      return (await tgRes.json()) as {
        ok?: boolean;
        error_code?: number;
        description?: string;
        parameters?: { retry_after?: number };
        result?: {
          photo?: Array<{ file_id?: string }>;
          video?: { file_id?: string };
          animation?: { file_id?: string };
        };
      };
    };

    for (const chatId of targetChatIds) {
      try {
        let tgData = await dispatchSingleBroadcast(chatId);
        if (tgData.error_code === 429 && tgData.parameters?.retry_after) {
          const waitMs = Math.min(5000, Math.max(500, tgData.parameters.retry_after * 1000));
          await new Promise((r) => setTimeout(r, waitMs));
          tgData = await dispatchSingleBroadcast(chatId);
        }

        if (tgData.ok) {
          sentCount += 1;
          if (!cachedTelegramFileId && uploadedMedia && tgData.result) {
            if (mediaType === 'photo' && Array.isArray(tgData.result.photo) && tgData.result.photo.length > 0) {
              cachedTelegramFileId = String(tgData.result.photo[tgData.result.photo.length - 1]?.file_id || '');
            } else if (mediaType === 'video' && tgData.result.video?.file_id) {
              cachedTelegramFileId = String(tgData.result.video.file_id);
            } else if (mediaType === 'animation' && tgData.result.animation?.file_id) {
              cachedTelegramFileId = String(tgData.result.animation.file_id);
            }
          }
        } else {
          failedCount += 1;
          const desc = String(tgData.description || '');
          const low = desc.toLowerCase();
          if (tgData.error_code === 403 || low.includes('blocked') || low.includes('chat not found') || low.includes('deactivated')) {
            blockedCount += 1;
            await markBotSubscriberBlocked(chatId, true);
          }
          if (!sampleError && desc) {
            sampleError = redactBotToken(desc);
          }
        }
      } catch (err) {
        failedCount += 1;
        if (!sampleError) {
          sampleError = redactBotToken(err instanceof Error ? err.message : 'Telegram API error');
        }
      }

      if (targetChatIds.length > 1) {
        await new Promise((r) => setTimeout(r, 50));
      }
    }

    res.json({
      ok: true,
      totalTargets: targetChatIds.length,
      sentCount,
      failedCount,
      blockedCount,
      testOnlyToAdmin: Boolean(body.testOnlyToAdmin),
      ...(sampleError ? { sampleError } : {}),
    });
  });

  app.use(express.json({ limit: '100kb' }));

  app.get('/api/config', async (_req, res) => {
    const [channelsCfg, telegramBotUsername, adminSecurity] = await Promise.all([
      loadChannelsConfigFromFirestore(),
      resolveTelegramBotUsername(),
      loadActiveAdminSecurity(),
    ]);
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
      telegramBotUsername,
      telegramAppShortName: TELEGRAM_MINIAPP_SHORT_NAME,
      persistentLedgerEnabled: Boolean(serverDb),
      adminPasscodeSource: adminSecurity.source,
      adminPasscodeUpdatedAtMs: adminSecurity.updatedAtMs,
    });
  });

  app.post('/api/telegram/check-channels', async (req, res) => {
    const ip = getClientIp(req);
    const rl = checkRateLimit(`chk_ch:${ip}`, 60, 60_000);
    if (!rl.allowed) {
      res.status(429).json({ ok: false, error: `Too many requests. Retry in ${rl.retryAfterSec}s.` });
      return;
    }
    const body = req.body as {
      initData?: string;
      token?: string;
      playerId?: string;
      requiredChannels?: Array<Partial<RequiredTelegramChannel>>;
    };
    const rawInitData = String(body.initData || '').trim();
    const rawPlayerId = String(body.playerId || '').trim();

    const { config: channelsCfg, fromFirestore } = await loadChannelsConfigWithSourceFromFirestore();
    let targetChannels = getActiveRequiredChannels(channelsCfg);
    if (!fromFirestore && Array.isArray(body.requiredChannels) && channelsCfg.enabled) {
      targetChannels = body.requiredChannels
        .map((ch, idx) => normalizeTelegramChannelEntry(ch, idx))
        .filter((ch): ch is RequiredTelegramChannel => Boolean(ch && ch.enabled !== false))
        .slice(0, 10);
    }

    const verifiedActor = resolveVerifiedPlayerActor({
      req,
      token: body.token,
      initData: rawInitData,
    });

    // getChatMember is a strictly read-only Telegram lookup:
    // accept verified actor first, and gracefully fall back to initData user.id or tg_<id>
    let numericUserId: string | null = verifiedActor
      ? extractTelegramNumericUserId(verifiedActor)
      : null;
    let userIdSource: 'verified' | 'init_user' | 'player_id' | 'none' = numericUserId
      ? 'verified'
      : 'none';

    if (!numericUserId && rawInitData) {
      try {
        const initParams = new URLSearchParams(rawInitData);
        const userJson = initParams.get('user');
        if (userJson) {
          const parsedUser = JSON.parse(userJson) as { id?: number | string };
          const parsedId = extractTelegramNumericUserId(parsedUser?.id);
          if (parsedId) {
            numericUserId = parsedId;
            userIdSource = 'init_user';
          }
        }
      } catch {
        // Ignore malformed initData user JSON
      }
    }

    if (!numericUserId) {
      const fallbackTgId = extractTelegramNumericUserId(rawPlayerId);
      if (fallbackTgId) {
        numericUserId = fallbackTgId;
        userIdSource = 'player_id';
      }
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
      const channelsOut = targetChannels.map((ch) => ({
        ...ch,
        joined: false,
        status: 'no_telegram_user',
      }));
      recordChannelCheckDiagnosticLog({
        endpoint: 'check-channels',
        userIdSource,
        telegramUserId: null,
        verificationMode: 'guest_browser',
        allJoined: false,
        fromFirestore,
        botConfigured: Boolean(TELEGRAM_BOT_TOKEN),
        error: 'No Telegram numeric user ID detected on request',
        channels: channelsOut.map((c) => ({
          handle: c.handle,
          joined: false,
          status: c.status,
          rawTelegramOk: false,
          rawDescription: 'No Telegram user ID detected (guest browser / non-Telegram context)',
        })),
      });
      res.json({
        ok: true,
        allJoined: false,
        verificationMode: 'guest_browser',
        telegramUserId: null,
        channels: channelsOut,
        checkedAtMs: Date.now(),
      });
      return;
    }

    if (!TELEGRAM_BOT_TOKEN) {
      const channelsOut = targetChannels.map((ch) => ({
        ...ch,
        joined: false,
        status: 'bot_unconfigured',
        error: 'TELEGRAM_BOT_TOKEN not configured on server',
      }));
      recordChannelCheckDiagnosticLog({
        endpoint: 'check-channels',
        userIdSource,
        telegramUserId: numericUserId,
        verificationMode: 'bot_unconfigured',
        allJoined: false,
        fromFirestore,
        botConfigured: false,
        error: 'TELEGRAM_BOT_TOKEN not configured on server',
        channels: channelsOut.map((c) => ({
          handle: c.handle,
          joined: false,
          status: c.status,
          rawTelegramOk: false,
          rawDescription: c.error,
        })),
      });
      res.json({
        ok: true,
        allJoined: false,
        verificationMode: 'bot_unconfigured',
        telegramUserId: numericUserId,
        channels: channelsOut,
        checkedAtMs: Date.now(),
      });
      return;
    }

    const logChannelRows: ChannelCheckDiagnosticLog['channels'] = [];
    const checks = await Promise.all(
      targetChannels.map(async (ch) => {
        try {
          const tgData = await fetchTelegramChatMember(ch.handle, numericUserId!);

          if (!tgData.ok || !tgData.result) {
            if (tgData.userNotFound) {
              logChannelRows.push({
                handle: ch.handle,
                joined: false,
                status: 'left',
                rawTelegramOk: false,
                errorCode: tgData.errorCode,
                rawDescription: tgData.description || 'User not found in channel',
                targetChatIdUsed: tgData.targetChatIdUsed,
              });
              return {
                ...ch,
                joined: false,
                status: 'left',
              };
            }
            const errText = tgData.description || 'Make sure the bot is admin in this channel';
            logChannelRows.push({
              handle: ch.handle,
              joined: false,
              status: 'api_error',
              rawTelegramOk: false,
              errorCode: tgData.errorCode,
              rawDescription: errText,
              targetChatIdUsed: tgData.targetChatIdUsed,
            });
            return {
              ...ch,
              joined: false,
              status: 'api_error',
              error: errText,
            };
          }

          const status = String(tgData.result.status || 'left');
          const joined = isTelegramMemberStatusJoined(status, tgData.result.is_member);
          logChannelRows.push({
            handle: ch.handle,
            joined,
            status,
            rawTelegramOk: true,
            rawStatus: status,
            rawIsMember:
              typeof tgData.result.is_member === 'boolean' ? tgData.result.is_member : null,
            targetChatIdUsed: tgData.targetChatIdUsed,
          });
          return {
            ...ch,
            joined,
            status,
          };
        } catch (err) {
          const errText = err instanceof Error ? err.message : 'Telegram API timeout';
          logChannelRows.push({
            handle: ch.handle,
            joined: false,
            status: 'network_error',
            rawTelegramOk: false,
            rawDescription: errText,
          });
          return {
            ...ch,
            joined: false,
            status: 'network_error',
            error: errText,
          };
        }
      }),
    );

    const allJoined = checks.every((c) => c.joined);
    recordChannelCheckDiagnosticLog({
      endpoint: 'check-channels',
      userIdSource,
      telegramUserId: numericUserId,
      verificationMode: 'telegram_bot',
      allJoined,
      fromFirestore,
      botConfigured: true,
      channels: logChannelRows,
    });
    console.info(
      '[channel-check]',
      JSON.stringify({
        userIdSource,
        numericUserId,
        fromFirestore,
        allJoined,
        channels: checks.map((c) => ({
          handle: c.handle,
          joined: c.joined,
          status: c.status,
          error: 'error' in c && c.error ? redactBotToken(String(c.error)) : undefined,
        })),
      }),
    );

    res.json({
      ok: true,
      allJoined,
      verificationMode: 'telegram_bot',
      telegramUserId: numericUserId,
      channels: checks,
      checkedAtMs: Date.now(),
    });
  });

  app.post('/api/telegram/check-task-channel', async (req, res) => {
    const ip = getClientIp(req);
    const rl = checkRateLimit(`chk_task_ch:${ip}`, 60, 60_000);
    if (!rl.allowed) {
      res.status(429).json({ ok: false, error: `Too many requests. Retry in ${rl.retryAfterSec}s.` });
      return;
    }
    const body = req.body as {
      initData?: string;
      token?: string;
      playerId?: string;
      actionUrl?: string;
    };
    const actionUrl = String(body.actionUrl || '').trim();
    if (!actionUrl || !TELEGRAM_BOT_TOKEN) {
      res.json({ ok: true, enforced: false, joined: true, reason: 'not_applicable' });
      return;
    }
    // Skip bot start links & private invite links (t.me/bot?start=..., t.me/+...)
    if (
      /[?&]start(app)?=/i.test(actionUrl) ||
      /t\.me\/(\+|joinchat\/)/i.test(actionUrl)
    ) {
      res.json({ ok: true, enforced: false, joined: true, reason: 'non_public_channel' });
      return;
    }
    const normalized = normalizeTelegramChannelHandle(actionUrl);
    if (!normalized.handle) {
      res.json({ ok: true, enforced: false, joined: true, reason: 'not_telegram_channel' });
      return;
    }

    const verifiedActor = resolveVerifiedPlayerActor({
      req,
      token: body.token,
      initData: String(body.initData || '').trim(),
    });
    const numericUserId =
      extractTelegramNumericUserId(verifiedActor) ||
      extractTelegramNumericUserId(String(body.playerId || '').trim());
    if (!numericUserId) {
      res.json({ ok: true, enforced: false, joined: true, reason: 'no_telegram_user' });
      return;
    }

    try {
      const tgData = await fetchTelegramChatMember(normalized.handle, numericUserId);
      if (tgData.userNotFound) {
        recordChannelCheckDiagnosticLog({
          endpoint: 'check-task-channel',
          userIdSource: verifiedActor ? 'verified' : 'player_id',
          telegramUserId: numericUserId,
          verificationMode: 'telegram_bot',
          allJoined: false,
          botConfigured: true,
          channels: [
            {
              handle: normalized.handle,
              joined: false,
              status: 'left',
              rawTelegramOk: false,
              errorCode: tgData.errorCode,
              rawDescription: tgData.description || 'User not found in channel',
              targetChatIdUsed: tgData.targetChatIdUsed,
            },
          ],
        });
        res.json({
          ok: true,
          enforced: true,
          joined: false,
          handle: normalized.handle,
          status: 'left',
        });
        return;
      }
      if (!tgData.ok || !tgData.result) {
        // Bot is not admin in third-party/partner channel or link is a bot/username — don't false-block
        recordChannelCheckDiagnosticLog({
          endpoint: 'check-task-channel',
          userIdSource: verifiedActor ? 'verified' : 'player_id',
          telegramUserId: numericUserId,
          verificationMode: 'telegram_bot',
          allJoined: false,
          botConfigured: true,
          error: tgData.description || 'bot_not_admin_in_task_channel',
          channels: [
            {
              handle: normalized.handle,
              joined: false,
              status: 'api_error',
              rawTelegramOk: false,
              errorCode: tgData.errorCode,
              rawDescription: tgData.description || 'bot_not_admin_in_task_channel',
              targetChatIdUsed: tgData.targetChatIdUsed,
            },
          ],
        });
        res.json({
          ok: true,
          enforced: false,
          joined: true,
          handle: normalized.handle,
          reason: tgData.description || 'bot_not_admin_in_task_channel',
        });
        return;
      }
      const status = String(tgData.result.status || 'left');
      const joined = isTelegramMemberStatusJoined(status, tgData.result.is_member);
      recordChannelCheckDiagnosticLog({
        endpoint: 'check-task-channel',
        userIdSource: verifiedActor ? 'verified' : 'player_id',
        telegramUserId: numericUserId,
        verificationMode: 'telegram_bot',
        allJoined: joined,
        botConfigured: true,
        channels: [
          {
            handle: normalized.handle,
            joined,
            status,
            rawTelegramOk: true,
            rawStatus: status,
            rawIsMember:
              typeof tgData.result.is_member === 'boolean' ? tgData.result.is_member : null,
            targetChatIdUsed: tgData.targetChatIdUsed,
          },
        ],
      });
      res.json({
        ok: true,
        enforced: true,
        joined,
        handle: normalized.handle,
        status,
      });
    } catch {
      res.json({ ok: true, enforced: false, joined: true, reason: 'network_error' });
    }
  });

  app.post('/api/telegram/test-channels', async (req, res) => {
    const ip = getClientIp(req);
    const rl = checkRateLimit(`test_ch:${ip}`, 25, 60_000);
    if (!rl.allowed) {
      res.status(429).json({ ok: false, error: `Too many requests. Retry in ${rl.retryAfterSec}s.` });
      return;
    }

    const body = req.body as {
      initData?: string;
      token?: string;
      requiredChannels?: Array<Partial<RequiredTelegramChannel>>;
    };

    const firestoreAdminIds = await loadExtraAdminIdsFromFirestore();
    const effectiveExtraAdmins = [...ADMIN_TELEGRAM_IDS, ...firestoreAdminIds];
    const resolvedPlayerId = resolveVerifiedAdminActor({
      req,
      token: body.token,
      initData: body.initData,
      extraAdminIds: effectiveExtraAdmins,
    });

    if (!resolvedPlayerId) {
      res.status(403).json({
        ok: false,
        error: 'Admin session token or verified Telegram Admin session required.',
      });
      return;
    }

    const channelsCfg = await loadChannelsConfigFromFirestore();
    const targetChannels = Array.isArray(body.requiredChannels)
      ? body.requiredChannels
          .map((ch, idx) => normalizeTelegramChannelEntry(ch, idx))
          .filter((ch): ch is RequiredTelegramChannel => Boolean(ch && ch.enabled !== false))
          .slice(0, 10)
      : getActiveRequiredChannels(channelsCfg);

    if (!TELEGRAM_BOT_TOKEN) {
      const channelsOut = targetChannels.map((ch) => ({
        id: ch.id,
        handle: ch.handle,
        botIsAdmin: false,
        botStatus: 'bot_unconfigured',
        error: 'TELEGRAM_BOT_TOKEN not configured on server',
      }));
      recordChannelCheckDiagnosticLog({
        endpoint: 'test-channels',
        userIdSource: 'admin_session',
        telegramUserId: extractTelegramNumericUserId(resolvedPlayerId),
        verificationMode: 'bot_unconfigured',
        allJoined: false,
        botConfigured: false,
        error: 'TELEGRAM_BOT_TOKEN is not set in server environment variables.',
        channels: channelsOut.map((c) => ({
          handle: c.handle,
          joined: false,
          status: c.botStatus,
          botIsAdmin: false,
          botStatus: c.botStatus,
          rawTelegramOk: false,
          rawDescription: c.error,
        })),
      });
      res.json({
        ok: true,
        botConfigured: false,
        botUsername: null,
        botError: 'TELEGRAM_BOT_TOKEN is not set in server environment variables.',
        channels: channelsOut,
        recentLogs: getRecentChannelCheckLogs(5),
      });
      return;
    }

    try {
      const meRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`, {
        signal: AbortSignal.timeout(6000),
      });
      const meData = (await meRes.json()) as {
        ok?: boolean;
        error_code?: number;
        description?: string;
        result?: { id?: number | string; username?: string };
      };
      if (!meData.ok || !meData.result?.id) {
        const channelsOut = targetChannels.map((ch) => ({
          id: ch.id,
          handle: ch.handle,
          botIsAdmin: false,
          botStatus: 'token_invalid',
          error: meData.description || 'Bot token rejected by Telegram',
        }));
        recordChannelCheckDiagnosticLog({
          endpoint: 'test-channels',
          userIdSource: 'admin_session',
          telegramUserId: extractTelegramNumericUserId(resolvedPlayerId),
          verificationMode: 'telegram_bot',
          allJoined: false,
          botConfigured: true,
          error: redactBotToken(meData.description || 'Invalid TELEGRAM_BOT_TOKEN (getMe failed)'),
          channels: channelsOut.map((c) => ({
            handle: c.handle,
            joined: false,
            status: c.botStatus,
            botIsAdmin: false,
            botStatus: c.botStatus,
            rawTelegramOk: false,
            errorCode: meData.error_code,
            rawDescription: c.error,
          })),
        });
        res.json({
          ok: true,
          botConfigured: true,
          botUsername: null,
          botError: meData.description || 'Invalid TELEGRAM_BOT_TOKEN (getMe failed)',
          channels: channelsOut,
          recentLogs: getRecentChannelCheckLogs(5),
        });
        return;
      }

      const botId = String(meData.result.id);
      const botUsername = meData.result.username || '';
      const adminNumericId = extractTelegramNumericUserId(resolvedPlayerId);
      const diagLogChannels: ChannelCheckDiagnosticLog['channels'] = [];

      const results = await Promise.all(
        targetChannels.map(async (ch) => {
          try {
            const botMember = await fetchTelegramChatMember(ch.handle, botId);
            if (!botMember.ok || !botMember.result) {
              const errMsg = botMember.description || 'Could not inspect bot status in channel';
              diagLogChannels.push({
                handle: ch.handle,
                joined: false,
                status: 'api_error',
                botIsAdmin: false,
                botStatus: 'api_error',
                rawTelegramOk: false,
                errorCode: botMember.errorCode,
                rawDescription: errMsg,
                targetChatIdUsed: botMember.targetChatIdUsed,
              });
              return {
                id: ch.id,
                handle: ch.handle,
                botIsAdmin: false,
                botStatus: 'api_error',
                error: errMsg,
              };
            }
            const botStatus = String(botMember.result.status || 'left').toLowerCase();
            const botIsAdmin = botStatus === 'administrator' || botStatus === 'creator';
            let userJoined: boolean | null = null;
            let userStatus: string | null = null;
            let userRawDesc: string | undefined;
            let userRawOk: boolean | undefined;
            let userErrorCode: number | undefined;
            if (adminNumericId) {
              const adminCheck = await fetchTelegramChatMember(ch.handle, adminNumericId);
              if (adminCheck.userNotFound) {
                userStatus = 'left';
                userJoined = false;
                userRawOk = false;
                userErrorCode = adminCheck.errorCode;
                userRawDesc = adminCheck.description || 'User not found in channel';
              } else if (adminCheck.ok && adminCheck.result) {
                userStatus = String(adminCheck.result.status || 'left');
                userJoined = isTelegramMemberStatusJoined(userStatus, adminCheck.result.is_member);
                userRawOk = true;
              } else {
                userRawOk = false;
                userErrorCode = adminCheck.errorCode;
                userRawDesc = adminCheck.description;
              }
            }
            diagLogChannels.push({
              handle: ch.handle,
              joined: Boolean(userJoined),
              status: userStatus || (botIsAdmin ? 'bot_admin_ready' : botStatus),
              botIsAdmin,
              botStatus,
              rawTelegramOk: userRawOk ?? true,
              errorCode: userErrorCode,
              rawStatus: userStatus || botStatus,
              rawDescription:
                userRawDesc ||
                (!botIsAdmin ? `Bot status is "${botStatus}" — promote bot to Admin` : undefined),
              targetChatIdUsed: botMember.targetChatIdUsed,
            });
            return {
              id: ch.id,
              handle: ch.handle,
              botIsAdmin,
              botStatus,
              userJoined,
              userStatus,
              error: botIsAdmin ? undefined : `Bot status is "${botStatus}" — promote bot to Admin in ${ch.handle}`,
            };
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : 'Telegram API timeout';
            diagLogChannels.push({
              handle: ch.handle,
              joined: false,
              status: 'network_error',
              botIsAdmin: false,
              botStatus: 'network_error',
              rawTelegramOk: false,
              rawDescription: errMsg,
            });
            return {
              id: ch.id,
              handle: ch.handle,
              botIsAdmin: false,
              botStatus: 'network_error',
              error: errMsg,
            };
          }
        }),
      );

      recordChannelCheckDiagnosticLog({
        endpoint: 'test-channels',
        userIdSource: 'admin_session',
        telegramUserId: adminNumericId,
        verificationMode: 'telegram_bot',
        allJoined: results.every((r) => r.botIsAdmin && r.userJoined !== false),
        botConfigured: true,
        botUsername,
        channels: diagLogChannels,
      });

      res.json({
        ok: true,
        botConfigured: true,
        botUsername,
        channels: results,
        recentLogs: getRecentChannelCheckLogs(5),
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to connect to Telegram API';
      recordChannelCheckDiagnosticLog({
        endpoint: 'test-channels',
        userIdSource: 'admin_session',
        telegramUserId: extractTelegramNumericUserId(resolvedPlayerId),
        verificationMode: 'telegram_bot',
        allJoined: false,
        botConfigured: true,
        error: redactBotToken(errMsg),
        channels: [],
      });
      res.json({
        ok: true,
        botConfigured: true,
        botUsername: null,
        botError: errMsg,
        channels: [],
        recentLogs: getRecentChannelCheckLogs(5),
      });
    }
  });

  app.post('/api/admin/channel-logs', async (req, res) => {
    const body = (req.body || {}) as { token?: string; initData?: string };
    const firestoreAdminIds = await loadExtraAdminIdsFromFirestore();
    const effectiveExtraAdmins = [...ADMIN_TELEGRAM_IDS, ...firestoreAdminIds];
    const resolvedPlayerId = resolveVerifiedAdminActor({
      req,
      token: body.token,
      initData: body.initData,
      extraAdminIds: effectiveExtraAdmins,
    });
    if (!resolvedPlayerId) {
      res.status(403).json({ ok: false, error: 'Verified Admin session required.' });
      return;
    }
    res.json({
      ok: true,
      logs: getRecentChannelCheckLogs(5),
      totalRecorded: channelCheckLogs.length,
    });
  });

  app.get('/api/admin/channel-logs', async (req, res) => {
    const firestoreAdminIds = await loadExtraAdminIdsFromFirestore();
    const effectiveExtraAdmins = [...ADMIN_TELEGRAM_IDS, ...firestoreAdminIds];
    const resolvedPlayerId = resolveVerifiedAdminActor({
      req,
      token: typeof req.query.token === 'string' ? req.query.token : undefined,
      initData: typeof req.query.initData === 'string' ? req.query.initData : undefined,
      extraAdminIds: effectiveExtraAdmins,
    });
    if (!resolvedPlayerId) {
      res.status(403).json({ ok: false, error: 'Verified Admin session required.' });
      return;
    }
    res.json({
      ok: true,
      logs: getRecentChannelCheckLogs(5),
      totalRecorded: channelCheckLogs.length,
    });
  });

  const handleSystemDiagnosticsRequest = async (
    req: express.Request,
    res: express.Response,
    params: { token?: string; initData?: string; forceHeartbeat?: boolean },
  ) => {
    const firestoreAdminIds = await loadExtraAdminIdsFromFirestore();
    const effectiveExtraAdmins = [...ADMIN_TELEGRAM_IDS, ...firestoreAdminIds];
    const resolvedPlayerId = resolveVerifiedAdminActor({
      req,
      token: params.token,
      initData: params.initData,
      extraAdminIds: effectiveExtraAdmins,
    });
    if (!resolvedPlayerId) {
      res.status(403).json({ ok: false, error: 'Verified Admin session required.' });
      return;
    }

    const heartbeat = await probeBotHeartbeat(Boolean(params.forceHeartbeat));

    let firestoreReadOk = false;
    let firestoreLatencyMs: number | null = null;
    let firestoreError: string | null = serverDb ? null : 'Firestore client not initialized on server';
    let projectId = '';
    let databaseId = '';
    try {
      const cfgPath = path.resolve(__dirname, 'firebase-applet-config.json');
      if (fs.existsSync(cfgPath)) {
        const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as {
          projectId?: string;
          firestoreDatabaseId?: string;
        };
        projectId = cfg.projectId || '';
        databaseId = cfg.firestoreDatabaseId || '';
      }
    } catch {
      // Ignore config read issues
    }

    if (serverDb) {
      const dbStart = Date.now();
      try {
        await getFreshDoc(doc(serverDb, 'app_config', 'channels'));
        firestoreReadOk = true;
        firestoreLatencyMs = Math.max(1, Date.now() - dbStart);
      } catch (err) {
        firestoreReadOk = false;
        firestoreLatencyMs = Math.max(1, Date.now() - dbStart);
        firestoreError = err instanceof Error ? err.message : 'Firestore read probe failed';
        recordServerLog('error', 'firestore', 'Firestore heartbeat read failed', firestoreError);
      }
    }

    const mem = process.memoryUsage();
    const snapshot: SystemDiagnosticsSnapshot = {
      ok: true,
      serverTimeMs: Date.now(),
      uptimeSec: Math.floor(process.uptime()),
      nodeVersion: process.version,
      env: process.env.NODE_ENV || 'development',
      memoryMb: {
        rss: Math.round(mem.rss / (1024 * 1024)),
        heapUsed: Math.round(mem.heapUsed / (1024 * 1024)),
        heapTotal: Math.round(mem.heapTotal / (1024 * 1024)),
      },
      bot: {
        configured: Boolean(TELEGRAM_BOT_TOKEN),
        username: heartbeat.username || cachedBotUsername || (TELEGRAM_BOT_USERNAME_ENV || null),
        botId: heartbeat.botId,
        lastHeartbeatAtMs: heartbeat.lastHeartbeatAtMs,
        lastHeartbeatOk: heartbeat.lastHeartbeatOk,
        latencyMs: heartbeat.latencyMs,
        error: heartbeat.error,
        webhookUrl: heartbeat.webhookUrl,
        pendingUpdateCount: heartbeat.pendingUpdateCount,
        subscriberCount: botSubscriberMap.size,
        activePollIntervalSec: 20,
      },
      firestore: {
        connected: Boolean(serverDb) && firestoreReadOk,
        databaseId,
        projectId,
        readOk: firestoreReadOk,
        latencyMs: firestoreLatencyMs,
        error: firestoreError,
      },
      channelCheckStats: {
        totalLogsRecorded: channelCheckLogs.length,
        lastCheckAtMs: channelCheckLogs[0]?.timestampMs ?? null,
      },
      rateLimitBucketsCount: rateLimitBuckets.size,
      serverLogs: serverDiagnosticLogs.slice(0, 40),
    };

    res.json(snapshot);
  };

  app.post('/api/admin/system-diagnostics', async (req, res) => {
    const body = (req.body || {}) as {
      token?: string;
      initData?: string;
      forceHeartbeat?: boolean;
    };
    await handleSystemDiagnosticsRequest(req, res, body);
  });

  app.get('/api/admin/system-diagnostics', async (req, res) => {
    await handleSystemDiagnosticsRequest(req, res, {
      token: typeof req.query.token === 'string' ? req.query.token : undefined,
      initData: typeof req.query.initData === 'string' ? req.query.initData : undefined,
      forceHeartbeat: req.query.forceHeartbeat === '1' || req.query.forceHeartbeat === 'true',
    });
  });

  app.post('/api/auth/verify-telegram', (req, res) => {
    const body = req.body as { initData?: string };
    const rawInitData = String(body.initData || '').trim();
    if (!rawInitData || !TELEGRAM_BOT_TOKEN) {
      res.json({ ok: true, verified: false, mode: 'guest' });
      return;
    }

    const check = verifyTelegramInitData(rawInitData, TELEGRAM_BOT_TOKEN, {
      allowClockSkew: true,
    });
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
    const tgUser = check.user as { username?: unknown; first_name?: unknown } | undefined;
    void upsertBotSubscriber({
      chatId: check.playerId,
      username: typeof tgUser?.username === 'string' ? tgUser.username : '',
      firstName: typeof tgUser?.first_name === 'string' ? tgUser.first_name : '',
      source: 'miniapp',
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

  app.post('/api/telegram/webhook', async (req, res) => {
    const expectedSecret = (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
    if (expectedSecret) {
      const providedSecret = String(req.headers['x-telegram-bot-api-secret-token'] || '').trim();
      if (providedSecret !== expectedSecret) {
        res.status(401).json({ ok: false });
        return;
      }
    }
    try {
      await processTelegramUpdate(req.body as TelegramUpdatePayload);
    } catch {
      // Acknowledge cleanly to avoid Telegram retry storms
    }
    res.json({ ok: true });
  });

  app.post('/api/admin/auth', async (req, res) => {
    const ip = getClientIp(req);
    const body = req.body as {
      playerId?: string;
      initData?: string;
      passcode?: string;
      token?: string;
    };
    const rawPlayerId = String(body.playerId || '').trim();
    const rawInitData = String(body.initData || '').trim();
    const rawPasscode = String(body.passcode || '').trim();
    const authHeader = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    const candidateToken = String(body.token || authHeader || '').trim();

    const firestoreAdminIds = await loadExtraAdminIdsFromFirestore();
    const effectiveExtraAdmins = [...ADMIN_TELEGRAM_IDS, ...firestoreAdminIds];

    if (candidateToken) {
      const verified = verifySessionToken(candidateToken);
      if (verified?.role === 'admin' && isAdminPlayerId(verified.playerId, effectiveExtraAdmins)) {
        res.json({ ok: true, method: 'token', token: candidateToken });
        return;
      }
    }

    const sockAddr = String(req.socket?.remoteAddress || 'unknown').slice(0, 64);
    const failIpKey = `admin_auth_fail:${ip}:${sockAddr}`;
    const existingIpFails = (rateLimitBuckets.get(failIpKey) || []).filter(
      (ts) => ts > Date.now() - 15 * 60_000,
    );
    if (existingIpFails.length >= 15) {
      const retryAfterSec = Math.max(
        1,
        Math.ceil(((existingIpFails[0] ?? Date.now()) + 15 * 60_000 - Date.now()) / 1000),
      );
      res.status(429).json({
        ok: false,
        requiresPasscode: true,
        error: `Too many wrong passcode attempts. Wait ${retryAfterSec}s before trying again.`,
      });
      return;
    }

    let resolvedPlayerId = rawPlayerId;
    let initDataValid: boolean | null = null;
    let initDataReason: string | undefined;
    if (rawInitData && TELEGRAM_BOT_TOKEN) {
      const verifiedInit = verifyTelegramInitData(rawInitData, TELEGRAM_BOT_TOKEN, {
        allowClockSkew: true,
      });
      initDataValid = verifiedInit.valid;
      initDataReason = verifiedInit.reason;
      if (verifiedInit.valid && verifiedInit.playerId) {
        resolvedPlayerId = verifiedInit.playerId;
      } else if (!isValidSafeId(resolvedPlayerId) || !isAdminPlayerId(resolvedPlayerId, effectiveExtraAdmins)) {
        console.warn('[admin-auth] rejected_initdata', {
          ip,
          rawPlayerId,
          initDataValid,
          initDataReason,
          botTokenConfigured: Boolean(TELEGRAM_BOT_TOKEN),
        });
        res.status(401).json({
          ok: false,
          error: 'Invalid or expired Telegram session signature.',
        });
        return;
      }
    }

    const isAuthorizedId =
      isValidSafeId(resolvedPlayerId) && isAdminPlayerId(resolvedPlayerId, effectiveExtraAdmins);

    if (!isAuthorizedId) {
      console.warn('[admin-auth] rejected_unauthorized_id', {
        ip,
        rawPlayerId,
        resolvedPlayerId,
        hasInitData: Boolean(rawInitData),
        initDataValid,
        initDataReason,
        botTokenConfigured: Boolean(TELEGRAM_BOT_TOKEN),
      });
      res.status(403).json({
        ok: false,
        error: `Restricted to authorized Admin IDs (Primary: ${PRIMARY_ADMIN_TELEGRAM_ID}).`,
      });
      return;
    }

    const failIdKey = `admin_auth_fail_id:${resolvedPlayerId}`;
    const existingIdFails = (rateLimitBuckets.get(failIdKey) || []).filter(
      (ts) => ts > Date.now() - 15 * 60_000,
    );
    if (existingIdFails.length >= 15) {
      const retryAfterSec = Math.max(
        1,
        Math.ceil(((existingIdFails[0] ?? Date.now()) + 15 * 60_000 - Date.now()) / 1000),
      );
      res.status(429).json({
        ok: false,
        requiresPasscode: true,
        error: `Too many wrong passcode attempts for this Admin ID. Wait ${retryAfterSec}s.`,
      });
      return;
    }

    if (!rawPasscode) {
      res.status(401).json({
        ok: false,
        requiresPasscode: true,
        error: 'Enter your Admin Passcode to unlock the Admin Console.',
      });
      return;
    }

    const normalizedProvidedLen = normalizePasscodeInput(rawPasscode).length;
    const authResult = await verifyAdminPasscodeAsync(rawPasscode);
    console.info('[admin-auth] passcode_check', {
      ip,
      rawPlayerId,
      resolvedPlayerId,
      hasInitData: Boolean(rawInitData),
      initDataValid,
      initDataReason,
      botTokenConfigured: Boolean(TELEGRAM_BOT_TOKEN),
      providedLen: normalizedProvidedLen,
      expectedLen: DEFAULT_ADMIN_PASSCODE.length,
      matched: authResult.ok,
    });
    if (!authResult.ok) {
      checkRateLimit(failIpKey, 15, 15 * 60_000);
      checkRateLimit(failIdKey, 15, 15 * 60_000);
      recordServerLog('warn', 'admin_auth', `Rejected admin passcode for ${resolvedPlayerId}`, `source=${authResult.source}`);
      res.status(403).json({
        ok: false,
        requiresPasscode: true,
        passcodeSource: authResult.source,
        error: 'Incorrect Admin Passcode. Please check and try again.',
      });
      return;
    }

    rateLimitBuckets.delete(failIpKey);
    rateLimitBuckets.delete(failIdKey);
    recordServerLog('info', 'admin_auth', `Admin Console unlocked by ${resolvedPlayerId}`, `source=${authResult.source}`);

    const token = signSessionToken({
      role: 'admin',
      playerId: resolvedPlayerId,
      method: 'passcode',
    });
    res.json({
      ok: true,
      method: 'passcode',
      token,
      passcodeSource: authResult.source,
      passcodeUpdatedAtMs: authResult.updatedAtMs,
    });
  });

  app.post('/api/admin/change-passcode', async (_req, res) => {
    res.status(403).json({
      ok: false,
      error: 'Admin passcode is locked in server.ts and cannot be changed from the Admin Panel.',
    });
  });

  app.post('/api/admin/broadcast/stats', async (req, res) => {
    const body = (req.body || {}) as {
      token?: string;
      initData?: string;
      excludeBanned?: boolean;
    };
    const firestoreAdminIds = await loadExtraAdminIdsFromFirestore();
    const effectiveExtraAdmins = [...ADMIN_TELEGRAM_IDS, ...firestoreAdminIds];
    const resolvedPlayerId = resolveVerifiedAdminActor({
      req,
      token: body.token,
      initData: body.initData,
      extraAdminIds: effectiveExtraAdmins,
    });
    if (!resolvedPlayerId) {
      res.status(403).json({ ok: false, error: 'Verified Admin session required.' });
      return;
    }
    const stats = await collectBroadcastAudienceDetails(body.excludeBanned !== false);
    res.json({
      ok: true,
      totalRecipients: stats.recipients.length,
      botSubscriberCount: stats.botSubscriberCount,
      blockedBotCount: stats.blockedBotCount,
      playerRecipientCount: stats.playerRecipientCount,
    });
  });

  app.get('/api/admin/broadcast/stats', async (req, res) => {
    const firestoreAdminIds = await loadExtraAdminIdsFromFirestore();
    const effectiveExtraAdmins = [...ADMIN_TELEGRAM_IDS, ...firestoreAdminIds];
    const resolvedPlayerId = resolveVerifiedAdminActor({
      req,
      token: typeof req.query.token === 'string' ? req.query.token : undefined,
      initData: typeof req.query.initData === 'string' ? req.query.initData : undefined,
      extraAdminIds: effectiveExtraAdmins,
    });
    if (!resolvedPlayerId) {
      res.status(403).json({ ok: false, error: 'Verified Admin session required.' });
      return;
    }
    const excludeBanned = req.query.excludeBanned !== 'false';
    const stats = await collectBroadcastAudienceDetails(excludeBanned);
    res.json({
      ok: true,
      totalRecipients: stats.recipients.length,
      botSubscriberCount: stats.botSubscriberCount,
      blockedBotCount: stats.blockedBotCount,
      playerRecipientCount: stats.playerRecipientCount,
    });
  });

  app.post('/api/admin/telegram/sync-bot', async (req, res) => {
    const body = (req.body || {}) as { token?: string; initData?: string };
    const firestoreAdminIds = await loadExtraAdminIdsFromFirestore();
    const effectiveExtraAdmins = [...ADMIN_TELEGRAM_IDS, ...firestoreAdminIds];
    const resolvedPlayerId = resolveVerifiedAdminActor({
      req,
      token: body.token,
      initData: body.initData,
      extraAdminIds: effectiveExtraAdmins,
    });
    if (!resolvedPlayerId) {
      res.status(403).json({ ok: false, error: 'Verified Admin session required.' });
      return;
    }
    const poll = await pollTelegramBotUpdates();
    const stats = await collectBroadcastAudienceDetails(true);
    res.json({
      ok: true,
      poll,
      totalRecipients: stats.recipients.length,
      botSubscriberCount: stats.botSubscriberCount,
      blockedBotCount: stats.blockedBotCount,
      playerRecipientCount: stats.playerRecipientCount,
    });
  });

  app.post('/api/admin/payout-template', async (req, res) => {
    const body = (req.body || {}) as {
      token?: string;
      initData?: string;
      messageTemplate?: string;
      buttonText?: string;
      buttonUrlTemplate?: string;
    };
    const firestoreAdminIds = await loadExtraAdminIdsFromFirestore();
    const effectiveExtraAdmins = [...ADMIN_TELEGRAM_IDS, ...firestoreAdminIds];
    const resolvedPlayerId = resolveVerifiedAdminActor({
      req,
      token: body.token,
      initData: body.initData,
      extraAdminIds: effectiveExtraAdmins,
    });
    if (!resolvedPlayerId) {
      res.status(403).json({ ok: false, error: 'Verified Admin session required.' });
      return;
    }
    const saved = await saveWithdrawApproveTemplateServer({
      messageTemplate: String(body.messageTemplate || ''),
      buttonText: String(body.buttonText ?? ''),
      buttonUrlTemplate: String(body.buttonUrlTemplate || ''),
    });
    res.json({ ok: true, template: saved });
  });

  app.post('/api/reminders/sync', (req, res) => {
    const ip = getClientIp(req);
    const rl = checkRateLimit(`rem_sync:${ip}`, 40, 60_000);
    if (!rl.allowed) {
      res.status(429).json({ ok: false, error: 'Too many reminder sync requests.' });
      return;
    }

    const body = req.body as {
      playerId?: string;
      initData?: string;
      token?: string;
      enabled?: boolean;
      basketFullAtMs?: number;
      feedBoostUntilMs?: number;
      coopFeverUntilMs?: number;
      autoHarvestUntilMs?: number;
    };

    const rawPlayerId = String(body.playerId || '').trim();
    const verifiedActor = resolveVerifiedPlayerActor({
      req,
      token: body.token,
      initData: body.initData,
    });
    if ((body.initData || body.token) && !verifiedActor && TELEGRAM_BOT_TOKEN) {
      res.status(401).json({ ok: false, error: 'Invalid Telegram session.' });
      return;
    }

    let playerId = verifiedActor || rawPlayerId;
    if (verifiedActor && rawPlayerId && verifiedActor !== rawPlayerId) {
      res.status(403).json({ ok: false, error: 'Session mismatch for reminder sync.' });
      return;
    }

    if (!isValidSafeId(playerId)) {
      res.status(400).json({ ok: false, error: 'Valid playerId required.' });
      return;
    }

    const telegramChatId = extractTelegramNumericUserId(playerId);
    if (!telegramChatId) {
      res.json({ ok: true, registered: false, reason: 'no_telegram_chat_id' });
      return;
    }

    if (TELEGRAM_BOT_TOKEN && !verifiedActor) {
      res.status(401).json({
        ok: false,
        error: 'Verified Telegram session required to register push reminders.',
      });
      return;
    }

    const prev = reminderStore.get(playerId);
    const maxFutureMs = Date.now() + 31 * 86_400_000;
    const clampMs = (v: unknown) => {
      const n = Math.floor(Number(v) || 0);
      return Number.isFinite(n) && n > 0 ? Math.min(maxFutureMs, n) : 0;
    };

    const next: PlayerReminderRecord = {
      playerId,
      telegramChatId,
      enabled: body.enabled !== false,
      basketFullAtMs: clampMs(body.basketFullAtMs),
      feedBoostUntilMs: clampMs(body.feedBoostUntilMs),
      coopFeverUntilMs: clampMs(body.coopFeverUntilMs),
      autoHarvestUntilMs: clampMs(body.autoHarvestUntilMs),
      lastBasketSentForAt: prev?.lastBasketSentForAt ?? 0,
      lastFeedSentForAt: prev?.lastFeedSentForAt ?? 0,
      lastFeverSentForAt: prev?.lastFeverSentForAt ?? 0,
      lastDroneSentForAt: prev?.lastDroneSentForAt ?? 0,
      updatedAtMs: Date.now(),
    };

    reminderStore.set(playerId, next);
    persistRemindersToDisk();
    void upsertBotSubscriber({ chatId: telegramChatId, source: 'miniapp' });
    res.json({ ok: true, registered: true, enabled: next.enabled });
  });

  app.post('/api/referrals/notify', async (req, res) => {
    const ip = getClientIp(req);
    const rl = checkRateLimit(`ref_notify:${ip}`, 30, 60_000);
    if (!rl.allowed) {
      res.status(429).json({ ok: false, sent: false, reason: 'Rate limit exceeded' });
      return;
    }

    const body = req.body as {
      event?: 'referral_joined' | 'deposit_commission';
      referrerUid?: string;
      referredUid?: string;
      referredName?: string;
      referredHandle?: string;
      rewardCoins?: number;
      depositGram?: string;
      depositUsd?: number;
      initData?: string;
      token?: string;
    };

    const referrerUid = String(body.referrerUid || '').trim();
    const referredUid = String(body.referredUid || '').trim();
    const numericReferrerId = extractTelegramNumericUserId(referrerUid);
    const event = body.event === 'deposit_commission' ? 'deposit_commission' : 'referral_joined';
    const rewardCoins =
      event === 'referral_joined'
        ? REFERRER_SIGNUP_BONUS_COINS
        : Math.min(10_000, Math.max(0, Math.round(Number(body.rewardCoins ?? 0))));

    if (!isValidSafeId(referrerUid) || !numericReferrerId) {
      res.json({
        ok: true,
        sent: false,
        reason: 'Referrer does not have a Telegram numeric chat ID',
      });
      return;
    }

    if (!isValidSafeId(referredUid)) {
      res.status(400).json({ ok: false, sent: false, reason: 'Valid referredUid required' });
      return;
    }

    const verifiedActor = resolveVerifiedPlayerActor({
      req,
      token: body.token,
      initData: body.initData,
    });

    if (serverDb) {
      try {
        const refSnap = await getFreshDoc(doc(serverDb, 'players', referrerUid, 'referrals', referredUid));
        if (!refSnap.exists()) {
          const referredSnap = await getFreshDoc(doc(serverDb, 'players', referredUid));
          const linkedReferrer = referredSnap.exists() ? String(referredSnap.data()?.referredBy || '') : '';
          if (linkedReferrer !== referrerUid) {
            res.status(403).json({ ok: false, sent: false, reason: 'Unverified referral relationship' });
            return;
          }
        }
      } catch {
        res.status(503).json({
          ok: false,
          sent: false,
          reason: 'Database verification temporarily unavailable',
        });
        return;
      }
    } else if (TELEGRAM_BOT_TOKEN && (!verifiedActor || verifiedActor !== referredUid)) {
      res.status(401).json({ ok: false, sent: false, reason: 'Verified session required' });
      return;
    }

    const dedupKey = `${event}:${referrerUid}:${referredUid || rewardCoins}:${String(body.depositGram || '')}`;
    const prevSentAt = referralNotifyDedup.get(dedupKey);
    if (prevSentAt && Date.now() - prevSentAt < 60_000) {
      res.json({ ok: true, sent: false, reason: 'Duplicate notification suppressed' });
      return;
    }
    referralNotifyDedup.set(dedupKey, Date.now());
    if (referralNotifyDedup.size > 1000) referralNotifyDedup.clear();

    if (!TELEGRAM_BOT_TOKEN) {
      res.json({
        ok: true,
        sent: false,
        reason: 'TELEGRAM_BOT_TOKEN not configured on server',
      });
      return;
    }

    const messageText = buildReferralBotNotificationMessage({
      event,
      referredName: body.referredName,
      referredHandle: body.referredHandle,
      rewardCoins,
      depositGram: body.depositGram,
      depositUsd: body.depositUsd,
    });

    try {
      const tgRes = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: numericReferrerId,
            text: messageText,
            parse_mode: 'HTML',
          }),
          signal: AbortSignal.timeout(7000),
        },
      );
      const tgData = (await tgRes.json()) as { ok?: boolean; description?: string };
      res.json({
        ok: true,
        sent: Boolean(tgData.ok),
        reason: tgData.ok ? undefined : redactBotToken(tgData.description || 'Telegram API error'),
      });
    } catch (err) {
      res.json({
        ok: true,
        sent: false,
        reason: redactBotToken(err instanceof Error ? err.message : 'Telegram request failed'),
      });
    }
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
    const ip = getClientIp(req);
    const rl = checkRateLimit(`dep_chk:${ip}`, 35, 60_000);
    if (!rl.allowed) {
      res.status(429).json({ error: `Too many deposit checks. Retry in ${rl.retryAfterSec}s.` });
      return;
    }

    const body = req.body as {
      playerId?: string;
      claimedTxHashes?: string[];
    };

    const playerId = String(body.playerId || '').trim();
    if (!isValidSafeId(playerId)) {
      res.status(400).json({ error: 'Valid User ID is required.' });
      return;
    }
    const memo = getPrimaryDepositMemo(playerId);
    const acceptedMemos = buildAcceptedDepositMemos(playerId);
    const clientClaimed = Array.isArray(body.claimedTxHashes)
      ? body.claimedTxHashes.slice(0, 100).map((s) => String(s).slice(0, 128))
      : [];
    const dbClaimed = await loadFirestoreClaimedTxHashes();
    const allClaimed = [...clientClaimed, ...dbClaimed, ...Array.from(processedServerTxHashes)];

    if (acceptedMemos.length === 0) {
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
    const ip = getClientIp(req);
    const rl = checkRateLimit(`wd_notify:${ip}`, 25, 60_000);
    if (!rl.allowed) {
      res.status(429).json({ ok: false, sent: false, reason: 'Too many requests' });
      return;
    }

    const body = req.body as {
      withdrawalId?: string;
      token?: string;
      initData?: string;
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

    const status = body.status === 'approved' || body.status === 'rejected' ? body.status : 'pending';
    const withdrawalId = String(body.withdrawalId || '').trim();

    if (status === 'approved' || status === 'rejected') {
      const firestoreAdminIds = await loadExtraAdminIdsFromFirestore();
      const effectiveExtraAdmins = [...ADMIN_TELEGRAM_IDS, ...firestoreAdminIds];
      const verifiedAdmin = resolveVerifiedAdminActor({
        req,
        token: body.token,
        initData: body.initData,
        extraAdminIds: effectiveExtraAdmins,
      });
      if (!verifiedAdmin) {
        res.status(403).json({
          ok: false,
          sent: false,
          reason: 'Admin authorization required for payout approval notifications.',
        });
        return;
      }
    }

    let authUserId = String(body.playerId || '').slice(0, 64);
    let authTxId = String(withdrawalId || '').slice(0, 64);
    let authDisplayName = String(body.displayName || 'Farmer').slice(0, 60);
    let authHandle = String(body.handle || '@farmer').slice(0, 40);
    let authEggs = Number(body.eggsAmount || 0);
    let authGram = String(body.gramAmount || '0');
    let authUsd = Number(body.usdValue || 0);
    let authWallet = String(body.walletAddress || '').slice(0, 128);
    let authMemo = String(body.memo || '').slice(0, 64);

    if (serverDb) {
      if (!isValidSafeId(withdrawalId)) {
        res.status(400).json({ ok: false, sent: false, reason: 'Valid withdrawalId required.' });
        return;
      }
      try {
        const wdSnap = await getFreshDoc(doc(serverDb, 'withdraw_requests', withdrawalId));
        if (!wdSnap.exists()) {
          res.status(403).json({ ok: false, sent: false, reason: 'Withdrawal record not found in database.' });
          return;
        }
        const d = wdSnap.data();
        if (String(d.status || '') !== status) {
          res.status(403).json({ ok: false, sent: false, reason: 'Withdrawal status mismatch.' });
          return;
        }
        authUserId = String(d.userId || authUserId);
        authTxId = String(d.txId || withdrawalId || authTxId);
        authDisplayName = String(d.displayName || authDisplayName);
        authHandle = String(d.handle || authHandle);
        authEggs = Number(d.eggsAmount ?? authEggs);
        authGram = String(d.gramAmount || authGram);
        authUsd = Number(d.usdValue ?? authUsd);
        authWallet = String(d.walletAddress || authWallet);
        authMemo = String(d.memo || authMemo);
      } catch {
        res.status(503).json({
          ok: false,
          sent: false,
          reason: 'Database verification temporarily unavailable.',
        });
        return;
      }
    } else if (status === 'pending' && TELEGRAM_BOT_TOKEN) {
      const verifiedPlayer = resolveVerifiedPlayerActor({
        req,
        token: body.token,
        initData: body.initData,
      });
      if (!verifiedPlayer) {
        res.status(401).json({ ok: false, sent: false, reason: 'Invalid session' });
        return;
      }
    }

    const dedupKey = `${withdrawalId || authWallet}:${status}`;
    const prevWd = withdrawNotifyDedup.get(dedupKey);
    if (prevWd && Date.now() - prevWd < 60_000) {
      res.json({ ok: true, sent: false, channel: TELEGRAM_PAYOUT_CHANNEL, reason: 'Duplicate suppressed' });
      return;
    }
    withdrawNotifyDedup.set(dedupKey, Date.now());
    if (withdrawNotifyDedup.size > 1000) withdrawNotifyDedup.clear();

    const displayName = escapeHtml(authDisplayName);
    const handle = escapeHtml(authHandle);
    const eggsAmount = Math.max(0, Math.floor(authEggs));
    const gramAmount = escapeHtml(authGram);
    const usdValue = Math.max(0, authUsd).toFixed(4);
    const walletAddress = escapeHtml(authWallet);
    const memo = escapeHtml(authMemo);
    const rawAdminNote = String(body.adminNote || '').slice(0, 120);
    const adminNote = escapeHtml(rawAdminNote);

    if (!TELEGRAM_BOT_TOKEN) {
      res.json({
        ok: true,
        sent: false,
        userDmSent: false,
        userDmReason: 'TELEGRAM_BOT_TOKEN not configured on server',
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

    let channelSent = false;
    let channelReason: string | undefined;
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
      channelSent = Boolean(tgData.ok);
      channelReason = tgData.ok ? undefined : redactBotToken(tgData.description || 'Telegram API error');
    } catch (err) {
      channelReason = redactBotToken(err instanceof Error ? err.message : 'Telegram request failed');
    }

    let userDmSent = false;
    let userDmReason: string | undefined;
    const userNumericId = extractTelegramNumericUserId(authUserId);
    if ((status === 'approved' || status === 'rejected') && userNumericId) {
      try {
        let dmPayload: Record<string, unknown>;
        if (status === 'approved') {
          const activeTemplate = await loadWithdrawApproveTemplate();
          const rendered = renderWithdrawApproveMessage({
            template: activeTemplate,
            gramAmount: authGram,
            eggsAmount,
            walletAddress: authWallet,
            usdValue: Math.max(0, authUsd),
            displayName: authDisplayName,
            handle: authHandle,
            txId: authTxId,
            memo: authMemo,
            adminNote: rawAdminNote,
          });
          dmPayload = {
            chat_id: userNumericId,
            text: rendered.htmlText,
            parse_mode: 'HTML',
            ...(rendered.buttonText
              ? {
                  reply_markup: {
                    inline_keyboard: [[{ text: rendered.buttonText, url: rendered.buttonUrl }]],
                  },
                }
              : {}),
          };
        } else {
          const botUsername = await resolveTelegramBotUsername();
          const miniAppUrl = `https://t.me/${botUsername}/${TELEGRAM_MINIAPP_SHORT_NAME}`;
          const rejLines = [
            '❌ <b>Withdrawal Rejected</b>',
            '',
            `Your withdrawal request of <b>${gramAmount} GRAM</b> could not be processed and <b>${eggsAmount.toLocaleString()} Eggs</b> have been refunded to your farm balance.`,
            ...(adminNote ? ['', `💬 <b>Note:</b> ${adminNote}`] : []),
          ];
          dmPayload = {
            chat_id: userNumericId,
            text: rejLines.join('\n'),
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[{ text: '🐔 Open Alpha Gram', url: miniAppUrl }]],
            },
          };
        }

        const dmRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(dmPayload),
          signal: AbortSignal.timeout(7000),
        });
        const dmData = (await dmRes.json()) as { ok?: boolean; error_code?: number; description?: string };
        userDmSent = Boolean(dmData.ok);
        if (!dmData.ok) {
          userDmReason = redactBotToken(dmData.description || 'User DM failed');
          if (dmData.error_code === 403) {
            await markBotSubscriberBlocked(userNumericId, true);
          }
        } else {
          await upsertBotSubscriber({ chatId: userNumericId, source: 'miniapp', isBotBlocked: false });
        }
      } catch (err) {
        userDmReason = redactBotToken(err instanceof Error ? err.message : 'User DM request failed');
      }
    } else if (status === 'approved' || status === 'rejected') {
      userDmReason = 'User does not have a Telegram numeric chat ID';
    }

    res.json({
      ok: true,
      sent: channelSent,
      channel: TELEGRAM_PAYOUT_CHANNEL,
      userDmSent,
      ...(userDmReason ? { userDmReason } : {}),
      ...(channelReason ? { reason: channelReason } : {}),
    });
  });

  const reminderInterval = setInterval(() => {
    void processDueReminders();
  }, 30_000);
  if (typeof reminderInterval.unref === 'function') {
    reminderInterval.unref();
  }

  if (TELEGRAM_BOT_TOKEN) {
    void pollTelegramBotUpdates();
    const botPollInterval = setInterval(() => {
      void pollTelegramBotUpdates();
    }, 20_000);
    if (typeof botPollInterval.unref === 'function') {
      botPollInterval.unref();
    }
  }

  app.all('/api/*', (_req, res) => {
    res.status(404).json({ ok: false, error: 'API route not found' });
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
  recordServerLog(
    'info',
    'server',
    `Alpha Gram server initialized on port ${PORT} (${process.env.NODE_ENV || 'development'})`,
    `botToken=${Boolean(TELEGRAM_BOT_TOKEN)} · firestore=${Boolean(serverDb)}`,
  );
  if (TELEGRAM_BOT_TOKEN) {
    void probeBotHeartbeat(true);
  }
}

startServer();
