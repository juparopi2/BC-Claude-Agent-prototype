import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { routing } from './i18n/routing';

const intlMiddleware = createMiddleware(routing);

export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only process routes with locale prefix for marketing
  // Portal routes (/chat, /files, /login, etc.) pass through unmodified
  if (pathname.match(/^\/(en|es|da)(\/|$)/)) {
    return intlMiddleware(request);
  }

  // Redirect root "/" → "/en/" (landing page default)
  if (pathname === '/') {
    return NextResponse.redirect(new URL('/en/', request.url));
  }

  // Everything else (portal, API, static) passes untouched
  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/(en|es|da)/:path*'],
};
