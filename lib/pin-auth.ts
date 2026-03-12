import crypto from 'crypto';
import db from '@/lib/db';

type ScryptParams = {
  keyLength: number;
  cost: number;
  blockSize: number;
  parallelization: number;
  maxmem: number;
};

const PIN_SALT_KEY = 'auth_pin_salt_b64';
const PIN_VERIFIER_KEY = 'auth_pin_verifier_b64';
const PIN_PARAMS_KEY = 'auth_pin_scrypt_params_json';

const DEFAULT_SCRYPT_PARAMS: ScryptParams = {
  keyLength: 32,
  cost: 16384,
  blockSize: 8,
  parallelization: 1,
  maxmem: 128 * 1024 * 1024,
};

function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function setSetting(key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value, new Date().toISOString());
}

function deriveKey(pin: string, salt: Buffer, params: ScryptParams): Buffer {
  return crypto.scryptSync(pin, salt, params.keyLength, {
    cost: params.cost,
    blockSize: params.blockSize,
    parallelization: params.parallelization,
    maxmem: params.maxmem,
  });
}

function computeVerifier(derivedKey: Buffer): Buffer {
  return crypto.createHmac('sha256', derivedKey).update('pin-verifier-v1').digest();
}

export function isPinConfigured(): boolean {
  return Boolean(getSetting(PIN_SALT_KEY) && getSetting(PIN_VERIFIER_KEY) && getSetting(PIN_PARAMS_KEY));
}

export function setPin(pin: string): void {
  if (!/^\d{6}$/.test(pin)) {
    throw new Error('PIN must be exactly 6 digits');
  }

  const salt = crypto.randomBytes(16);
  const params = DEFAULT_SCRYPT_PARAMS;
  const derivedKey = deriveKey(pin, salt, params);
  const verifier = computeVerifier(derivedKey);

  setSetting(PIN_SALT_KEY, salt.toString('base64'));
  setSetting(PIN_VERIFIER_KEY, verifier.toString('base64'));
  setSetting(PIN_PARAMS_KEY, JSON.stringify(params));
}

export function verifyPin(pin: string): boolean {
  if (!/^\d{6}$/.test(pin)) return false;

  const saltB64 = getSetting(PIN_SALT_KEY);
  const verifierB64 = getSetting(PIN_VERIFIER_KEY);
  const paramsJson = getSetting(PIN_PARAMS_KEY);
  if (!saltB64 || !verifierB64 || !paramsJson) return false;

  let params: ScryptParams;
  try {
    params = JSON.parse(paramsJson) as ScryptParams;
  } catch {
    return false;
  }

  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(verifierB64, 'base64');

  const derivedKey = deriveKey(pin, salt, params);
  const actual = computeVerifier(derivedKey);

  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}
