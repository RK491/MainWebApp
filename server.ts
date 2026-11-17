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
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import {
  ADMIN_PASSCODE_VAULT_UID,
  buildReferralBotNotificationMessage,
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
  normalizeTelegramChannelHandle,
  PRIMARY_ADMIN_TELEGRAM_ID,
  PROMO_CODES,
  REFERRER_SIGNUP_BONUS_COINS,
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

function isSafePublicHttpsUrl(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 512) return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    const host = parsed.hostname.toLowerCase();
    if (!host || !host.includes('.')) return false;
    if (
      host === 'localhost' ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host.endsWith('.localhost') ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.startsWith('127.') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.startsWith('169.254.') ||
      host.startsWith('[fc') ||
      host.startsWith('[fd') ||
      host.startsWith('[fe80')
    ) {
      return false;
    }
    const m172 = host.match(/^172\.(\d+)\./);
    if (m172) {
      const oct2 = Number(m172[1]);
      if (oct2 >= 16 && oct2 <= 31) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function getClientIp(req: express.Request): string {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0]?.trim();
  if (fwd) return fwd.slice(0, 64);
  return String(req.socket?.remoteAddress || 'unknown').slice(0, 64);
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
const TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '')
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
// ADMIN PASSCODE CONFIGURATION & PERSISTENT STORAGE
// Passcode checks:
// 1. Custom passcode hash saved in Firestore (`app_config/admin_security`) or `.data/admin_security.json`
// 2. Fallback to `process.env.ADMIN_PASSCODE` or `DEFAULT_ADMIN_PASSCODE` ('750891')
// ============================================================================
export const DEFAULT_ADMIN_PASSCODE = '750891';
const ENV_ADMIN_PASSCODE = (process.env.ADMIN_PASSCODE || '').trim();
const FALLBACK_ADMIN_PASSCODE = ENV_ADMIN_PASSCODE || DEFAULT_ADMIN_PASSCODE;
const ADMIN_SECURITY_FILE = path.resolve(__dirname, '.data', 'admin_security.json');

interface StoredAdminSecurityRecord {
  passcodeHash: string;
  updatedBy: string;
  updatedAtMs: number;
  source: 'database' | 'server_file';
}

let cachedCustomAdminSecurity: StoredAdminSecurityRecord | null | undefined = undefined;
let localFilePersistFailed = false;
let dbSeedAttempted = false;

function hashAdminPasscode(rawPasscode: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(rawPasscode.trim(), salt, 32).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function hashCompactAdminPasscode(rawPasscode: string): {
  saltB64: string;
  hashB64: string;
  combined: string;
} {
  const saltB64 = crypto.randomBytes(16).toString('base64url');
  const hashB64 = crypto.scryptSync(rawPasscode.trim(), saltB64, 32).toString('base64url');
  return {
    saltB64,
    hashB64,
    combined: `s1$${saltB64}$${hashB64}`,
  };
}

function verifyScryptPasscode(provided: string, storedHash: string): boolean {
  const parts = storedHash.split('$');
  if (parts.length !== 3) return false;
  const [scheme, salt, expectedEncoded] = parts;
  if (!salt || !expectedEncoded) return false;
  try {
    const derived = crypto.scryptSync(provided.trim(), salt, 32);
    if (scheme === 'scrypt') {
      const expected = Buffer.from(expectedEncoded, 'hex');
      return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
    }
    if (scheme === 's1') {
      const expected = Buffer.from(expectedEncoded, 'base64url');
      return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
    }
    return false;
  } catch {
    return false;
  }
}

function extractPasscodeRecordFromAdminsDoc(
  d: Record<string, unknown> | undefined,
): StoredAdminSecurityRecord | null {
  if (!d || !Array.isArray(d.admins)) return null;
  for (const item of d.admins) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    if (String(rec.uid || '') !== ADMIN_PASSCODE_VAULT_UID) continue;
    const dn = String(rec.displayName || '').trim();
    const h = String(rec.handle || '').trim();
    if (dn.startsWith('s1$') && h.startsWith('salt$')) {
      const hashB64 = dn.slice(3);
      const saltB64 = h.slice(5);
      if (hashB64.length >= 20 && saltB64.length >= 12) {
        return {
          passcodeHash: `s1$${saltB64}$${hashB64}`,
          updatedBy: String(rec.addedBy || PRIMARY_ADMIN_TELEGRAM_ID),
          updatedAtMs: Number(rec.addedAtMs || d.updatedAtMs || 0),
          source: 'database',
        };
      }
    }
  }
  return null;
}

function readLocalAdminSecurityFile(): StoredAdminSecurityRecord | null {
  try {
    if (!fs.existsSync(ADMIN_SECURITY_FILE)) return null;
    const raw = fs.readFileSync(ADMIN_SECURITY_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<StoredAdminSecurityRecord>;
    if (
      typeof parsed.passcodeHash === 'string' &&
      (parsed.passcodeHash.startsWith('scrypt$') || parsed.passcodeHash.startsWith('s1$'))
    ) {
      return {
        passcodeHash: parsed.passcodeHash,
        updatedBy: String(parsed.updatedBy || PRIMARY_ADMIN_TELEGRAM_ID),
        updatedAtMs: Number(parsed.updatedAtMs || 0),
        source: 'server_file',
      };
    }
  } catch {
    // Ignore local file errors
  }
  return null;
}

function writeLocalAdminSecurityFile(record: Omit<StoredAdminSecurityRecord, 'source'>): boolean {
  try {
    const dir = path.dirname(ADMIN_SECURITY_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(
      ADMIN_SECURITY_FILE,
      JSON.stringify(
        {
          passcodeHash: record.passcodeHash,
          updatedBy: record.updatedBy,
          updatedAtMs: record.updatedAtMs,
        },
        null,
        2,
      ),
      'utf8',
    );
    return true;
  } catch {
    // Ignore filesystem errors on read-only containers
    return false;
  }
}

async function getFreshDoc(ref: DocumentReference<DocumentData>): Promise<DocumentSnapshot<DocumentData>> {
  try {
    return await getDocFromServer(ref);
  } catch {
    return getDoc(ref);
  }
}

async function writePasscodeToFirestore(params: {
  compactSaltB64: string;
  compactHashB64: string;
  scryptHexHash: string;
  canonicalActor: string;
  nowMs: number;
}): Promise<boolean> {
  if (!serverDb) return false;
  let savedToAdmins = false;
  let savedToSecurity = false;

  try {
    const adminsRef = doc(serverDb, 'app_config', 'admins');
    const snap = await getFreshDoc(adminsRef);
    const existingData = snap.exists() ? (snap.data() as Record<string, unknown>) : {};
    const rawAdmins = Array.isArray(existingData.admins) ? existingData.admins : [];
    const realAdmins = rawAdmins
      .filter(
        (item): item is Record<string, unknown> =>
          Boolean(
            item &&
              typeof item === 'object' &&
              String((item as Record<string, unknown>).uid || '') !== ADMIN_PASSCODE_VAULT_UID,
          ),
      )
      .slice(0, 29);

    const existingAdminIds = Array.isArray(existingData.adminIds)
      ? existingData.adminIds
          .map((id) => String(id || '').trim())
          .filter((id) => Boolean(id) && id !== ADMIN_PASSCODE_VAULT_UID)
          .slice(0, 30)
      : [];

    const vaultEntry = {
      uid: ADMIN_PASSCODE_VAULT_UID,
      displayName: `s1$${params.compactHashB64}`.slice(0, 60),
      handle: `salt$${params.compactSaltB64}`.slice(0, 40),
      addedBy: params.canonicalActor,
      addedAtMs: params.nowMs,
    };

    await setDoc(adminsRef, {
      adminIds: existingAdminIds,
      admins: [...realAdmins, vaultEntry],
      updatedAtMs: params.nowMs,
      updatedAt: serverTimestamp(),
    });
    savedToAdmins = true;
  } catch {
    savedToAdmins = false;
  }

  try {
    await setDoc(doc(serverDb, 'app_config', 'admin_security'), {
      passcodeHash: params.scryptHexHash,
      updatedBy: params.canonicalActor,
      updatedAtMs: params.nowMs,
      updatedAt: serverTimestamp(),
    });
    savedToSecurity = true;
  } catch {
    savedToSecurity = false;
  }

  return savedToAdmins || savedToSecurity;
}

async function ensureAdminPasscodeSeededInDatabase(): Promise<StoredAdminSecurityRecord | null> {
  if (!serverDb || dbSeedAttempted) return null;
  dbSeedAttempted = true;
  try {
    const [secSnap, adminsSnap] = await Promise.all([
      getFreshDoc(doc(serverDb, 'app_config', 'admin_security')).catch(() => null),
      getFreshDoc(doc(serverDb, 'app_config', 'admins')).catch(() => null),
    ]);
    if (secSnap?.exists() && typeof secSnap.data().passcodeHash === 'string') {
      return null;
    }
    if (adminsSnap?.exists() && extractPasscodeRecordFromAdminsDoc(adminsSnap.data())) {
      return null;
    }
    const nowMs = Date.now();
    const compact = hashCompactAdminPasscode(FALLBACK_ADMIN_PASSCODE);
    const scryptHex = hashAdminPasscode(FALLBACK_ADMIN_PASSCODE);
    const ok = await writePasscodeToFirestore({
      compactSaltB64: compact.saltB64,
      compactHashB64: compact.hashB64,
      scryptHexHash: scryptHex,
      canonicalActor: `tg_${PRIMARY_ADMIN_TELEGRAM_ID}`,
      nowMs,
    });
    if (ok) {
      const seeded: StoredAdminSecurityRecord = {
        passcodeHash: compact.combined,
        updatedBy: `tg_${PRIMARY_ADMIN_TELEGRAM_ID}`,
        updatedAtMs: nowMs,
        source: 'database',
      };
      cachedCustomAdminSecurity = seeded;
      return seeded;
    }
  } catch {
    // Non-fatal seed failure
  }
  return null;
}

async function loadActiveAdminSecurity(): Promise<{
  custom: StoredAdminSecurityRecord | null;
  source: 'database' | 'server_file' | 'env' | 'default';
  updatedAtMs: number;
}> {
  if (serverDb) {
    try {
      const snap = await getFreshDoc(doc(serverDb, 'app_config', 'admin_security'));
      if (snap.exists()) {
        const d = snap.data();
        if (
          typeof d.passcodeHash === 'string' &&
          (d.passcodeHash.startsWith('scrypt$') || d.passcodeHash.startsWith('s1$'))
        ) {
          const rec: StoredAdminSecurityRecord = {
            passcodeHash: d.passcodeHash,
            updatedBy: String(d.updatedBy || PRIMARY_ADMIN_TELEGRAM_ID),
            updatedAtMs: Number(d.updatedAtMs || 0),
            source: 'database',
          };
          cachedCustomAdminSecurity = rec;
          return { custom: rec, source: 'database', updatedAtMs: rec.updatedAtMs };
        }
      }
    } catch {
      // Fall through to app_config/admins vault
    }

    try {
      const adminsSnap = await getFreshDoc(doc(serverDb, 'app_config', 'admins'));
      if (adminsSnap.exists()) {
        const vaultRec = extractPasscodeRecordFromAdminsDoc(adminsSnap.data());
        if (vaultRec) {
          cachedCustomAdminSecurity = vaultRec;
          return { custom: vaultRec, source: 'database', updatedAtMs: vaultRec.updatedAtMs };
        }
      }
    } catch {
      // Fall through
    }

    const seeded = await ensureAdminPasscodeSeededInDatabase();
    if (seeded) {
      return { custom: seeded, source: 'database', updatedAtMs: seeded.updatedAtMs };
    }
  }

  const localRec = readLocalAdminSecurityFile();
  if (localRec) {
    cachedCustomAdminSecurity = localRec;
    return { custom: localRec, source: 'server_file', updatedAtMs: localRec.updatedAtMs };
  }

  if (localFilePersistFailed && cachedCustomAdminSecurity) {
    return {
      custom: cachedCustomAdminSecurity,
      source: cachedCustomAdminSecurity.source,
      updatedAtMs: cachedCustomAdminSecurity.updatedAtMs,
    };
  }

  return {
    custom: null,
    source: ENV_ADMIN_PASSCODE ? 'env' : 'default',
    updatedAtMs: 0,
  };
}

async function saveNewAdminPasscode(
  newPasscode: string,
  updatedBy: string,
): Promise<{ source: 'database' | 'server_file'; updatedAtMs: number }> {
  const nowMs = Date.now();
  const compact = hashCompactAdminPasscode(newPasscode);
  const scryptHex = hashAdminPasscode(newPasscode);
  const canonicalActor =
    String(updatedBy || `tg_${PRIMARY_ADMIN_TELEGRAM_ID}`)
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 64) || `tg_${PRIMARY_ADMIN_TELEGRAM_ID}`;

  const wroteLocal = writeLocalAdminSecurityFile({
    passcodeHash: compact.combined,
    updatedBy: canonicalActor,
    updatedAtMs: nowMs,
  });
  localFilePersistFailed = !wroteLocal;

  const savedToFirestore = await writePasscodeToFirestore({
    compactSaltB64: compact.saltB64,
    compactHashB64: compact.hashB64,
    scryptHexHash: scryptHex,
    canonicalActor,
    nowMs,
  });

  const source: 'database' | 'server_file' = savedToFirestore ? 'database' : 'server_file';
  cachedCustomAdminSecurity = {
    passcodeHash: compact.combined,
    updatedBy: canonicalActor,
    updatedAtMs: nowMs,
    source,
  };
  return { source, updatedAtMs: nowMs };
}

async function verifyAdminPasscodeAsync(provided: string): Promise<{
  ok: boolean;
  source: 'database' | 'server_file' | 'env' | 'default';
  updatedAtMs: number;
}> {
  const cleanProvided = provided.trim();
  const security = await loadActiveAdminSecurity();
  if (!cleanProvided) {
    return { ok: false, source: security.source, updatedAtMs: security.updatedAtMs };
  }
  if (security.custom) {
    return {
      ok: verifyScryptPasscode(cleanProvided, security.custom.passcodeHash),
      source: security.source,
      updatedAtMs: security.updatedAtMs,
    };
  }
  const a = Buffer.from(cleanProvided, 'utf8');
  const b = Buffer.from(FALLBACK_ADMIN_PASSCODE, 'utf8');
  return {
    ok: a.length === b.length && crypto.timingSafeEqual(a, b),
    source: security.source,
    updatedAtMs: security.updatedAtMs,
  };
}

const SESSION_SECRET_FILE = path.resolve(__dirname, '.data', 'session_secret.key');

function resolveSessionSigningSecret(): string {
  const envSecret = (process.env.SESSION_SECRET || '').trim();
  if (envSecret.length >= 32) {
    return envSecret;
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
  const nowSec = Math.floor(Date.now() / 1000);
  if (
    !Number.isFinite(authDateSec) ||
    authDateSec <= 0 ||
    nowSec - authDateSec > 86_400 ||
    authDateSec > nowSec + 300
  ) {
    return { valid: false, reason: 'expired_or_invalid_auth_date' };
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
    const verifiedInit = verifyTelegramInitData(rawInitData, TELEGRAM_BOT_TOKEN);
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
    const snap = await getFreshDoc(doc(serverDb, 'app_config', 'channels'));
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

async function fetchTelegramChatMember(chatId: string, userId: string): Promise<{
  ok: boolean;
  description?: string;
  result?: { status?: string; is_member?: boolean };
}> {
  const tryLookup = async (targetChatId: string) => {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getChatMember?chat_id=${encodeURIComponent(
      targetChatId,
    )}&user_id=${encodeURIComponent(userId)}`;
    const tgRes = await fetch(url, { signal: AbortSignal.timeout(7000) });
    return (await tgRes.json()) as {
      ok?: boolean;
      description?: string;
      result?: { status?: string; is_member?: boolean };
    };
  };

  const normalizedHandle = normalizeTelegramChannelHandle(chatId).handle || chatId.trim();
  const primary = await tryLookup(normalizedHandle);
  if (primary.ok && primary.result) {
    return { ok: true, result: primary.result };
  }

  // Retry with -100 prefix if admin saved positive numeric channel ID without -100
  if (
    /^\d{6,16}$/.test(normalizedHandle) &&
    String(primary.description || '').toLowerCase().includes('chat not found')
  ) {
    const retried = await tryLookup(`-100${normalizedHandle}`);
    if (retried.ok && retried.result) {
      return { ok: true, result: retried.result };
    }
    return {
      ok: false,
      description: retried.description || primary.description,
    };
  }

  return {
    ok: false,
    description: primary.description,
  };
}

const referralNotifyDedup = new Map<string, number>();
const withdrawNotifyDedup = new Map<string, number>();

async function collectBroadcastRecipients(excludeBanned: boolean): Promise<string[]> {
  if (!serverDb) return [];
  const uniqueChatIds = new Set<string>();
  const bannedSet = new Set<string>();

  if (excludeBanned) {
    try {
      const banSnap = await getDocs(query(collection(serverDb, 'banned_users'), limit(100)));
      for (const d of banSnap.docs) {
        const uid = String(d.data()?.uid || d.id || '').trim();
        const num = extractTelegramNumericUserId(uid);
        if (num) bannedSet.add(num);
      }
    } catch {
      // Non-fatal
    }
  }

  try {
    let lastDoc: QueryDocumentSnapshot<DocumentData> | null = null;
    for (let page = 0; page < 40; page += 1) {
      const q = lastDoc
        ? query(collection(serverDb, 'players'), orderBy('createdAtMs', 'asc'), startAfter(lastDoc), limit(50))
        : query(collection(serverDb, 'players'), orderBy('createdAtMs', 'asc'), limit(50));
      const snap = await getDocs(q);
      if (snap.empty) break;
      for (const docSnap of snap.docs) {
        const uid = String(docSnap.data()?.uid || docSnap.id || '').trim();
        const tgId = extractTelegramNumericUserId(uid);
        if (tgId && !bannedSet.has(tgId)) {
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
    const lbSnap = await getDocs(query(collection(serverDb, 'leaderboard'), orderBy('buyerPoints', 'desc'), limit(50)));
    for (const d of lbSnap.docs) {
      const tgId = extractTelegramNumericUserId(String(d.data()?.uid || d.id || ''));
      if (tgId && !bannedSet.has(tgId)) {
        uniqueChatIds.add(tgId);
      }
    }
  } catch {
    // Non-fatal
  }

  return Array.from(uniqueChatIds);
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
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
    const rl = checkRateLimit(`chk_ch:${ip}`, 45, 60_000);
    if (!rl.allowed) {
      res.status(429).json({ ok: false, error: `Too many requests. Retry in ${rl.retryAfterSec}s.` });
      return;
    }
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
          const tgData = await fetchTelegramChatMember(ch.handle, numericUserId!);

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
      res.json({
        ok: true,
        botConfigured: false,
        botUsername: null,
        botError: 'TELEGRAM_BOT_TOKEN is not set in server environment variables.',
        channels: targetChannels.map((ch) => ({
          id: ch.id,
          handle: ch.handle,
          botIsAdmin: false,
          botStatus: 'bot_unconfigured',
          error: 'TELEGRAM_BOT_TOKEN not configured on server',
        })),
      });
      return;
    }

    try {
      const meRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`, {
        signal: AbortSignal.timeout(6000),
      });
      const meData = (await meRes.json()) as {
        ok?: boolean;
        description?: string;
        result?: { id?: number | string; username?: string };
      };
      if (!meData.ok || !meData.result?.id) {
        res.json({
          ok: true,
          botConfigured: true,
          botUsername: null,
          botError: meData.description || 'Invalid TELEGRAM_BOT_TOKEN (getMe failed)',
          channels: targetChannels.map((ch) => ({
            id: ch.id,
            handle: ch.handle,
            botIsAdmin: false,
            botStatus: 'token_invalid',
            error: meData.description || 'Bot token rejected by Telegram',
          })),
        });
        return;
      }

      const botId = String(meData.result.id);
      const botUsername = meData.result.username || '';
      const adminNumericId = extractTelegramNumericUserId(resolvedPlayerId);

      const results = await Promise.all(
        targetChannels.map(async (ch) => {
          try {
            const botMember = await fetchTelegramChatMember(ch.handle, botId);
            if (!botMember.ok || !botMember.result) {
              return {
                id: ch.id,
                handle: ch.handle,
                botIsAdmin: false,
                botStatus: 'api_error',
                error: botMember.description || 'Could not inspect bot status in channel',
              };
            }
            const botStatus = String(botMember.result.status || 'left').toLowerCase();
            const botIsAdmin = botStatus === 'administrator' || botStatus === 'creator';
            let userJoined: boolean | null = null;
            let userStatus: string | null = null;
            if (adminNumericId) {
              const adminCheck = await fetchTelegramChatMember(ch.handle, adminNumericId);
              if (adminCheck.ok && adminCheck.result) {
                userStatus = String(adminCheck.result.status || 'left');
                userJoined = isTelegramMemberStatusJoined(userStatus, adminCheck.result.is_member);
              }
            }
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
            return {
              id: ch.id,
              handle: ch.handle,
              botIsAdmin: false,
              botStatus: 'network_error',
              error: err instanceof Error ? err.message : 'Telegram API timeout',
            };
          }
        }),
      );

      res.json({
        ok: true,
        botConfigured: true,
        botUsername,
        channels: results,
      });
    } catch (err) {
      res.json({
        ok: true,
        botConfigured: true,
        botUsername: null,
        botError: err instanceof Error ? err.message : 'Failed to connect to Telegram API',
        channels: [],
      });
    }
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

    const rl = checkRateLimit(`admin_auth:${ip}`, 8, 15 * 60_000);
    if (!rl.allowed) {
      res.status(429).json({
        ok: false,
        requiresPasscode: true,
        error: `Too many login attempts. Wait ${rl.retryAfterSec}s before trying again.`,
      });
      return;
    }

    let resolvedPlayerId = rawPlayerId;
    if (rawInitData && TELEGRAM_BOT_TOKEN) {
      const verifiedInit = verifyTelegramInitData(rawInitData, TELEGRAM_BOT_TOKEN);
      if (!verifiedInit.valid || !verifiedInit.playerId) {
        res.status(401).json({
          ok: false,
          error: 'Invalid or expired Telegram session signature.',
        });
        return;
      }
      resolvedPlayerId = verifiedInit.playerId;
    }

    if (!isValidSafeId(resolvedPlayerId) || !isAdminPlayerId(resolvedPlayerId, effectiveExtraAdmins)) {
      res.status(403).json({
        ok: false,
        error: `Restricted to authorized Admin IDs (Primary: ${PRIMARY_ADMIN_TELEGRAM_ID}).`,
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

    const authResult = await verifyAdminPasscodeAsync(rawPasscode);
    if (!authResult.ok) {
      res.status(403).json({
        ok: false,
        requiresPasscode: true,
        passcodeSource: authResult.source,
        error: 'Incorrect Admin Passcode. Please check and try again.',
      });
      return;
    }

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

  app.post('/api/admin/change-passcode', async (req, res) => {
    const ip = getClientIp(req);
    const rl = checkRateLimit(`admin_chpass:${ip}`, 6, 15 * 60_000);
    if (!rl.allowed) {
      res.status(429).json({
        ok: false,
        error: `Too many passcode change attempts. Wait ${rl.retryAfterSec}s.`,
      });
      return;
    }

    const body = req.body as {
      initData?: string;
      token?: string;
      currentPasscode?: string;
      newPasscode?: string;
    };
    const currentPasscode = String(body.currentPasscode || '').trim();
    const newPasscode = String(body.newPasscode || '').trim();

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
        error: 'Verified Admin session required to update Admin Passcode.',
      });
      return;
    }

    if (!currentPasscode) {
      res.status(400).json({
        ok: false,
        error: 'Enter your current Admin Passcode.',
      });
      return;
    }

    if (newPasscode.length < 4 || newPasscode.length > 64) {
      res.status(400).json({
        ok: false,
        error: 'New passcode must be between 4 and 64 characters.',
      });
      return;
    }

    const verifyCurrent = await verifyAdminPasscodeAsync(currentPasscode);
    if (!verifyCurrent.ok) {
      res.status(403).json({
        ok: false,
        error: 'Current Admin Passcode is incorrect.',
      });
      return;
    }

    const saved = await saveNewAdminPasscode(newPasscode, resolvedPlayerId);
    const freshToken = signSessionToken({
      role: 'admin',
      playerId: resolvedPlayerId,
      method: 'passcode',
    });

    res.json({
      ok: true,
      token: freshToken,
      passcodeSource: saved.source,
      passcodeUpdatedAtMs: saved.updatedAtMs,
    });
  });

  app.post('/api/admin/broadcast', async (req, res) => {
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
    if (mediaType !== 'none' && !isSafePublicHttpsUrl(mediaUrl)) {
      res.status(400).json({
        ok: false,
        error: 'Enter a valid public HTTPS media URL (http:// or local network URLs are blocked).',
      });
      return;
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
          : 'No Telegram user chat IDs found in database yet.',
      });
      return;
    }

    let sentCount = 0;
    let failedCount = 0;
    let blockedCount = 0;
    let sampleError = '';

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

    for (const chatId of targetChatIds) {
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
              [mediaField]: mediaUrl,
              caption: formattedText,
              parse_mode: 'HTML',
              reply_markup: replyMarkup,
            };

      try {
        let tgRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(8000),
        });
        let tgData = (await tgRes.json()) as {
          ok?: boolean;
          error_code?: number;
          description?: string;
          parameters?: { retry_after?: number };
        };

        if (tgData.error_code === 429 && tgData.parameters?.retry_after) {
          const waitMs = Math.min(5000, Math.max(500, tgData.parameters.retry_after * 1000));
          await new Promise((r) => setTimeout(r, waitMs));
          tgRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(8000),
          });
          tgData = (await tgRes.json()) as typeof tgData;
        }

        if (tgData.ok) {
          sentCount += 1;
        } else {
          failedCount += 1;
          const desc = String(tgData.description || '');
          if (desc.toLowerCase().includes('blocked') || desc.toLowerCase().includes('chat not found')) {
            blockedCount += 1;
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
      enabled?: boolean;
      basketFullAtMs?: number;
      feedBoostUntilMs?: number;
      coopFeverUntilMs?: number;
      autoHarvestUntilMs?: number;
    };

    let playerId = String(body.playerId || '').trim();
    const rawInitData = String(body.initData || '').trim();
    if (rawInitData && TELEGRAM_BOT_TOKEN) {
      const check = verifyTelegramInitData(rawInitData, TELEGRAM_BOT_TOKEN);
      if (!check.valid || !check.playerId) {
        res.status(401).json({ ok: false, error: 'Invalid Telegram session.' });
        return;
      }
      playerId = check.playerId;
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

    const prev = reminderStore.get(playerId);
    const clampMs = (v: unknown) => {
      const n = Math.floor(Number(v) || 0);
      return Number.isFinite(n) && n > 0 ? n : 0;
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
    };

    const referrerUid = String(body.referrerUid || '').trim();
    const referredUid = String(body.referredUid || '').trim();
    const numericReferrerId = extractTelegramNumericUserId(referrerUid);
    const event = body.event === 'deposit_commission' ? 'deposit_commission' : 'referral_joined';
    const rewardCoins = Math.min(
      10_000,
      Math.max(0, Math.round(Number(body.rewardCoins ?? (event === 'referral_joined' ? REFERRER_SIGNUP_BONUS_COINS : 0)))),
    );

    if (!isValidSafeId(referrerUid) || !numericReferrerId) {
      res.json({
        ok: true,
        sent: false,
        reason: 'Referrer does not have a Telegram numeric chat ID',
      });
      return;
    }

    if (serverDb && isValidSafeId(referredUid)) {
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
        // Proceed if Firestore offline check is inconclusive
      }
    } else if (body.initData && TELEGRAM_BOT_TOKEN) {
      const check = verifyTelegramInitData(String(body.initData), TELEGRAM_BOT_TOKEN);
      if (!check.valid) {
        res.status(401).json({ ok: false, sent: false, reason: 'Invalid session' });
        return;
      }
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

    let authDisplayName = String(body.displayName || 'Farmer').slice(0, 60);
    let authHandle = String(body.handle || '@farmer').slice(0, 40);
    let authEggs = Number(body.eggsAmount || 0);
    let authGram = String(body.gramAmount || '0');
    let authUsd = Number(body.usdValue || 0);
    let authWallet = String(body.walletAddress || '').slice(0, 128);
    let authMemo = String(body.memo || '').slice(0, 64);

    if (serverDb && isValidSafeId(withdrawalId)) {
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
        authDisplayName = String(d.displayName || authDisplayName);
        authHandle = String(d.handle || authHandle);
        authEggs = Number(d.eggsAmount ?? authEggs);
        authGram = String(d.gramAmount || authGram);
        authUsd = Number(d.usdValue ?? authUsd);
        authWallet = String(d.walletAddress || authWallet);
        authMemo = String(d.memo || authMemo);
      } catch {
        // Fallback when Firestore offline check fails
      }
    } else if (status === 'pending' && body.initData && TELEGRAM_BOT_TOKEN) {
      const check = verifyTelegramInitData(String(body.initData), TELEGRAM_BOT_TOKEN);
      if (!check.valid) {
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
    const adminNote = escapeHtml(String(body.adminNote || '').slice(0, 120));

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
        reason: tgData.ok ? undefined : redactBotToken(tgData.description || 'Telegram API error'),
      });
    } catch (err) {
      res.json({
        ok: true,
        sent: false,
        channel: TELEGRAM_PAYOUT_CHANNEL,
        reason: redactBotToken(err instanceof Error ? err.message : 'Telegram request failed'),
      });
    }
  });

  void ensureAdminPasscodeSeededInDatabase();
  const reminderInterval = setInterval(() => {
    void processDueReminders();
  }, 30_000);
  if (typeof reminderInterval.unref === 'function') {
    reminderInterval.unref();
  }

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
