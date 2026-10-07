'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { WebSettingsPage } from '@/components/settings/SettingsPage';

export function SettingsRouteProviders() {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <WebSettingsPage />
    </QueryClientProvider>
  );
}
