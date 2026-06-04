import type { Metadata } from 'next';

import { TavernPage } from '@/components/tavern/TavernPage';

export const metadata: Metadata = {
  title: '酒馆生态联动',
  description: 'SillyTavern（酒馆）角色卡导入/导出：PNG 内嵌 JSON 解析与写入（本地处理）',
};

export default function TavernRoute() {
  return <TavernPage />;
}
