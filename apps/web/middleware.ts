import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import {
  HOSTED_DR_ACTIVATION_CANDIDATE_ENVIRONMENT,
  createHostedDrActivationCandidateRestrictedResponse,
  isHostedDrActivationCandidateRequestAllowed,
  parseHostedDrActivationCandidate,
} from '@/lib/hosted-dr/activation-candidate';
import { shouldRedirectToHttps } from '@/lib/security/browser-headers';

export function middleware(request: NextRequest) {
  const { nextUrl } = request;
  let activationCandidate: boolean;
  try {
    activationCandidate = parseHostedDrActivationCandidate(
      process.env[HOSTED_DR_ACTIVATION_CANDIDATE_ENVIRONMENT],
    );
  } catch {
    return createHostedDrActivationCandidateRestrictedResponse();
  }

  if (
    activationCandidate
    && !isHostedDrActivationCandidateRequestAllowed(nextUrl.pathname, request.method)
  ) {
    return createHostedDrActivationCandidateRestrictedResponse();
  }

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
