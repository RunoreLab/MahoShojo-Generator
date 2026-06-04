'use client';

import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AppRouteAdapterProvider } from '@/components/competition/AppRouteAdapterProvider';

export function QueryRouteProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <AppRouteAdapterProvider>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </AppRouteAdapterProvider>
  );
}
