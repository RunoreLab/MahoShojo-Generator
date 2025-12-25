import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { PvpLobbyPage } from '@/components/pvp/PvpLobbyPage';

export default function Pvp() {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <PvpLobbyPage />
    </QueryClientProvider>
  );
}

