import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

import {
  SettingsCard,
  SettingsFieldRow,
  SettingsOptionButtons,
  SettingsToggle,
} from '@mahoshojo/ui-web/settings';
import type { DesktopPublicCacheStats } from '@mahoshojo/contracts/desktop-ipc';
import type {
  DesktopPublicCacheBudget,
  DesktopPublicCacheWhenFull,
} from '@mahoshojo/contracts/desktop-config';

import {
  clearPublicCache,
  readPublicCacheStats,
} from '../../platform/public-cache-bridge';
import { useDesktopConfig } from '../config/use-desktop-config';

/**
 * 「数据」分组的公开资料缓存卡（D5.1-K1，`DESK-CACHE-006`/`008`）。
 *
 * 文案必须持续讲清两件事：
 * - 这是**派生缓存**——存的是「在线读到过的公开资料副本」，清空只意味着
 *   离线可看的内容变少，正式本地库与用户数据不受影响；
 * - 三个策略字段与 `OnlineSettingsSection` 读同一份 config snapshot，
 *   这里的控件不产生第二份默认值。
 */

const MIB = 1024 * 1024;

const BUDGET_PRESETS: ReadonlyArray<{ value: string; label: string; bytes: DesktopPublicCacheBudget }> = [
  { value: '128', label: '128 MB', bytes: 128 * MIB },
  { value: '256', label: '256 MB（默认）', bytes: 256 * MIB },
  { value: '512', label: '512 MB', bytes: 512 * MIB },
  { value: '1024', label: '1 GB', bytes: 1024 * MIB },
  { value: '4096', label: '4 GB', bytes: 4096 * MIB },
  { value: 'unlimited', label: '不设上限', bytes: 'unlimited' },
];

const WHEN_FULL_OPTIONS: ReadonlyArray<{ value: DesktopPublicCacheWhenFull; label: string }> = [
  { value: 'pause', label: '暂停写入（默认）' },
  { value: 'evict-least-recently-used', label: '自动清理最久未用' },
];

const formatBytes = (bytes: number): string => {
  if (bytes >= 1024 * MIB) return `${(bytes / (1024 * MIB)).toFixed(1)} GB`;
  if (bytes >= MIB) return `${(bytes / MIB).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
};

const budgetLabel = (budget: DesktopPublicCacheBudget): string =>
  budget === 'unlimited' ? '不设上限' : formatBytes(budget);

const budgetPresetValue = (budget: DesktopPublicCacheBudget): string => {
  const preset = BUDGET_PRESETS.find((option) => option.bytes === budget);
  return preset?.value ?? '';
};

const statusText = (stats: DesktopPublicCacheStats): string => {
  switch (stats.status) {
    case 'empty':
      return '尚未建立——浏览公开库时自动缓存';
    case 'ready':
      return '正常';
    case 'unavailable':
      return '暂不可用（打开失败），在线浏览不受影响';
    case 'unsupported-schema':
      return '来自更新版本的应用，本版本不读写';
    default:
      return '未知';
  }
};

interface StatsState {
  readonly status: 'idle' | 'loading' | 'ready' | 'failed';
  readonly stats?: DesktopPublicCacheStats;
  readonly message?: string;
}

export const PublicCacheSettingsCard = () => {
  const { state, editable, setField } = useDesktopConfig();
  const [statsState, setStatsState] = useState<StatsState>({ status: 'idle' });
  const [clearConfirm, setClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearMessage, setClearMessage] = useState<string | null>(null);
  const configBusy = state.saving || state.status === 'loading';

  const refreshStats = useCallback(() => {
    setStatsState((previous) => ({ ...previous, status: 'loading' }));
    readPublicCacheStats(invoke)
      .then((stats) => setStatsState({ status: 'ready', stats }))
      .catch((cause: unknown) => {
        setStatsState({
          status: 'failed',
          message: cause instanceof Error ? cause.message : '读取缓存统计失败',
        });
      });
  }, []);

  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  const runClear = () => {
    setClearing(true);
    setClearMessage(null);
    clearPublicCache(invoke)
      .then((result) => {
        setClearMessage(
          `已清除 ${result.removedEntries} 条缓存记录，释放 ${formatBytes(result.freedBytes)}。`,
        );
        refreshStats();
      })
      .catch((cause: unknown) => {
        setClearMessage(
          cause instanceof Error ? `清除失败：${cause.message}` : '清除缓存失败',
        );
      })
      .finally(() => {
        setClearing(false);
        setClearConfirm(false);
      });
  };

  const stats = statsState.stats;
  const customBudget =
    state.values.publicCacheMaxBytes !== 'unlimited'
    && budgetPresetValue(state.values.publicCacheMaxBytes) === ''
      ? state.values.publicCacheMaxBytes
      : null;

  return (
    <SettingsCard
      title="公开资料缓存"
      description="把在线读到过的公开资料副本缓存在本机（public-read-cache.sqlite），供离线时查看。这是派生数据：清除只影响离线可看内容，不影响本地库与你的数据。"
      actions={
        <button
          type="button"
          className="ui-web-settings-motion rounded-md border border-(--app-border) px-3 py-1.5 text-xs font-medium text-(--app-text-muted) transition-colors enabled:hover:border-(--app-accent-strong) enabled:hover:text-(--app-accent-strong) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--app-accent-strong) disabled:cursor-not-allowed disabled:opacity-50"
          disabled={statsState.status === 'loading'}
          onClick={refreshStats}
        >
          刷新统计
        </button>
      }
    >
      {state.publicCacheDegraded ? (
        <p role="alert" className="pb-2 text-xs text-(--app-accent-strong)">
          缓存配置无法校验，已按「暂停捕获、不淘汰」生效——修复配置文件或恢复默认后重新加载。
        </p>
      ) : null}

      <SettingsFieldRow
        label="缓存公开资料"
        description="在线浏览公开库时，把成功读取的公开摘要与正文副本存入本机缓存。"
        control={
          <SettingsToggle
            checked={state.values.publicCacheCaptureEnabled}
            onChange={(value) => setField('publicCacheCaptureEnabled', value)}
            disabled={!editable || configBusy}
            ariaLabel="缓存公开资料"
          />
        }
      />
      <SettingsFieldRow
        label="缓存大小上限"
        description={
          customBudget === null
            ? '缓存总量上限；达到上限后按下方策略处理。'
            : `当前为配置文件手工设置的值（${budgetLabel(customBudget)}）；选择预设值可覆盖。`
        }
        control={
          <SettingsOptionButtons
            value={budgetPresetValue(state.values.publicCacheMaxBytes)}
            options={BUDGET_PRESETS.map(({ value, label }) => ({ value, label }))}
            onChange={(value) => {
              const preset = BUDGET_PRESETS.find((option) => option.value === value);
              if (preset) setField('publicCacheMaxBytes', preset.bytes);
            }}
            disabled={!editable || configBusy}
            ariaLabel="缓存大小上限"
          />
        }
      />
      <SettingsFieldRow
        label="达到上限时"
        description="默认暂停写入、保留已缓存内容；可选自动清理最久未使用的条目。"
        control={
          <SettingsOptionButtons
            value={state.values.publicCacheWhenFull}
            options={WHEN_FULL_OPTIONS}
            onChange={(value) => setField('publicCacheWhenFull', value)}
            disabled={!editable || configBusy}
            ariaLabel="达到上限时的处理策略"
          />
        }
      />

      <div className="mt-3 border-t border-(--app-border) pt-3">
        {statsState.status === 'loading' || statsState.status === 'idle' ? (
          <p role="status" className="text-xs text-(--app-text-subtle)">正在读取缓存统计…</p>
        ) : null}
        {statsState.status === 'failed' ? (
          <p role="alert" className="text-xs text-(--app-accent-strong)">
            缓存统计读取失败：{statsState.message ?? '未知错误'}
          </p>
        ) : null}
        {stats ? (
          <>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
              <dt className="text-(--app-text-subtle)">状态</dt>
              <dd className="col-span-1 sm:col-span-2">{statusText(stats)}</dd>
              <dt className="text-(--app-text-subtle)">已用空间</dt>
              <dd className="col-span-1 sm:col-span-2">
                {formatBytes(stats.usageBytes)}
                {stats.appliedPolicy.maxBytes === 'unlimited'
                  ? ' / 不设上限'
                  : ` / ${formatBytes(stats.appliedPolicy.maxBytes)}`}
              </dd>
              <dt className="text-(--app-text-subtle)">缓存条目</dt>
              <dd className="col-span-1 sm:col-span-2">
                {stats.entryCount} 条（含正文 {stats.bodyCount} 条、撤回标记 {stats.withdrawnCount} 条）
              </dd>
            </dl>
            <p className="mt-1 break-all text-[11px] text-(--app-text-subtle)">{stats.path}</p>
          </>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {clearConfirm ? (
          <>
            <span className="text-xs text-(--app-text)">
              确定清除全部公开缓存？已缓存的离线可看内容将被移除。
            </span>
            <button
              type="button"
              className="ui-web-settings-motion rounded-md border border-(--app-accent-strong) px-3 py-1.5 text-xs font-medium text-(--app-accent-strong) transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--app-accent-strong) disabled:cursor-not-allowed disabled:opacity-50"
              disabled={clearing}
              onClick={runClear}
            >
              {clearing ? '正在清除…' : '确认清除'}
            </button>
            <button
              type="button"
              className="ui-web-settings-motion rounded-md border border-(--app-border) px-3 py-1.5 text-xs font-medium text-(--app-text-muted) transition-colors enabled:hover:border-(--app-accent-strong) enabled:hover:text-(--app-accent-strong) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--app-accent-strong) disabled:cursor-not-allowed disabled:opacity-50"
              disabled={clearing}
              onClick={() => setClearConfirm(false)}
            >
              取消
            </button>
          </>
        ) : (
          <button
            type="button"
            className="ui-web-settings-motion rounded-md border border-(--app-border) px-3 py-1.5 text-xs font-medium text-(--app-text-muted) transition-colors enabled:hover:border-(--app-accent-strong) enabled:hover:text-(--app-accent-strong) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--app-accent-strong) disabled:cursor-not-allowed disabled:opacity-50"
            disabled={stats?.status === 'empty' || stats?.status === 'unsupported-schema'}
            onClick={() => setClearConfirm(true)}
          >
            清除公开缓存
          </button>
        )}
      </div>
      {clearMessage ? (
        <p className="mt-2 text-xs text-(--app-text-subtle)" data-testid="public-cache-clear-result">
          {clearMessage}
        </p>
      ) : null}
    </SettingsCard>
  );
};
