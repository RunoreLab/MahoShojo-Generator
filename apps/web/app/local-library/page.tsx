import type { Metadata } from 'next';

import { LocalLibraryPage } from '@/components/library/LocalLibraryPage';

export const metadata: Metadata = {
  title: '本地库 - MahoShojo Generator',
  description: '本机数据卡与 Web 包的管理、导入导出，无需登录',
};

export default function LocalLibraryRoute() {
  return <LocalLibraryPage />;
}