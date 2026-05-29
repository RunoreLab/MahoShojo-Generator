import { GoogleAnalytics } from '@next/third-parties/google';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import '@/styles/globals.css';
import '@/styles/blue-theme.css';
import '@/styles/gradient-buttons.css';
import 'katex/dist/katex.min.css';
import AnnouncementTicker from '@/components/Announcement/AnnouncementTicker';
import { GlobalTopBar } from '@/components/navigation/GlobalTopBar';
import { isTopbarCoveredPath } from '@/lib/navigation';
import { useNextRouter } from '@/lib/use-next-router';

export default function App({ Component, pageProps }: AppProps) {
  const router = useNextRouter();
  const isDetailsPage = router.pathname === '/details' || router.pathname === '/canshou';
  const isArrestedPage = router.pathname === '/arrested';
  const shouldShowTopbar = isTopbarCoveredPath(router.pathname);
  const gaId = process.env.NEXT_PUBLIC_GA_ID?.trim();

  return (
    <>
      <Head>
        <title>✨ 魔法少女生成器 ✨</title>
        <meta name="description" content="为你生成独特的魔法少女角色" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.svg" />
      </Head>

      <div className={isDetailsPage ? 'blue-theme' : ''}>
        {shouldShowTopbar ? <GlobalTopBar pathname={router.pathname} /> : null}
        <Component {...pageProps} />
        {!isArrestedPage && <AnnouncementTicker />}
        {gaId ? <GoogleAnalytics gaId={gaId} /> : null}
      </div>
    </>
  );
}
