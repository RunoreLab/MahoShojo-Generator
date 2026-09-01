'use client';

import '@/lib/zod-jitless';

import { GoogleAnalytics } from '@next/third-parties/google';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import AnnouncementTicker from '@/components/Announcement/AnnouncementTicker';
import { GlobalTopBar } from '@/components/navigation/GlobalTopBar';
import { getTopbarCanonicalPathname, isTopbarCoveredPath } from '@/lib/navigation';

interface AppProvidersProps {
  children: ReactNode;
}

export function AppProviders({ children }: AppProvidersProps) {
  const pathname = usePathname() || '/';
  const topbarPathname = getTopbarCanonicalPathname(pathname);
  const isBlueThemePage = topbarPathname === '/details' || topbarPathname === '/canshou';
  const isArrestedPage = topbarPathname === '/arrested';
  const shouldShowTopbar = isTopbarCoveredPath(topbarPathname);
  const gaId = process.env.NEXT_PUBLIC_GA_ID?.trim();

  return (
    <div className={isBlueThemePage ? 'blue-theme' : ''}>
      {shouldShowTopbar ? <GlobalTopBar pathname={topbarPathname} /> : null}
      {children}
      {!isArrestedPage && <AnnouncementTicker />}
      {gaId ? <GoogleAnalytics gaId={gaId} /> : null}
    </div>
  );
}
