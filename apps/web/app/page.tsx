import type { Metadata } from 'next';
import { preload } from 'react-dom';

import { HomePage } from '@/components/home/HomePage';
import { getAllFeatureImages } from '@/config/features';

export const metadata: Metadata = {
  title: '✨ 魔法少女生成器 ✨',
  description: 'AI驱动的魔法少女角色生成器，创建独一无二的魔法少女角色',
};

function FeatureImagePreloads() {
  for (const src of getAllFeatureImages()) {
    preload(src, {
      as: 'image',
      type: 'image/svg+xml',
    });
  }

  return null;
}

export default function HomeRoute() {
  return (
    <>
      <FeatureImagePreloads />
      <HomePage />
    </>
  );
}
