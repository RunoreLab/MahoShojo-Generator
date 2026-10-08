import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearch } from '@tanstack/react-router';

import {
  AppearanceSettingsSection,
  createPagePreferencesAdapter,
  isSettingsGroupId,
  PagePreferencesCard,
  SettingsCard,
  SettingsPage,
} from '@mahoshojo/ui-web/settings';

import { ProductFooter } from '@mahoshojo/ui-web/shell';
import { useExternalLinks } from '../features/external-links/external-links-provider';

import { DESKTOP_PAGE_PREFERENCE_SOURCES } from './settings-page-preferences';
import { AccountPanel } from '../features/account/AccountPanel';
import { AiConnectionsPanel } from '../features/ai-config/AiConnectionsPanel';
import { DesktopConfigFeedback } from '../features/config/DesktopConfigFeedback';
import { DesktopConfigFileCard } from '../features/config/DesktopConfigFileCard';
import { EscapeMenuSettingsCard } from '../features/config/EscapeMenuSettingsCard';
import { OnlineSettingsSection } from '../features/config/OnlineSettingsSection';
import { PublicCacheSettingsCard } from '../features/public-cache/PublicCacheSettingsCard';
import { WebPackageDiagnosticsPanel } from '../features/webpkg/WebPackageDiagnosticsPanel';
import { loadDesktopRuntimeInfo, type DesktopRuntimeInfo } from '../platform';
import { navigateByProductHref, resolveInternalHrefForHashHistory } from './hash-history-fragment';

interface RuntimeState {
  status: 'loading' | 'ready' | 'failed';
  info?: DesktopRuntimeInfo;
  message?: string;
}

/**
 * 运行时自述。
 *
 * 它曾经是 D0 的**首页**，而 `DESK-PROD-001` 明确禁止运行时/Provider 面板作为最终首页。因此它现在
 * 只出现在设置页：产品入口必须是产品首页，调试信息归设置。
 *
 * 读取失败仍然要显示失败而不是静默降级——`DESK-PROD-007` 要求初始化失败必须报告。
 */
const RuntimeInfoPanel = () => {
  const [state, setState] = useState<RuntimeState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    loadDesktopRuntimeInfo()
      .then((info) => {
        if (!cancelled) setState({ status: 'ready', info });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setState({
          status: 'failed',
          message: cause instanceof Error ? cause.message : 'unknown desktop bridge failure',
        });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="rounded-lg border border-(--app-border) bg-(--app-surface) p-4">
      <h2 className="mb-2 text-sm font-medium text-(--app-text-muted)">本地运行时</h2>
      {state.status === 'loading' && <p className="text-sm">正在读取本地运行时信息…</p>}
      {state.status === 'failed' && (
        <p className="text-sm text-(--app-accent-strong)">读取失败：{state.message}</p>
      )}
      {state.status === 'ready' && state.info && (
        <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-(--app-text-muted)">应用版本</dt>
          <dd>{state.info.appVersion}</dd>
          <dt className="text-(--app-text-muted)">Tauri 版本</dt>
          <dd>{state.info.tauriVersion}</dd>
          <dt className="text-(--app-text-muted)">平台</dt>
          <dd>
            {state.info.os} / {state.info.arch}
          </dd>
          <dt className="text-(--app-text-muted)">打包产物</dt>
          <dd>{state.info.packaged ? '是' : '否（开发构建）'}</dd>
        </dl>
      )}
    </section>
  );
};

/** 设置页内的产品路径链接——hash-history 解析 + TanStack 接管，与壳同一语义。 */
const SettingsPageLink = ({ href, children }: { href: string; children: string }) => {
  const router = useRouter();
  return (
    <a
      href={resolveInternalHrefForHashHistory(href)}
      onClick={(event) => {
        event.preventDefault();
        navigateByProductHref(router, href);
      }}
      className="ui-web-settings-motion shrink-0 rounded-md border border-(--app-border) px-3 py-1.5 text-xs font-medium text-(--app-text-muted) transition-colors hover:border-(--app-accent-strong) hover:text-(--app-accent-strong) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--app-accent-strong)"
    >
      {children}
    </a>
  );
};

const PagePreferencesSection = () => {
  const adapters = useMemo(
    () => DESKTOP_PAGE_PREFERENCE_SOURCES.map((source) => createPagePreferencesAdapter(source)),
    [],
  );
  return (
    <>
      {adapters.map((adapter) => (
        <PagePreferencesCard
          key={adapter.source.pageId}
          adapter={adapter}
          pageLink={
            <SettingsPageLink href={adapter.source.pagePath}>前往页面</SettingsPageLink>
          }
        />
      ))}
    </>
  );
};

const DataSection = () => (
  <>
    <SettingsCard
      title="本地库"
      description="本机数据卡与 Web 包的管理、导入导出；本地库不需要登录。"
      actions={<SettingsPageLink href="/local-library">打开本地库</SettingsPageLink>}
    />
    <PublicCacheSettingsCard />
    <DesktopConfigFileCard />
  </>
);

/**
 * Desktop 设置页（D5.1-S1）。
 *
 * 分组与顺序由共享 `SETTINGS_GROUPS` 决定；本文件只装配宿主事实——
 * 账号/AI 连接/诊断面板 + 各页草稿内偏好字段的 adapter。设备级设置
 * （外观、页偏好）全部落 localStorage/草稿，不触发账号查询，离线可改。
 * `?section=<group>` 是与 Web `/settings` 一致的章节深链。
 *
 * config.json 字段已跨分组分布（外观的 Esc 菜单、在线的公告/外链、数据
 * 的公开缓存）：写失败/冲突反馈是整份文件级状态，归页面共同位置的
 * `DesktopConfigFeedback` sticky 横幅（无反馈时不渲染、不占位），文件
 * 诊断归「数据与存储」组的 `DesktopConfigFileCard`（D5.1-N1-r1）。
 */
export const DesktopSettings = () => {
  const router = useRouter();
  const { openFixed } = useExternalLinks();
  const search = useSearch({ strict: false }) as { section?: string };
  const section = isSettingsGroupId(search.section) ? search.section : undefined;

  return (
    <section data-testid="page-settings" className="magic-background-white flex-1">
      <DesktopConfigFeedback />
      <SettingsPage
      section={section}
      footer={<ProductFooter
        assetSource={{ baseUrl: '/' }}
        onNavigateInternal={(href) => navigateByProductHref(router, href)}
        resolveInternalHref={resolveInternalHrefForHashHistory}
        onNavigateExternal={openFixed}
      />}
      intro="设备级设置即时生效并保存在本机；账号与云端设置需要登录。"
      groups={[
        {
          id: 'account',
          content: <AccountPanel />,
        },
        {
          id: 'appearance',
          content: (
            <>
              <AppearanceSettingsSection />
              <EscapeMenuSettingsCard />
            </>
          ),
        },
        {
          id: 'generation',
          content: (
            <>
              <AiConnectionsPanel />
              <PagePreferencesSection />
            </>
          ),
        },
        {
          id: 'online',
          content: <OnlineSettingsSection />,
        },
        {
          id: 'data',
          content: <DataSection />,
        },
        {
          id: 'advanced',
          content: (
            <>
              <WebPackageDiagnosticsPanel />
              <RuntimeInfoPanel />
            </>
          ),
        },
      ]}
    />
    </section>
  );
};
