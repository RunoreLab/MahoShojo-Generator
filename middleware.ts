import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { shouldRedirectToHttps } from '@/lib/security/browser-headers';

export function middleware(request: NextRequest) {
  const { nextUrl } = request;

  if (shouldRedirectToHttps(nextUrl, request.headers)) {
    const redirectUrl = nextUrl.clone();
    redirectUrl.protocol = 'https:';
    return NextResponse.redirect(redirectUrl, 308);
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/:path*',
};
