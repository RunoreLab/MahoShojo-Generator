import type { Metadata } from 'next';

import { ArenaRouteProviders } from '@/components/competition/ArenaRouteProviders';

export const metadata: Metadata = {
  title: '魔法少女竞技场 - MahoShojo Generator',
  description: '选择角色卡，生成角色之间的战斗或日常故事！',
};

export default function ArenaRoute() {
  return <ArenaRouteProviders />;
}
