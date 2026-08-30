'use client';

import { useMemo, type ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';

import {
  ClientRouteAdapterProvider,
  serializeRouteTarget,
  type ClientRouteAdapter,
  type RouteQuery,
} from '@/lib/client-route-adapter';

interface AppRouteAdapterProviderProps {
  children: ReactNode;
}

export function AppRouteAdapterProvider({ children }: AppRouteAdapterProviderProps) {
  const router = useRouter();
  const params = useParams<Record<string, string | string[]>>();

  const query = useMemo<RouteQuery>(() => {
    const nextQuery: RouteQuery = {};

    if (typeof window !== 'undefined' && typeof window.location?.search === 'string') {
      const searchParams = new URLSearchParams(window.location.search);
      searchParams.forEach((_value, key) => {
        const all = searchParams.getAll(key);
        nextQuery[key] = all.length > 1 ? all : all[0];
      });
    }

    for (const [key, value] of Object.entries(params ?? {})) {
      nextQuery[key] = value;
    }

    return nextQuery;
  }, [params]);

  const adapter = useMemo<ClientRouteAdapter>(
    () => ({
      isReady: true,
      query,
      push: async (target) => {
        router.push(serializeRouteTarget(target));
      },
      replace: async (target) => {
        router.replace(serializeRouteTarget(target));
      },
    }),
    [query, router],
  );

  return <ClientRouteAdapterProvider adapter={adapter}>{children}</ClientRouteAdapterProvider>;
}
