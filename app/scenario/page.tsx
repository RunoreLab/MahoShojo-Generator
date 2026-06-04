import type { Metadata } from 'next';

import { ScenarioPage } from '@/components/creation/ScenarioPage';

export const metadata: Metadata = {
  title: '箱庭物语 - MahoShojo Generator',
  description: '通过回答问题，快速生成用于竞技场的自定义故事场景。',
};

export default function ScenarioRoute() {
  return <ScenarioPage />;
}
