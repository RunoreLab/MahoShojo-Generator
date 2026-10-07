'use client';

import '@/lib/zod-jitless';

import { GoogleAnalytics } from '@next/third-parties/google';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import AnnouncementTicker from '@/components/Announcement/AnnouncementTicker';
import { GlobalTopBar } from '@/components/navigation/GlobalTopBar';
import { getTopbarCanonicalPathname, isTopbarCoveredPath } from '@mahoshojo/ui-web/navigation';

interface AppProvidersProps {
  children: ReactNode;
}

export function AppProviders({ children }: AppProvidersProps) {
  const pathname = usePathname() || '/';
  const topbarPathname = getTopbarCanonicalPathname(pathname);
  const isBlueThemePage = topbarPathname === '/details' || topbarPathname === '/canshou';
  const isArrestedPage = topbarPathname === '/arrested';
  // 密码恢复页 URL 携带敏感 token：该路由不加载 GA——`page_location`
  // 是显式采集字段，Referrer-Policy 无法拦它（OWASP 密码重置指引）。
  // 边界注意：GA 一旦在先前页面加载就会监听 history 变化自动上报
  // pageview，仅靠这里卸载组件不构成防护。因此 DESK-SET-001 的硬约束
  // 落在 URL 生产侧——携带恢复 token 的 URL 只允许整文档导航（地址栏/
  // 邮件链接/服务端 redirect），不得经 <Link>/router.push 进入。
  const isPasswordRecoveryPage = topbarPathname === '/password-recovery';
  const shouldShowTopbar = isTopbarCoveredPath(topbarPathname);
  const gaId = process.env.NEXT_PUBLIC_GA_ID?.trim();

  return (
    <div className={isBlueThemePage ? 'blue-theme' : ''}>
      {shouldShowTopbar ? <GlobalTopBar pathname={topbarPathname} /> : null}
      {children}
      {!isArrestedPage && <AnnouncementTicker />}
      {gaId && !isPasswordRecoveryPage ? <GoogleAnalytics gaId={gaId} /> : null}
    </div>
  );
}
