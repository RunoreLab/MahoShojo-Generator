import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ArenaPage } from '@/components/arena/ArenaPage';

export default function Arena() {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <ArenaPage />
    </QueryClientProvider>
  );
}
