'use client';

import { GoogleAnalytics } from '@next/third-parties/google';

import { useCspNonce } from '@/lib/client/csp-nonce';

export default function GoogleAnalyticsScripts() {
  const nonce = useCspNonce();
  const gaId = process.env.NEXT_PUBLIC_GA_ID?.trim();

  if (!gaId) return null;

  return <GoogleAnalytics gaId={gaId} nonce={nonce} />;
}
