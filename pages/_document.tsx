import Document, { Head, Html, Main, NextScript, type DocumentContext, type DocumentInitialProps } from 'next/document';

import { COLOR_MODE_STORAGE_KEY } from '@/lib/color-mode';
import { NONCE_HEADER } from '@/lib/security/browser-headers';

const colorModeScript = `(() => {
  try {
    var stored = window.localStorage.getItem('${COLOR_MODE_STORAGE_KEY}');
    var preference = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var resolved = preference === 'system' ? (prefersDark ? 'dark' : 'light') : preference;
    document.documentElement.dataset.colorMode = resolved;
  } catch (e) {}
})();`;

type CustomDocumentProps = DocumentInitialProps & {
  nonce?: string;
};

function readNonceHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default class CustomDocument extends Document<CustomDocumentProps> {
  static async getInitialProps(ctx: DocumentContext): Promise<CustomDocumentProps> {
    const initialProps = await Document.getInitialProps(ctx);
    const nonce = readNonceHeader(ctx.req?.headers[NONCE_HEADER]);

    return {
      ...initialProps,
      nonce,
    };
  }

  render() {
    const nonce = this.props.nonce;

    return (
      <Html lang="zh-CN">
        <Head nonce={nonce}>
          <script
            nonce={nonce}
            dangerouslySetInnerHTML={{
              __html: colorModeScript,
            }}
          />
        </Head>
        <body>
          <Main />
          <NextScript nonce={nonce} />
        </body>
      </Html>
    );
  }
}
