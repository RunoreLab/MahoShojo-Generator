'use client';

import { useMemo, useState } from 'react';

import type { ArenaRoomSharedConfig } from '@mahoshojo/contracts/arena-room';

import type { ArenaRoomControllerState } from '@/lib/arena-room/controller';
import {
  dataCardReferenceRequest,
  parseArenaRoomReferenceKey,
  presetReferenceRequest,
  resolveArenaRoomReferenceName,
  useArenaRoomReferenceNames,
  type ArenaRoomReferenceRequest,
} from '@/lib/arena-room/reference-presentation';

import { buttonClassName } from '@/components/shared/ui/Button';

import type { ArenaRoomHostReconciliation } from './useArenaRoomHostReconciliation';
import {
  buildArenaRoomConfigDiffEntries,
  type ArenaConfigDiffEntry,
} from './presentation/config-diff';
import { arenaRoomDirtyReasonCopy } from './presentation/room-copy';

const toneClass: Record<ArenaConfigDiffEntry['tone'], string> = {
  add: 'text-emerald-700 dark:text-emerald-300',
  remove: 'text-red-700 dark:text-red-300',
  change: 'text-amber-800 dark:text-amber-200',
};

const toneMark: Record<ArenaConfigDiffEntry['tone'], string> = {
  add: '＋',
  remove: '－',
  change: '～',
};

const CATEGORY_ORDER: readonly ArenaConfigDiffEntry['category'][] = [
  '角色',
  '行动引导',
  '队伍',
  '主情景',
  '辅助情景',
  '素材',
  '模式与故事',
  '共享历史设置',
];

/** 收集两侧配置中所有引用 key 的名称请求（绑定房间引用版本）。 */
const collectDiffReferenceRequests = (
  configs: readonly (ArenaRoomSharedConfig | null)[],
): ArenaRoomReferenceRequest[] => {
  const requests: ArenaRoomReferenceRequest[] = [];
  const push = (request: ArenaRoomReferenceRequest | null): void => {
    if (request) requests.push(request);
  };
  for (const config of configs) {
    if (!config) continue;
    const pushKey = (key: string, fallbackKind: ArenaRoomReferenceRequest['kind']): void => {
      const parsed = parseArenaRoomReferenceKey(key, fallbackKind);
      if (!parsed) return;
      const entry = config.combatants.find((item) => item.key === key)
        ?? config.auxScenarios.find((item) => item.key === key)
        ?? config.materials.find((item) => item.key === key)
        ?? (config.scenario?.key === key ? config.scenario : undefined);
      const versionToken = entry && 'ref' in entry ? entry.ref.versionToken : undefined;
      push(parsed.source === 'preset'
        ? presetReferenceRequest(parsed.kind, parsed.id, versionToken)
        : dataCardReferenceRequest(parsed.kind, { id: parsed.id, versionToken }));
    };
    for (const entry of config.combatants) {
      if ('ref' in entry) pushKey(entry.key, 'character');
    }
    if (config.scenario && 'ref' in config.scenario) pushKey(config.scenario.key, 'scenario');
    for (const entry of config.auxScenarios) {
      if ('ref' in entry) pushKey(entry.key, 'scenario');
    }
    for (const entry of config.materials) {
      if ('ref' in entry) pushKey(entry.key, 'material');
    }
  }
  return requests;
};

const ConfigDiffSection = ({
  roomConfig,
  localConfig,
  revision,
}: {
  readonly roomConfig: ArenaRoomSharedConfig;
  readonly localConfig: ArenaRoomSharedConfig | null;
  readonly revision: number;
}) => {
  const requests = useMemo(
    () => collectDiffReferenceRequests([roomConfig, localConfig]),
    [roomConfig, localConfig],
  );
  const onlineNames = useArenaRoomReferenceNames(requests);
  const entries = useMemo(() => {
    if (!localConfig) return [];
    return buildArenaRoomConfigDiffEntries(roomConfig, localConfig, (key) => {
      const parsed = parseArenaRoomReferenceKey(key, 'character');
      if (!parsed) return undefined;
      const request = parsed.source === 'preset'
        ? presetReferenceRequest(parsed.kind, parsed.id)
        : dataCardReferenceRequest(parsed.kind, { id: parsed.id });
      if (!request) return undefined;
      const name = resolveArenaRoomReferenceName(request, onlineNames);
      return name ?? undefined;
    });
  }, [roomConfig, localConfig, onlineNames]);

  const grouped = CATEGORY_ORDER
    .map((category) => ({
      category,
      items: entries.filter((entry) => entry.category === category),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <section aria-labelledby="arena-host-config-diff-heading" className="mt-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-950">
      <div className="flex items-center justify-between gap-3 border-b pb-3 dark:border-gray-800">
        <div>
          <h3 id="arena-host-config-diff-heading" className="font-semibold text-gray-950 dark:text-gray-100">
            与房间当前设置相比，本地修改了
          </h3>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            仅展示可共享的设置，不包含房主本地正文。
          </p>
        </div>
      </div>
      {grouped.length === 0 ? (
        <p className="pt-3 text-sm text-gray-600 dark:text-gray-400">没有可展示的差异。</p>
      ) : (
        <div className="space-y-3 pt-3">
          {grouped.map((group) => (
            <div key={group.category}>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">{group.category}</p>
              <ul className="mt-1 space-y-1 text-sm">
                {group.items.map((entry) => (
                  <li key={entry.id} className={toneClass[entry.tone]}>
                    <span aria-hidden="true" className="mr-1.5 font-mono">{toneMark[entry.tone]}</span>
                    {entry.label}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      <details className="mt-3 border-t pt-2 dark:border-gray-800">
        <summary className="cursor-pointer select-none text-xs text-gray-600 dark:text-gray-400">技术详情</summary>
        <div className="mt-2 grid gap-3 lg:grid-cols-2">
          <div>
            <h4 className="text-xs font-semibold text-gray-600 dark:text-gray-400">当前房间 · 配置版本 {revision}</h4>
            <pre className="mt-1 overflow-auto rounded-lg bg-gray-950 p-3 text-xs text-gray-100">{JSON.stringify(roomConfig, null, 2)}</pre>
          </div>
          <div>
            <h4 className="text-xs font-semibold text-gray-600 dark:text-gray-400">本地编辑草稿</h4>
            <pre className="mt-1 overflow-auto rounded-lg bg-gray-950 p-3 text-xs text-gray-100">{localConfig ? JSON.stringify(localConfig, null, 2) : '当前本地草稿无法转换为可共享配置'}</pre>
          </div>
        </div>
      </details>
    </section>
  );
};

export function ArenaHostConfigPanel({
  controllerState,
  reconciliation,
}: {
  readonly controllerState: ArenaRoomControllerState;
  readonly reconciliation: ArenaRoomHostReconciliation;
}) {
  const [diffOpen, setDiffOpen] = useState(false);
  const session = controllerState.session;
  if (!session || session.self.role !== 'host') return null;
  const status = reconciliation.state;
  const busy = status.kind === 'synchronizing'
    || controllerState.configPublishPending
    || controllerState.configPublishResultUnknown;

  return (
    <section aria-labelledby="arena-host-config-heading" className="rounded-xl border border-fuchsia-200 bg-white/70 p-3 dark:border-fuchsia-900 dark:bg-gray-900/60">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id="arena-host-config-heading" className="text-sm font-semibold text-gray-950 dark:text-gray-100">房间配置</h3>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            本地编辑不会实时同步；开始生成时会检查本地与房间设置是否一致，有差异会先请你确认。
          </p>
        </div>
        <button
          type="button"
          className={buttonClassName({ variant: status.kind === 'error' ? 'secondary' : 'primary' })}
          disabled={busy}
          onClick={() => { void reconciliation.publishLocal(); }}
        >
          {status.kind === 'synchronizing' && status.action === 'publish'
            ? '正在更新…'
            : '更新房间配置'}
        </button>
      </div>

      {status.kind === 'synced' ? (
        <p role="status" className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">
          {status.message}
        </p>
      ) : status.kind === 'error' ? (
        <div
          role="alert"
          data-error-code={status.code}
          className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-950 dark:border-red-800 dark:bg-red-950/30 dark:text-red-100"
        >
          <p className="font-medium">{status.message}</p>
          <p className="mt-1 text-xs opacity-90">
            本地与房间设置的同步结果不确定；请先重试同步房间设置，恢复后再继续生成或发布。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonClassName({ variant: 'primary' })}
              disabled={busy}
              onClick={() => { void reconciliation.syncRoom(); }}
            >
              重试同步房间配置
            </button>
          </div>
        </div>
      ) : status.kind === 'synchronizing' && status.action !== 'publish' ? (
        <p role="status" className="mt-3 text-sm text-gray-700 dark:text-gray-300">正在同步当前房间设置…</p>
      ) : null}

      {status.kind === 'conflicted' ? (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          <p className="font-medium">房间设置已更新，而本地还有未发布的修改。</p>
          <ul className="mt-2 list-disc pl-5 text-xs">
            {status.reasons.map((reason) => <li key={reason}>{arenaRoomDirtyReasonCopy[reason]}</li>)}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={buttonClassName()} disabled={busy} onClick={() => { void reconciliation.syncRoom(); }}>
              同步房间配置
            </button>
            <button type="button" className={buttonClassName()} onClick={() => setDiffOpen((open) => !open)}>
              {diffOpen ? '收起差异' : '查看差异'}
            </button>
            <button type="button" className={buttonClassName({ variant: 'primary' })} disabled={busy} onClick={() => { void reconciliation.publishLocal(); }}>
              保留本地修改并重新发布
            </button>
          </div>
        </div>
      ) : null}

      {diffOpen && status.kind === 'conflicted' ? (
        <ConfigDiffSection
          roomConfig={status.roomConfig}
          localConfig={status.localConfig}
          revision={status.revision}
        />
      ) : null}
    </section>
  );
}
