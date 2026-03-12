import { NextRequest, NextResponse } from 'next/server';

const UNLOCK_COOKIE = 'an_unlock';

function isPublicPath(pathname: string): boolean {
  if (pathname === '/unlock') return true;
  if (pathname.startsWith('/unlock/')) return true;

  if (pathname.startsWith('/api/unlock')) return true;

  // Static / framework assets
  if (pathname.startsWith('/_next/')) return true;
  if (pathname === '/favicon.ico') return true;
  if (pathname === '/favicon.png') return true;
  return false;
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const unlocked = request.cookies.get(UNLOCK_COOKIE)?.value;
  if (unlocked) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Locked' }, { status: 401 });
  }

  const url = request.nextUrl.clone();
  url.pathname = '/unlock';
  url.searchParams.set('next', `${pathname}${search}`);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
