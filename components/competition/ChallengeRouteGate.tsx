'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { ChallengePage } from '@/components/challenge/ChallengePage';
import type { BetaAccessFeatureId } from '@/config/beta-access';
import { buildBetaAccessUrl } from '@/lib/beta-access';
import { useBetaAccessStatus } from '@/lib/beta-access-client';
import { useAuth } from '@/lib/useAuth';

export function ChallengeRouteGate() {
  const router = useRouter();
  const { isAuthenticated, loading, userBadges, badgesLoading } = useAuth();
  const betaFeatureId: BetaAccessFeatureId = 'challenge';
  const betaAccess = useBetaAccessStatus({
    featureId: betaFeatureId,
    isAuthenticated,
    loading,
    badges: userBadges,
    badgesLoading,
  });

  useEffect(() => {
    if (betaAccess.status === 'blocked' || betaAccess.status === 'error') {
      router.replace(buildBetaAccessUrl(betaFeatureId));
    }
  }, [betaAccess.status, betaFeatureId, router]);

  if (betaAccess.status !== 'allowed') {
    return (
      <div className="magic-background-white">
        <div className="container">
          <div className="card">
            <div className="py-10 text-center text-sm text-gray-600">正在核验内测权限…</div>
          </div>
        </div>
      </div>
    );
  }

  return <ChallengePage />;
}
