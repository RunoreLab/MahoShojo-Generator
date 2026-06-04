import type { Metadata } from 'next';

import { CharacterPartyPage } from '@/components/character/CharacterPartyPage';

export const metadata: Metadata = {
  title: '角色组队 - 魔法少女生成器',
  description: '将多个角色卡拼接组合成一张角色卡，支持保存图片、下载、保存到云端与生成立绘。',
};

export default function CharacterPartyRoute() {
  return <CharacterPartyPage />;
}
