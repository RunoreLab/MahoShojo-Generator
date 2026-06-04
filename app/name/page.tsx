import type { Metadata } from 'next';
import { preload } from 'react-dom';

import { NamePage } from '@/components/creation/NamePage';

export const metadata: Metadata = {
  title: '✨ 魔法少女生成器 ✨',
  description: 'AI驱动的魔法少女角色生成器，创建独一无二的魔法少女角色',
};

function LogoPreloads() {
  preload('/logo.svg', {
    as: 'image',
    type: 'image/svg+xml',
  });
  preload('/logo-white.svg', {
    as: 'image',
    type: 'image/svg+xml',
  });

  return null;
}

export default function NameRoute() {
  return (
    <>
      <LogoPreloads />
      <NamePage />
    </>
  );
}
