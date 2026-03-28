import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { BattleLitePage } from '@/components/arena-lite/BattleLitePage';

export default function Battle() {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <BattleLitePage />
    </QueryClientProvider>
  );
}
