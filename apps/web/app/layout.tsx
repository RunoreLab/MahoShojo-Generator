import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { AppProviders } from '@/app/providers';
import { getColorModeInitScript } from '@mahoshojo/ui-web/color-mode-init';
import { getMotionPreferenceInitScript, getReadingPreferenceInitScript } from '@mahoshojo/ui-web/device-preferences-init';
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
            // 首屏前应用亮暗、动效与阅读偏好；共源纯脚本不依赖 React 水合。
            __html: getColorModeInitScript() + getMotionPreferenceInitScript() + getReadingPreferenceInitScript(),
          }}
        />
      </head>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
