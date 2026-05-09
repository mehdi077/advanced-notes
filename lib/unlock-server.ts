import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getPinTokenSecretMaterial } from '@/lib/pin-auth';

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const TOKEN_VERSION = 1;

type UnlockTokenPayload = {
  v: number;
  exp: number;
};

function getSigningSecret(): string | null {
  const pinSecret = getPinTokenSecretMaterial();
  if (!pinSecret) return null;
  return `advanced-notes-unlock-token-v1:${pinSecret}`;
}

function sign(payloadB64: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

export function issueUnlockToken(): string {
  const secret = getSigningSecret();
  if (!secret) throw new Error('PIN is not configured');

  const payload: UnlockTokenPayload = {
    v: TOKEN_VERSION,
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

export function clearAllUnlockTokens() {
  // Stateless tokens are invalidated by changing the PIN verifier, which changes
  // the signing secret. This function remains for the PIN reset flow.
}

export function isValidUnlockToken(token: string | null | undefined): boolean {
  if (!token) return false;
  const secret = getSigningSecret();
  if (!secret) return false;

  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const [payloadB64, signature] = parts;
  if (!payloadB64 || !signature) return false;

  const expectedSignature = sign(payloadB64, secret);
  const actual = Buffer.from(signature, 'utf8');
  const expected = Buffer.from(expectedSignature, 'utf8');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    return false;
  }

  let payload: UnlockTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as UnlockTokenPayload;
  } catch {
    return false;
  }

  return payload.v === TOKEN_VERSION && Number.isFinite(payload.exp) && payload.exp > Date.now();
}

export function requireUnlocked(request: Request): NextResponse | null {
  const token = request.headers.get('x-an-unlock');
  if (!isValidUnlockToken(token)) {
    return NextResponse.json({ error: 'Locked' }, { status: 401 });
  }
  return null;
}
