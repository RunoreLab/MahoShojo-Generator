import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CardForgePage } from '@/components/card-forge/CardForgePage';

export const metadata: Metadata = {
  title: '卡牌工坊 - MahoShojo Generator',
};

export default function CardForgeRoute() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-gray-500">加载中…</div>}>
      <CardForgePage />
    </Suspense>
  );
}
