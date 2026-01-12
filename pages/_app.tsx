import type { AppProps } from 'next/app';
import Head from 'next/head';
import { useRouter } from 'next/router';
import '@/styles/globals.css';
import '@/styles/blue-theme.css';
import '@/styles/gradient-buttons.css';
import 'katex/dist/katex.min.css';
import { GoogleAnalytics } from '@next/third-parties/google';
// 1. 引入新组件
import AnnouncementTicker from '@/components/Announcement/AnnouncementTicker';

// 如果需要统计，请取消注释并安装 @vercel/analytics
// import { Analytics } from "@vercel/analytics/next";

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const isDetailsPage = router.pathname === '/details' || router.pathname === '/canshou';
  // 2. 增加一个判断，用于在逮捕页隐藏公告
  const isArrestedPage = router.pathname === '/arrested';

  return (
    <>
      <Head>
        <title>✨ 魔法少女生成器 ✨</title>
        <meta name="description" content="为你生成独特的魔法少女角色" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.svg" />
      </Head>

      <div className={isDetailsPage ? 'blue-theme' : ''}>
        <Component {...pageProps} />
        {/* 3. 在此处添加公告组件，并根据页面路径进行条件渲染 */}
        {!isArrestedPage && <AnnouncementTicker />}
        <GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GA_ID || ''} />
        {/* <Analytics /> */}
      </div>
    </>
  );
}
