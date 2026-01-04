import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { RankingPage } from '@/components/ranking/RankingPage';

export default function Ranking() {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <RankingPage />
    </QueryClientProvider>
  );
}

