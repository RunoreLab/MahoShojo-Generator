import { Head, Html, Main, NextScript } from 'next/document';

import { getColorModeInitScript } from '@/lib/color-mode-init';

export default function Document() {
  return (
    <Html lang="zh-CN">
      <Head>
        <script
          dangerouslySetInnerHTML={{
            __html: getColorModeInitScript(),
          }}
        />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
