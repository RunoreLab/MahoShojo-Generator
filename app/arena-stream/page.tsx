import type { Metadata } from 'next';

import { ArenaStreamRouteProviders } from '@/components/competition/CompetitionRouteProviders';

export const metadata: Metadata = {
  title: '魔法少女竞技场·流 - MahoShojo Generator',
  description: '上传魔法少女、残兽或通用角色的设定，流式生成她们之间的战斗或日常故事！',
};

export default function ArenaStreamRoute() {
  return <ArenaStreamRouteProviders />;
}
