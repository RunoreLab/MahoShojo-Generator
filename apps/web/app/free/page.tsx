import type { Metadata } from 'next';

import { FreePage } from '@/components/creation/FreePage';

export const metadata: Metadata = {
  title: '自由生成 - MahoShojo Generator',
  description: '自由输入提示词，按指定 Schema 生成任意数据卡（角色/情景）。自由生成产物为非原生。',
};

export default function FreeRoute() {
  return <FreePage />;
}
