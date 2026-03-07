import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const PIN_COOKIE_NAME = 'pin_unlocked';
const PIN_COOKIE_VALUE = '1';

function isPublicPath(pathname: string) {
  if (pathname.startsWith('/pin')) return true;
  if (pathname.startsWith('/_next')) return true;
  if (pathname === '/favicon.ico') return true;
  if (pathname === '/favicon.png') return true;
  return false;
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const unlocked = req.cookies.get(PIN_COOKIE_NAME)?.value === PIN_COOKIE_VALUE;
  if (unlocked) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = '/pin';
  url.searchParams.set('next', `${pathname}${search}`);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
