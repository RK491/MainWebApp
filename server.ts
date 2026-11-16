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
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
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

const SESSION_SIGNING_SECRET = crypto
  .createHash('sha256')
  .update(`chickenland_session_v2:${PRIMARY_ADMIN_TELEGRAM_ID}:${TELEGRAM_BOT_TOKEN}:${FALLBACK_ADMIN_PASSCODE}`)
  .digest('hex');

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

async function startServer() {
  const app = express();
  app.use(express.json());

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
    const body = req.body as {
      playerId?: string;
      initData?: string;
      token?: string;
      requiredChannels?: Array<Partial<RequiredTelegramChannel>>;
    };
    const rawPlayerId = String(body.playerId || '').trim();
    const rawInitData = String(body.initData || '').trim();
    const authHeader = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    const candidateToken = String(body.token || authHeader || '').trim();

    const firestoreAdminIds = await loadExtraAdminIdsFromFirestore();
    const effectiveExtraAdmins = [...ADMIN_TELEGRAM_IDS, ...firestoreAdminIds];

    let resolvedPlayerId = rawPlayerId;
    if (candidateToken) {
      const verified = verifySessionToken(candidateToken);
      if (verified?.role === 'admin' && typeof verified.playerId === 'string') {
        resolvedPlayerId = verified.playerId;
      }
    }
    if (rawInitData && TELEGRAM_BOT_TOKEN) {
      const verifiedInit = verifyTelegramInitData(rawInitData, TELEGRAM_BOT_TOKEN);
      if (verifiedInit.valid && verifiedInit.playerId) {
        resolvedPlayerId = verifiedInit.playerId;
      }
    }

    if (!isAdminPlayerId(resolvedPlayerId, effectiveExtraAdmins)) {
      res.status(403).json({
        ok: false,
        error: 'Restricted to authorized Admin IDs.',
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

    let resolvedPlayerId = rawPlayerId;
    if (rawInitData && TELEGRAM_BOT_TOKEN) {
      const verifiedInit = verifyTelegramInitData(rawInitData, TELEGRAM_BOT_TOKEN);
      if (verifiedInit.valid && verifiedInit.playerId) {
        resolvedPlayerId = verifiedInit.playerId;
      }
    }

    if (!isAdminPlayerId(resolvedPlayerId, effectiveExtraAdmins)) {
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
    const body = req.body as {
      playerId?: string;
      initData?: string;
      token?: string;
      currentPasscode?: string;
      newPasscode?: string;
    };
    const rawPlayerId = String(body.playerId || '').trim();
    const rawInitData = String(body.initData || '').trim();
    const authHeader = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    const candidateToken = String(body.token || authHeader || '').trim();
    const currentPasscode = String(body.currentPasscode || '').trim();
    const newPasscode = String(body.newPasscode || '').trim();

    const firestoreAdminIds = await loadExtraAdminIdsFromFirestore();
    const effectiveExtraAdmins = [...ADMIN_TELEGRAM_IDS, ...firestoreAdminIds];

    let resolvedPlayerId = rawPlayerId;
    if (candidateToken) {
      const verified = verifySessionToken(candidateToken);
      if (verified?.role === 'admin' && typeof verified.playerId === 'string') {
        resolvedPlayerId = verified.playerId;
      }
    }
    if (rawInitData && TELEGRAM_BOT_TOKEN) {
      const verifiedInit = verifyTelegramInitData(rawInitData, TELEGRAM_BOT_TOKEN);
      if (verifiedInit.valid && verifiedInit.playerId) {
        resolvedPlayerId = verifiedInit.playerId;
      }
    }

    if (!isAdminPlayerId(resolvedPlayerId, effectiveExtraAdmins)) {
      res.status(403).json({
        ok: false,
        error: 'Restricted to authorized Admin IDs.',
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

  app.post('/api/referrals/notify', async (req, res) => {
    const body = req.body as {
      event?: 'referral_joined' | 'deposit_commission';
      referrerUid?: string;
      referredName?: string;
      referredHandle?: string;
      rewardCoins?: number;
      depositGram?: string;
      depositUsd?: number;
    };

    const referrerUid = String(body.referrerUid || '').trim();
    const numericReferrerId = extractTelegramNumericUserId(referrerUid);
    const event = body.event === 'deposit_commission' ? 'deposit_commission' : 'referral_joined';
    const rewardCoins = Math.max(
      0,
      Math.round(Number(body.rewardCoins ?? (event === 'referral_joined' ? REFERRER_SIGNUP_BONUS_COINS : 0))),
    );

    if (!numericReferrerId) {
      res.json({
        ok: true,
        sent: false,
        reason: 'Referrer does not have a Telegram numeric chat ID',
      });
      return;
    }

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
        reason: tgData.ok ? undefined : tgData.description || 'Telegram API error',
      });
    } catch (err) {
      res.json({
        ok: true,
        sent: false,
        reason: err instanceof Error ? err.message : 'Telegram request failed',
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

  void ensureAdminPasscodeSeededInDatabase();

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
