import { useEffect, useMemo, useState } from 'react';

import { authStorage } from '@/lib/auth';
import { evaluateBetaAccess, type BetaAccessStats } from '@/lib/beta-access';
import type { BetaAccessFeatureId } from '@/config/beta-access';
import type { UserBadge } from '@/types/badge';

export type BetaAccessStatus = 'loading' | 'allowed' | 'blocked' | 'error';

export type BetaAccessState = {
  status: BetaAccessStatus;
  stats: BetaAccessStats | null;
  error: string | null;
};

export async function fetchBetaAccessStats(): Promise<BetaAccessStats> {
  const res = await authStorage.fetch('/api/me/beta-access');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as any)?.error || '加载内测权限数据失败');
  }
  return (data as any).stats as BetaAccessStats;
}

export function useBetaAccessStatus(params: {
  featureId: BetaAccessFeatureId;
  isAuthenticated: boolean;
  loading: boolean;
  badges: UserBadge[];
  badgesLoading?: boolean;
}): BetaAccessState {
  const { featureId, isAuthenticated, loading, badges, badgesLoading } = params;
  const [stats, setStats] = useState<BetaAccessStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) {
      setStats(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setStatsLoading(true);
    setError(null);

    fetchBetaAccessStats()
      .then((nextStats) => {
        if (cancelled) return;
        setStats(nextStats);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message || '加载内测权限数据失败');
      })
      .finally(() => {
        if (cancelled) return;
        setStatsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [featureId, isAuthenticated, loading]);

  const evaluation = useMemo(() => {
    return evaluateBetaAccess(featureId, badges, stats);
  }, [featureId, badges, stats]);

  if (loading || statsLoading || badgesLoading) {
    return { status: 'loading', stats, error };
  }

  if (!isAuthenticated) {
    return { status: 'blocked', stats, error };
  }

  if (error) {
    return { status: 'error', stats, error };
  }

  return { status: evaluation.allowed ? 'allowed' : 'blocked', stats, error: null };
}
