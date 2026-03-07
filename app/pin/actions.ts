'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

type PinState = {
  error?: string;
};

const PIN_CODE = '130505';
const PIN_COOKIE_NAME = 'pin_unlocked';
const PIN_COOKIE_VALUE = '1';

function sanitizeNext(next: unknown) {
  if (typeof next !== 'string') return null;
  if (!next.startsWith('/')) return null;
  if (next.startsWith('//')) return null;
  return next;
}

export async function unlock(_prevState: PinState, formData: FormData): Promise<PinState> {
  const pin = String(formData.get('pin') ?? '').replace(/\D/g, '').slice(0, 6);
  const next = sanitizeNext(formData.get('next')) ?? '/';

  if (pin.length !== 6) return { error: 'Enter the 6‑digit PIN.' };
  if (pin !== PIN_CODE) return { error: 'Wrong PIN. Try again.' };

  const cookieStore = await cookies();
  cookieStore.set({
    name: PIN_COOKIE_NAME,
    value: PIN_COOKIE_VALUE,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });

  redirect(next);
}
