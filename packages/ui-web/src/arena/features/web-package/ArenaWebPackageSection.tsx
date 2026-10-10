'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { HardDrive, Package, Settings2 } from 'lucide-react';
import { BaseModal } from '../../../modal';
import { WebPackagePickerModal } from './WebPackagePickerModal';
import { resolveWebPackageViewHost, type ArenaWebPackageViewHost } from './web-package-host';
import type { ArenaWebPackageOptionView, ArenaWebPackageSectionModel } from './web-package-contract';

/**
 * 单人与 Proposal 共用的「Web 包」区块。
 *
 * 区块本身只保留三件事：当前选择是什么、有没有风险提示、如何打开选择器。
 * 网格、搜索、导入、删除等交互都移进 `WebPackagePickerModal`——它们在"生成方式"
 * 折叠区块里没有任何价值，却把折叠面板撑得很长。
 *
 * 产品不变量（规格 §16.1）：
 * - 默认简洁：非 Web 格式只显示格式切换；Web 格式才展开包选择。
 * - 当前选择清楚可见；未选择 = 自由 Web，无「禁用包」选项。
 * - 多人（capabilities.importLocal=false）不暴露本地包入口。
 * - 预设下载入口与选择卡片分离，避免误触。
 */
export function ArenaWebPackageSection({ model, host: hostInput }: Readonly<{ model: ArenaWebPackageSectionModel; host?: ArenaWebPackageViewHost }>) {
  const host = resolveWebPackageViewHost(hostInput);
  const { capabilities, actions } = model;
  // Hook 必须无条件调用。早退放在它们之后：反过来的话，同一组件在 Markdown 与 Web
  // 之间来回切换时 Hook 顺序会变，React 会直接抛错，已有状态也会错位。
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingRemoval, setPendingRemovalState] = useState<string | null>(null);
  const removalEpoch = useRef(0);
  const removalInFlight = useRef(false);
  const [removalError, setRemovalError] = useState<string | null>(null);
  const setPendingRemoval = useCallback((digest: string | null) => {
    removalEpoch.current += 1;
    setRemovalError(null);
    setPendingRemovalState(digest);
  }, []);
  useEffect(() => () => { removalEpoch.current += 1; }, []);
  const [detailDigest, setDetailDigest] = useState<string | null>(null);
  useEffect(() => {
    if (!model.active || !capabilities.replace) {
      setPickerOpen(false);
      setDetailDigest(null);
      setPendingRemoval(null);
    } else if (!capabilities.manageLibrary) {
      setPendingRemoval(null);
    }
  }, [model.active, capabilities.replace, capabilities.manageLibrary, setPendingRemoval]);
  // 待确认的 digest 必须随列表失效一起清掉：否则记录从库里消失后 pendingRemoval 仍留着，
  // 等同一条记录再次出现时确认框会毫无征兆地重新弹出来。
  useEffect(() => {
    if (pendingRemoval && !model.library.some((option) => option.digest === pendingRemoval)) {
      setPendingRemoval(null);
    }
  }, [model.library, pendingRemoval, setPendingRemoval]);
  useEffect(() => {
    if (!detailDigest) return;
    const stillListed = [...model.presets, ...model.library]
      .some((option) => option.digest === detailDigest);
    if (!stillListed) setDetailDigest(null);
  }, [model.presets, model.library, detailDigest]);
  if (!model.active) {
    return (
      <p className="text-xs text-gray-500">
        {host.copy.inactiveMessage}
      </p>
    );
  }

  const selectedLabel = model.selected
    ? model.selected.kind === 'local'
      ? `本地：${model.selected.title}`
      : model.selected.title
    : '自由生成网页（未选择 Web 包）';
  const removalTarget = pendingRemoval
    ? model.library.find((option: ArenaWebPackageOptionView) => option.digest === pendingRemoval) ?? null
    : null;
  const detailOption = detailDigest
    ? [...model.presets, ...model.library].find((option: ArenaWebPackageOptionView) => option.digest === detailDigest) ?? null
    : null;
  // summary 对内置预设是描述、对本地库才是身份；混在一行里会出现"身份"标签下
  // 放着一段描述、而真正的 id@version 从头到尾没被展示过的情况。
  const detailIdentity = detailOption?.ref ? `${detailOption.ref.id}@${detailOption.ref.version}` : null;
  const detailDescription = detailOption?.summary && detailOption.summary !== detailIdentity
    ? detailOption.summary
    : null;
  const detailOrigin = !detailOption
    ? ''
    : detailOption.kind === 'builtin'
      ? '内置预设（随应用分发，不可删除）'
      : detailOption.sessionOnly
        ? host.copy.sessionOrigin
        : '本机本地库（可删除、可导出）';

  return (
    <div className="space-y-3" data-testid="arena-web-package-section">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <span className="mb-1 block font-medium" id="arena-web-package-current-label">
            Web 包
          </span>
          <p
            className="truncate text-sm text-gray-800 dark:text-gray-100"
            aria-labelledby="arena-web-package-current-label"
            data-testid="arena-web-package-selected"
          >
            {selectedLabel}
          </p>
          {model.selected?.summary ? (
            <p className="mt-0.5 text-xs break-words text-gray-500">{model.selected.summary}</p>
          ) : null}
          {model.selected?.kind === 'local' ? (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-gray-500">
              <HardDrive className="h-3 w-3" />
              {model.selected.sessionOnly
                ? host.copy.sessionNote
                : host.copy.libraryNote}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {capabilities.remove && model.selected ? (
            <button
              type="button"
              disabled={model.disabled}
              onClick={actions.remove}
              className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:ring-pink-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
            >
              移除选择
            </button>
          ) : null}
          <button
            type="button"
            // 打开模态框是只读动作：生成期间仍要能进去拿预设 ZIP 或查看本地库，
            // 真正会改变状态的选择/移除在网格里单独按 disabled 收口。
            disabled={!capabilities.replace}
            onClick={() => setPickerOpen(true)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-pink-300 bg-pink-50 px-3 py-2 text-sm text-pink-800 hover:bg-pink-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:ring-pink-500 disabled:opacity-50 dark:border-pink-700 dark:bg-pink-950/40 dark:text-pink-100"
            data-testid="arena-web-package-open-picker"
          >
            {model.selected ? (
              <Settings2 className="h-4 w-4" />
            ) : (
              <Package className="h-4 w-4" />
            )}
            {model.selected ? '更换 Web 包' : '选择 Web 包'}
          </button>
        </div>
      </div>

      {model.selected?.ref ? host.renderRisk?.(model.selected.ref) : null}

      {!capabilities.importLocal ? (
        <p className="text-xs text-gray-500">多人模式仅支持可共享的内置预设；本地 ZIP 包不可进入房间配置。</p>
      ) : null}

      {/* 这个区块是用户第一次接触 Web 包的地方，此前没有任何百科入口，
          「自由生成网页（未选择 Web 包）」和「Web 包」的关系无处可查。 */}
      <p className="text-xs text-gray-500">
        不选包就是让 AI 自由生成一个网页；选包则由包提供引擎与素材、AI 只生成那一个数据文件。
        {host.renderHelpLink?.('Web 战报说明')}
      </p>

      <WebPackagePickerModal
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        model={model}
        host={hostInput}
        // 删除确认与详情互斥：两者都挂在选择器之上，同时打开就会出现两个同层 z-50
        // 对话框争抢绘制顺序与键盘焦点。
        onRemoveFromLibrary={(digest) => { setDetailDigest(null); setPendingRemoval(digest); }}
        onViewDetails={(digest) => { setPendingRemoval(null); setDetailDigest(digest); }}
      />

      <BaseModal
        isOpen={removalTarget !== null}
        title="从本地库删除这个 Web 包？"
        titleId="web-package-remove-title"
        maxWidthClassName="max-w-lg"
        closeOnBackdrop={model.busyDigest === null}
        onClose={() => { if (model.busyDigest === null) setPendingRemoval(null); }}
        footer={(
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200"
              disabled={model.busyDigest !== null}
              onClick={() => setPendingRemoval(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-50"
              disabled={model.disabled || model.busyDigest !== null}
              onClick={() => {
                if (!pendingRemoval || model.disabled || model.busyDigest !== null || removalInFlight.current) return;
                const epoch = removalEpoch.current;
                removalInFlight.current = true;
                void model.actions.removeFromLibrary(pendingRemoval).then((outcome) => {
                  if (epoch === removalEpoch.current && outcome !== 'cancelled' && outcome !== 'failed') setPendingRemoval(null);
                }).catch(() => {
                  if (epoch === removalEpoch.current) setRemovalError('删除未完成，请重试或查看本地库状态。');
                }).finally(() => { removalInFlight.current = false; });
              }}
            >
              {model.busyDigest !== null ? '正在删除…' : '删除'}
            </button>
          </div>
        )}
      >
        <div className="space-y-1.5 text-sm text-gray-700 dark:text-gray-200">
          {removalError ? <p role="alert">{removalError}</p> : null}
          {(removalTarget ? host.describeRemoval(removalTarget) : []).map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      </BaseModal>

      <BaseModal
        isOpen={detailOption !== null}
        title={detailOption?.title ?? ''}
        titleId="web-package-detail-title"
        maxWidthClassName="max-w-2xl"
        onClose={() => setDetailDigest(null)}
      >
        <dl className="space-y-2 text-sm">
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-gray-500">来源</dt>
            <dd>{detailOrigin}</dd>
          </div>
          {detailIdentity ? (
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-gray-500">身份</dt>
              <dd className="break-all font-mono text-xs">{detailIdentity}</dd>
            </div>
          ) : null}
          {detailDescription ? (
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-gray-500">描述</dt>
              <dd className="break-words">{detailDescription}</dd>
            </div>
          ) : null}
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-gray-500">内容摘要</dt>
            <dd className="break-all font-mono text-xs">{detailOption?.digest}</dd>
          </div>
          {typeof detailOption?.byteLength === 'number' ? (
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-gray-500">ZIP 体积</dt>
              <dd>{(detailOption.byteLength / 1024).toFixed(1)} KB</dd>
            </div>
          ) : null}
          {detailOption?.broken ? (
            <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              本地库中的这条记录已找不到对应的 ZIP 字节，无法再用于生成；可以删除后重新导入。
            </p>
          ) : null}
        </dl>
      </BaseModal>
    </div>
  );
}
