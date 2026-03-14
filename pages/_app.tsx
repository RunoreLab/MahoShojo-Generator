import App, { type AppContext, type AppProps } from 'next/app';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useRef } from 'react';
import '@/styles/globals.css';
import '@/styles/blue-theme.css';
import '@/styles/gradient-buttons.css';
import 'katex/dist/katex.min.css';
import { ColorModeSwitcher } from '@/components/shared/ColorModeSwitcher';
import GoogleAnalyticsScripts from '@/components/shared/GoogleAnalyticsScripts';
import { CspNonceContext } from '@/lib/client/csp-nonce';
import { NONCE_HEADER } from '@/lib/security/browser-headers';
// 1. 引入新组件
import AnnouncementTicker from '@/components/Announcement/AnnouncementTicker';

// 如果需要统计，请取消注释并安装 @vercel/analytics
// import { Analytics } from "@vercel/analytics/next";

type AppPageProps = AppProps['pageProps'] & {
  cspNonce?: string;
};

function readNonceHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function MyApp({ Component, pageProps }: AppProps<AppPageProps>) {
  const router = useRouter();
  const initialNonceRef = useRef<string | undefined>(pageProps.cspNonce);
  const isDetailsPage = router.pathname === '/details' || router.pathname === '/canshou';
  // 2. 增加一个判断，用于在逮捕页隐藏公告
  const isArrestedPage = router.pathname === '/arrested';
  const cspNonce = pageProps.cspNonce ?? initialNonceRef.current;

  if (pageProps.cspNonce) {
    initialNonceRef.current = pageProps.cspNonce;
  }

  return (
    <>
      <Head>
        <title>✨ 魔法少女生成器 ✨</title>
        <meta name="description" content="为你生成独特的魔法少女角色" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.svg" />
      </Head>

      <CspNonceContext.Provider value={cspNonce}>
        <div className={isDetailsPage ? 'blue-theme' : ''}>
          <ColorModeSwitcher />
          <Component {...pageProps} />
          {/* 3. 在此处添加公告组件，并根据页面路径进行条件渲染 */}
          {!isArrestedPage && <AnnouncementTicker />}
          <GoogleAnalyticsScripts />
          {/* <Analytics /> */}
        </div>
      </CspNonceContext.Provider>
    </>
  );
}

MyApp.getInitialProps = async (appContext: AppContext) => {
  const appProps = await App.getInitialProps(appContext);
  const cspNonce = readNonceHeader(appContext.ctx.req?.headers[NONCE_HEADER]);

  return {
    ...appProps,
    pageProps: {
      ...appProps.pageProps,
      cspNonce,
    },
  };
};

export default MyApp;
