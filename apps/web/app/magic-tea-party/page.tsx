import type { Metadata } from 'next';

import { MagicTeaPartyPage } from '@/components/magic-tea-party/MagicTeaPartyPage';

export const metadata: Metadata = {
  title: '魔法茶会',
  description: '基于角色卡/情景卡的长期对话与剧情体验（本地存储，自备 API Key）',
};

export default function MagicTeaPartyRoute() {
  return <MagicTeaPartyPage />;
}
