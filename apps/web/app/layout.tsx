import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { AppProviders } from '@/app/providers';
import { getColorModeInitScript } from '@mahoshojo/ui-web/color-mode-init';
import { getMotionPreferenceInitScript } from '@mahoshojo/ui-web/device-preferences-init';
import '@/styles/globals.css';
import '@/styles/blue-theme.css';
import '@mahoshojo/ui-web/markdown.css';

export const metadata: Metadata = {
  title: '✨ 魔法少女生成器 ✨',
  description: '为你生成独特的魔法少女角色',
  icons: {
    icon: '/favicon.svg',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            // 首屏前标记共源设备偏好：亮暗（data-color-mode）与减少动效
            //（data-motion）——两个 init 脚本都是无依赖 IIFE，可顺序拼接。
            __html: getColorModeInitScript() + getMotionPreferenceInitScript(),
          }}
        />
      </head>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
