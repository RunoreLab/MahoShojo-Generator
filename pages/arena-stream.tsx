import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Head from 'next/head';

import { ArenaPage } from '@/components/arena/ArenaPage';
import { useBattleStore } from '@/components/arena/stores/useBattleStore';

export default function ArenaStreamPage() {
  const [queryClient] = useState(() => new QueryClient());

  useEffect(() => {
    useBattleStore.getState().setGenerationMode('stream');
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <Head>
        <title>魔法少女竞技场·流 - MahoShojo Generator</title>
        <meta
          name="description"
          content="上传魔法少女、残兽或通用角色的设定，流式生成她们之间的战斗或日常故事！"
        />
      </Head>
      <ArenaPage />
    </QueryClientProvider>
  );
}
