import type { Metadata } from 'next';

import { NotFoundClient } from '@/app/not-found-client';

export const metadata: Metadata = {
  title: '404 - 页面不存在 | 魔法少女生成器',
  description: '页面未找到',
};

export default function NotFound() {
  return <NotFoundClient />;
}
