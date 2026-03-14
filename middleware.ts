import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import {
  buildContentSecurityPolicy,
  createNonce,
  isDocumentRequest,
  NONCE_HEADER,
  shouldRedirectToHttps,
} from '@/lib/security/browser-headers';

const isProduction = process.env.NODE_ENV === 'production';

export function middleware(request: NextRequest) {
  const { nextUrl } = request;

  if (shouldRedirectToHttps(nextUrl, request.headers)) {
    const redirectUrl = nextUrl.clone();
    redirectUrl.protocol = 'https:';
    return NextResponse.redirect(redirectUrl, 308);
  }

  if (!isDocumentRequest(nextUrl.pathname, request.headers)) {
    return NextResponse.next();
  }

  const nonce = createNonce();
  const contentSecurityPolicy = buildContentSecurityPolicy({
    allowGoogleAnalytics: Boolean(process.env.NEXT_PUBLIC_GA_ID?.trim()),
    allowTurnstile: true,
    isProduction,
    nonce,
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(NONCE_HEADER, nonce);
  requestHeaders.set('Content-Security-Policy', contentSecurityPolicy);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  response.headers.set('Content-Security-Policy', contentSecurityPolicy);
  return response;
}

export const config = {
  matcher: '/:path*',
};
