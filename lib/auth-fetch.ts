import { useUnlockStore } from '@/lib/stores/unlock-store';

export function authFetch(input: RequestInfo | URL, init?: RequestInit) {
  const token = useUnlockStore.getState().unlockToken;
  const headers = new Headers(init?.headers);
  if (token) headers.set('x-an-unlock', token);
  return fetch(input, { ...init, headers });
}
