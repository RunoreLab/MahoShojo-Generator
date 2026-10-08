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
 * 文案必须持续讲清三件事：
 * - 这是**派生缓存**——存的是「在线读到过的公开资料副本」，清除只意味着
 *   缓存内容变少，正式本地库与用户数据不受影响；K1 不提供缓存内容的
 *   直接展示（离线浏览属 K2），不得暗示已经能离线查看；
 * - 三个策略字段与 `OnlineSettingsSection` 读同一份 config snapshot，
 *   这里的控件不产生第二份默认值；
 * - 「自动清理最久未用」与「调低到低于当前用量的上限」会真实删除已缓存
 *   副本——两者都必须经用户显式确认后才写回配置（K1-r1）。
 */

const MIB = 1024 * 1024;

const BUDGET_PRESETS: ReadonlyArray<{ value: string; label: string; bytes: DesktopPublicCacheBudget }> = [
  { value: '128', label: '128 MiB', bytes: 128 * MIB },
  { value: '256', label: '256 MiB（默认）', bytes: 256 * MIB },
  { value: '512', label: '512 MiB', bytes: 512 * MIB },
  { value: '1024', label: '1 GiB', bytes: 1024 * MIB },
  { value: '4096', label: '4 GiB', bytes: 4096 * MIB },
  { value: 'unlimited', label: '不设上限', bytes: 'unlimited' },
];

const WHEN_FULL_OPTIONS: ReadonlyArray<{ value: DesktopPublicCacheWhenFull; label: string }> = [
  { value: 'pause', label: '暂停写入（默认）' },
  { value: 'evict-least-recently-used', label: '自动清理最久未用' },
];

const formatBytes = (bytes: number): string => {
  if (bytes >= 1024 * MIB) return `${(bytes / (1024 * MIB)).toFixed(1)} GiB`;
  if (bytes >= MIB) return `${(bytes / MIB).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
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

/**
 * 待用户确认的「会删除已缓存副本」的变更。只记意图不落盘——确认按钮
 * 才真正 `setField`，取消则什么也不发生。
 */
type PendingChange =
  | { readonly kind: 'evict' }
  | {
      readonly kind: 'budget';
      readonly bytes: number;
      /** 统计读不到时为 null——确认文案按「用量未知」如实表述。 */
      readonly usageBytes: number | null;
      readonly entryCount: number | null;
      readonly bodyCount: number | null;
    };

export const PublicCacheSettingsCard = () => {
  const { state, editable, setField } = useDesktopConfig();
  const [statsState, setStatsState] = useState<StatsState>({ status: 'idle' });
  const [clearConfirm, setClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearMessage, setClearMessage] = useState<string | null>(null);
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(null);
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
        // `freedBytes` 是逻辑占用口径——SQLite 文件是否立刻收缩由系统
        // 决定，不承诺物理磁盘空间立即回收。
        setClearMessage(
          `已清除 ${result.removedEntries} 条缓存记录，逻辑占用减少 ${formatBytes(result.freedBytes)}（磁盘空间由系统按需回收）。`,
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
  const unlimitedBudget = state.values.publicCacheMaxBytes === 'unlimited';

  /** 调低上限且当前策略是自动清理时，超出的旧副本会被真实删除——要求确认；
   *  统计读不到时按「用量未知」同样先确认，不静默授权删除。 */
  const chooseBudget = (value: string) => {
    const preset = BUDGET_PRESETS.find((option) => option.value === value);
    if (!preset) return;
    if (
      preset.bytes !== 'unlimited'
      && state.values.publicCacheWhenFull === 'evict-least-recently-used'
      && (!stats || stats.usageBytes > preset.bytes)
    ) {
      setPendingChange({
        kind: 'budget',
        bytes: preset.bytes,
        usageBytes: stats?.usageBytes ?? null,
        entryCount: stats?.entryCount ?? null,
        bodyCount: stats?.bodyCount ?? null,
      });
      return;
    }
    setField('publicCacheMaxBytes', preset.bytes);
  };

  /** 开启自动清理 = 授权系统在满额时删除旧副本——要求确认；暂停策略随时可回。 */
  const chooseWhenFull = (value: DesktopPublicCacheWhenFull) => {
    if (value === 'evict-least-recently-used' && state.values.publicCacheWhenFull !== value) {
      setPendingChange({ kind: 'evict' });
      return;
    }
    setField('publicCacheWhenFull', value);
  };

  const confirmPendingChange = () => {
    const change = pendingChange;
    setPendingChange(null);
    if (change?.kind === 'evict') {
      setField('publicCacheWhenFull', 'evict-least-recently-used');
    } else if (change?.kind === 'budget') {
      setField('publicCacheMaxBytes', change.bytes);
    }
  };

  return (
    <SettingsCard
      title="公开资料缓存"
      description="把在线读到过的公开资料副本缓存在本机（public-read-cache.sqlite），为后续离线浏览能力积累内容；当前版本不直接展示缓存内容。这是派生数据：清除只移除缓存副本，不影响本地库与你的数据。"
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
          缓存配置无法校验，已按「暂停捕获、不淘汰」生效——修复配置文件、恢复默认或
          「创建默认配置」（见下方配置文件卡）后生效。
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
            onChange={chooseBudget}
            disabled={!editable || configBusy}
            ariaLabel="缓存大小上限"
          />
        }
      />
      <SettingsFieldRow
        label="达到上限时"
        description={
          unlimitedBudget
            ? '缓存不设上限时该策略不适用——不会因容量满而暂停或淘汰。'
            : '默认暂停写入、保留已缓存内容；可选自动清理最久未使用的条目。'
        }
        control={
          <SettingsOptionButtons
            value={state.values.publicCacheWhenFull}
            options={WHEN_FULL_OPTIONS}
            onChange={chooseWhenFull}
            disabled={!editable || configBusy || unlimitedBudget}
            ariaLabel="达到上限时的处理策略"
          />
        }
      />

      {pendingChange ? (
        <div
          role="alert"
          className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-(--app-border) px-3 py-2"
          data-testid="public-cache-eviction-confirm"
        >
          <span className="text-xs text-(--app-text)">
            {pendingChange.kind === 'evict'
              ? '开启后，缓存达到上限时将自动删除最久未使用的公开缓存副本以容纳新内容。确认开启自动清理？'
              : pendingChange.usageBytes === null
                ? `当前缓存用量暂时无法读取；若实际用量超过新上限 ${formatBytes(pendingChange.bytes)}，最久未用的副本将被删除。确认调低上限？`
                : `新上限 ${formatBytes(pendingChange.bytes)} 低于当前已缓存用量 ${formatBytes(pendingChange.usageBytes)}；当前缓存 ${pendingChange.entryCount ?? 0} 条（含正文 ${pendingChange.bodyCount ?? 0} 条），其中超出新上限的最久未用副本将被删除。确认调低上限？`}
          </span>
          <button
            type="button"
            className="ui-web-settings-motion rounded-md border border-(--app-accent-strong) px-3 py-1.5 text-xs font-medium text-(--app-accent-strong) transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--app-accent-strong)"
            onClick={confirmPendingChange}
          >
            确认
          </button>
          <button
            type="button"
            className="ui-web-settings-motion rounded-md border border-(--app-border) px-3 py-1.5 text-xs font-medium text-(--app-text-muted) transition-colors enabled:hover:border-(--app-accent-strong) enabled:hover:text-(--app-accent-strong) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--app-accent-strong)"
            onClick={() => setPendingChange(null)}
          >
            取消
          </button>
        </div>
      ) : null}

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
                {stats.entryCount} 条（含正文 {stats.bodyCount} 条）；撤回标记 {stats.withdrawnCount} 条
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
              确定清除全部公开缓存？已缓存的公开资料副本将全部移除。
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
