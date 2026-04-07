import { useEffect } from 'react';
import Router from 'next/router';

import { ChallengePage } from '@/components/challenge/ChallengePage';
import type { BetaAccessFeatureId } from '@/config/beta-access';
import { buildBetaAccessUrl } from '@/lib/beta-access';
import { useBetaAccessStatus } from '@/lib/beta-access-client';
import { useAuth } from '@/lib/useAuth';

export default function ChallengePageRoute() {
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
      void Router.replace(buildBetaAccessUrl(betaFeatureId));
    }
  }, [betaAccess.status, betaFeatureId]);

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
