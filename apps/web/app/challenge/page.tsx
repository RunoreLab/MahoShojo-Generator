import type { Metadata } from 'next';

import { ChallengeRouteGate } from '@/components/competition/ChallengeRouteGate';

export const metadata: Metadata = {
  title: '魔女挑战 - MahoShojo Generator',
  description: '选择角色进入挑战地图，推进节点并结算遭遇。',
};

export default function ChallengeRoute() {
  return <ChallengeRouteGate />;
}
