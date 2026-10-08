'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMemo } from 'react';

import {
  AppearanceSettingsSection,
  isSettingsGroupId,
  PagePreferencesCard,
  SettingsCard,
  SettingsPage,
} from '@mahoshojo/ui-web/settings';

import Footer from '@/components/Footer';
import { AccountSecurityPanel } from '@/components/me/AccountSecurityPanel';
import { AuthMigrationPanel } from '@/components/me/AuthMigrationPanel';
import { ProfileSettingsPanel } from '@/components/me/ProfileSettingsPanel';
import { createWebPagePreferenceAdapters } from '@/lib/settings/page-preferences';
import { useAuth } from '@/lib/useAuth';

/**
 * Web `/settings`（DESK-SET-001）：与 Desktop `/settings` 共用分组壳与
 * `?section=` 深链。旧 `/me?tab=settings` 由 `/me` 侧重定向到
 * `?section=account`；`/me?token=` 回跳由 `/password-recovery` 承接。
 *
 * 账号章节按需读会话：`unknown`/loading 不渲染成「未登录」；
 * 设备级分组（外观/页偏好）不依赖登录、不触发账号请求。
 */
export function WebSettingsPage() {
  const searchParams = useSearchParams();
  const sectionParam = searchParams.get('section');
  const section =
    sectionParam !== null && isSettingsGroupId(sectionParam) ? sectionParam : undefined;
  const { user, isAuthenticated, loading } = useAuth();
  const adapters = useMemo(() => createWebPagePreferenceAdapters(), []);

  const accountContent = loading ? (
    <SettingsCard title="账号">
      <p className="text-sm text-(--app-text-muted)">正在读取登录状态…</p>
    </SettingsCard>
  ) : isAuthenticated && user ? (
    <>
      <AuthMigrationPanel userId={user.id} />
      <ProfileSettingsPanel userId={user.id} />
      <AccountSecurityPanel userId={user.id} username={user.username} />
    </>
  ) : (
    <SettingsCard title="账号">
      <p className="text-sm text-(--app-text-muted)">
        登录后可管理资料、账号迁移与安全设置。请前往{' '}
        <Link href="/character-manager" className="text-(--app-accent-strong) underline">
          角色管理器
        </Link>{' '}
        登录。
      </p>
    </SettingsCard>
  );

  return (
    <div className="magic-background-white">
      <SettingsPage
        section={section}
        footer={<Footer />}
        intro="设备级设置即时生效并保存在本机浏览器；账号设置在登录后可改。"
        groups={[
          { id: 'account', content: accountContent },
          { id: 'appearance', content: <AppearanceSettingsSection /> },
          {
            id: 'generation',
            title: 'AI 与生成',
            description: '各页记住的生成偏好；页面内与这里修改的是同一个值。',
            content: (
              <>
                {adapters.map((adapter) => (
                  <PagePreferencesCard
                    key={adapter.source.pageId}
                    adapter={adapter}
                    pageLink={
                      <Link
                        href={adapter.source.pagePath}
                        className="ui-web-settings-motion shrink-0 rounded-md border border-(--app-border) px-3 py-1.5 text-xs font-medium text-(--app-text-muted) transition-colors hover:border-(--app-accent-strong) hover:text-(--app-accent-strong) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--app-accent-strong)"
                      >
                        前往页面
                      </Link>
                    }
                  />
                ))}
              </>
            ),
          },
          {
            id: 'data',
            content: (
              <SettingsCard
                title="本地库"
                description="本机浏览器中的数据卡管理、导入导出；不需要登录。"
                actions={
                  <Link
                    href="/local-library"
                    className="ui-web-settings-motion shrink-0 rounded-md border border-(--app-border) px-3 py-1.5 text-xs font-medium text-(--app-text-muted) transition-colors hover:border-(--app-accent-strong) hover:text-(--app-accent-strong) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--app-accent-strong)"
                  >
                    打开本地库
                  </Link>
                }
              />
            ),
          },
        ]}
      />
    </div>
  );
}
