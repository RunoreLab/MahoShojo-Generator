import type { Metadata } from 'next';

import { BattleRouteProviders } from '@/components/competition/BattleRouteProviders';

export const metadata: Metadata = {
  title: '魔法少女竞技场（简洁版） - MahoShojo Generator',
  description: '简洁单列竞技场页：更轻量地选择角色、情景并开始生成战报。',
};

export default function BattleRoute() {
  return <BattleRouteProviders />;
}
