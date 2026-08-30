import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { AppProviders } from '@/app/providers';
import { getColorModeInitScript } from '@/lib/color-mode-init';
import '@/styles/globals.css';
import '@/styles/blue-theme.css';
import '@/styles/gradient-buttons.css';
import 'katex/dist/katex.min.css';

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
            __html: getColorModeInitScript(),
          }}
        />
      </head>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
