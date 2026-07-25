'use client';

import { createContext, useContext, type ReactNode } from 'react';

export type RouteQuery = Record<string, string | string[] | undefined>;

export type RoutePushTarget =
  | string
  | {
      pathname: string;
      query?: Record<string, string | number | boolean | null | undefined>;
    };

export interface ClientRouteAdapter {
  isReady: boolean;
  query: RouteQuery;
  push: (target: RoutePushTarget) => Promise<void>;
  replace: (target: RoutePushTarget) => Promise<void>;
}

const ClientRouteAdapterContext = createContext<ClientRouteAdapter | null>(null);

export function serializeRouteTarget(target: RoutePushTarget): string {
  if (typeof target === 'string') {
    return target;
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(target.query ?? {})) {
    if (value === null || typeof value === 'undefined') continue;
    params.set(key, String(value));
  }

  const query = params.toString();
  return query ? `${target.pathname}?${query}` : target.pathname;
}

interface ClientRouteAdapterProviderProps {
  adapter: ClientRouteAdapter;
  children: ReactNode;
}

export function ClientRouteAdapterProvider({ adapter, children }: ClientRouteAdapterProviderProps) {
  return (
    <ClientRouteAdapterContext.Provider value={adapter}>
      {children}
    </ClientRouteAdapterContext.Provider>
  );
}

export function useClientRouteAdapter(): ClientRouteAdapter {
  const adapter = useContext(ClientRouteAdapterContext);
  if (!adapter) {
    throw new Error('ClientRouteAdapterProvider is required for this route surface.');
  }
  return adapter;
}
