import type { Metadata } from 'next';

import { CharacterManagerPage } from '@/components/character/CharacterManagerPage';

export const metadata: Metadata = {
  title: '角色管理中心 - MahoShojo Generator',
};

export default function CharacterManagerRoute() {
  return <CharacterManagerPage />;
}
