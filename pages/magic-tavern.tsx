import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect } from 'react';

import type { BetaAccessFeatureId } from '@/config/beta-access';
import { buildBetaAccessUrl } from '@/lib/beta-access';
import { useBetaAccessStatus } from '@/lib/beta-access-client';
import { useAuth } from '@/lib/useAuth';

export default function MagicTavernRedirect() {
  const router = useRouter();
  const { isAuthenticated, loading, userBadges, badgesLoading } = useAuth();
  const betaFeatureId: BetaAccessFeatureId = 'magic-tavern';
  const betaAccess = useBetaAccessStatus({
    featureId: betaFeatureId,
    isAuthenticated,
    loading,
    badges: userBadges,
    badgesLoading,
  });

  useEffect(() => {
    if (betaAccess.status === 'allowed') {
      void router.replace('/magic-tea-party');
      return;
    }
    if (betaAccess.status === 'blocked' || betaAccess.status === 'error') {
      void router.replace(buildBetaAccessUrl(betaFeatureId));
    }
  }, [betaAccess.status, betaFeatureId, router]);

  const statusText = betaAccess.status === 'allowed' ? '权限已确认，正在跳转到魔法茶会…' : '正在核验内测权限…';

  return (
    <>
      <Head>
        <title>魔法茶馆</title>
      </Head>
      <div className="magic-background-white">
        <div className="container !max-w-[1200px]">
          <div className="card !max-w-none">
            <div className="py-12 text-center text-sm text-gray-600">{statusText}</div>
          </div>
        </div>
      </div>
    </>
  );
}
