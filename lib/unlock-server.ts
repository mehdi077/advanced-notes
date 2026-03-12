import { NextResponse } from 'next/server';
import crypto from 'crypto';

type TokenEntry = { expiresAtMs: number };

const TOKEN_TTL_MS = 1000 * 60 * 30; // 30 minutes

function getTokenStore(): Map<string, TokenEntry> {
  const g = globalThis as unknown as { __anUnlockTokens?: Map<string, TokenEntry> };
  if (!g.__anUnlockTokens) g.__anUnlockTokens = new Map();
  return g.__anUnlockTokens;
}

function cleanup(store: Map<string, TokenEntry>) {
  const now = Date.now();
  for (const [token, entry] of store.entries()) {
    if (entry.expiresAtMs <= now) store.delete(token);
  }
}

export function issueUnlockToken(): string {
  const store = getTokenStore();
  cleanup(store);
  const token = crypto.randomBytes(24).toString('base64url');
  store.set(token, { expiresAtMs: Date.now() + TOKEN_TTL_MS });
  return token;
}

export function clearAllUnlockTokens() {
  const store = getTokenStore();
  store.clear();
}

export function isValidUnlockToken(token: string | null | undefined): boolean {
  if (!token) return false;
  const store = getTokenStore();
  const entry = store.get(token);
  if (!entry) return false;
  if (entry.expiresAtMs <= Date.now()) {
    store.delete(token);
    return false;
  }
  return true;
}

export function requireUnlocked(request: Request): NextResponse | null {
  const token = request.headers.get('x-an-unlock');
  if (!isValidUnlockToken(token)) {
    return NextResponse.json({ error: 'Locked' }, { status: 401 });
  }
  return null;
}
