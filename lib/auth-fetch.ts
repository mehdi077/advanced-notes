import { useUnlockStore } from '@/lib/stores/unlock-store';

export async function authFetch(input: RequestInfo | URL, init?: RequestInit) {
  const token = useUnlockStore.getState().unlockToken;
  const headers = new Headers(init?.headers);
  if (token) headers.set('x-an-unlock', token);
  const response = await fetch(input, { ...init, headers });
  if (response.status === 401) {
    useUnlockStore.getState().clearUnlockToken();
  }
  return response;
}
