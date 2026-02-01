import { Head, Html, Main, NextScript } from 'next/document';

import { COLOR_MODE_STORAGE_KEY } from '@/lib/color-mode';

const colorModeScript = `(() => {
  try {
    var stored = window.localStorage.getItem('${COLOR_MODE_STORAGE_KEY}');
    var preference = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var resolved = preference === 'system' ? (prefersDark ? 'dark' : 'light') : preference;
    document.documentElement.dataset.colorMode = resolved;
  } catch (e) {}
})();`;

export default function Document() {
  return (
    <Html lang="zh-CN">
      <Head>
        <script
          dangerouslySetInnerHTML={{
            __html: colorModeScript,
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
