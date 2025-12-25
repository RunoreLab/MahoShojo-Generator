import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { MePage } from '@/components/me/MePage';

export default function Me() {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <MePage />
    </QueryClientProvider>
  );
}

