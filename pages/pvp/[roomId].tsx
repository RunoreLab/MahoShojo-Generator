import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { PvpRoomPage } from '@/components/pvp/PvpRoomPage';

export default function PvpRoom() {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <PvpRoomPage />
    </QueryClientProvider>
  );
}

