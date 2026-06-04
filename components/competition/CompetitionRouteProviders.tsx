'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ArenaPage } from '@/components/arena/ArenaPage';
import { BattleLitePage } from '@/components/arena-lite/BattleLitePage';
import { PvpLobbyPage } from '@/components/pvp/PvpLobbyPage';
import { PvpRoomPage } from '@/components/pvp/PvpRoomPage';
import { RankingPage } from '@/components/ranking/RankingPage';
import { useBattleStore } from '@/components/arena/stores/useBattleStore';
import { AppRouteAdapterProvider } from '@/components/competition/AppRouteAdapterProvider';

function QueryRouteProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <AppRouteAdapterProvider>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </AppRouteAdapterProvider>
  );
}

export function BattleRouteProviders() {
  return (
    <QueryRouteProviders>
      <BattleLitePage />
    </QueryRouteProviders>
  );
}

export function ArenaRouteProviders() {
  return (
    <QueryRouteProviders>
      <ArenaPage />
    </QueryRouteProviders>
  );
}

export function ArenaStreamRouteProviders() {
  useEffect(() => {
    useBattleStore.getState().setGenerationMode('stream');
  }, []);

  return (
    <QueryRouteProviders>
      <ArenaPage />
    </QueryRouteProviders>
  );
}

export function RankingRouteProviders() {
  return (
    <QueryRouteProviders>
      <RankingPage />
    </QueryRouteProviders>
  );
}

export function PvpRouteProviders() {
  return (
    <QueryRouteProviders>
      <PvpLobbyPage />
    </QueryRouteProviders>
  );
}

export function PvpRoomRouteProviders() {
  return (
    <QueryRouteProviders>
      <PvpRoomPage />
    </QueryRouteProviders>
  );
}
