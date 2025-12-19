import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ArenaPage } from '@/components/arena/ArenaPage';
import { useBattleStore } from '@/components/arena/stores/useBattleStore';

export default function BattleStream() {
  const [queryClient] = useState(() => new QueryClient());

  useEffect(() => {
    useBattleStore.getState().setGenerationMode('stream');
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ArenaPage />
    </QueryClientProvider>
  );
}

