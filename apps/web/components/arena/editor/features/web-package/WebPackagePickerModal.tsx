'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { HardDrive, Package } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import { ModalTabs, modalTabIds } from '@/components/shared/ModalTabs';
import { WebPackageBaseRisk } from '@/components/arena/components/WebPackageSafety';
import { WebPackageCardGrid, type WebPackageCardItem } from './WebPackageCardGrid';
import { LocalLibrarySavePreference } from '@/components/shared/LocalLibrarySavePreference';
import { LocalLibraryStatusNote } from '@/components/shared/LocalLibraryStatusNote';
import type { ArenaWebPackageOptionView, ArenaWebPackageSectionModel } from './web-package-contract';

const toCardItem = (option: ArenaWebPackageOptionView): WebPackageCardItem => ({
  digest: option.digest,
  title: option.title,
  summary: option.summary ?? '',
  identity: option.ref ? `${option.ref.id}@${option.ref.version}` : '',
  source: option.kind === 'builtin' ? 'builtin' : 'local',
  broken: option.broken === true,
  sessionOnly: option.sessionOnly === true,
});

type PickerTab = 'preset' | 'local';

/** 这个弹窗此前没有任何百科入口，用户无法自查「Web 包是什么」「授权意味着什么」。 */
const WEB_REPORT_HREF = '/encyclopedia/web-report';

/** 多人模式没有本地库，页签只剩预设一个。 */
const TAB_ORDER: readonly PickerTab[] = ['preset', 'local'];

/** 同时喂给 ModalTabs 的 idPrefix 和下面 tabpanel 的 id，两边必须同源。 */
const TAB_ID_PREFIX = 'web-package-source';

/**
 * Web 包选择模态框。
 *
 * 复用 `BattleDataModal` 的产品模式（tab 壳 + 搜索 + 卡片网格 + 分页），但保持独立：
 * Web 包不是数据卡，把它塞进 `BattleDataModal` 会让那个组件的 `onSelectCard(payload)`
 * 契约分裂，也会让与 Arena 无关的页面冒出一个本地 ZIP 入口。
 */
export function WebPackagePickerModal({
  isOpen,
  onClose,
  model,
  onRemoveFromLibrary,
  onViewDetails,
}: {
  isOpen: boolean;
  onClose: () => void;
  model: ArenaWebPackageSectionModel;
  /** 需要二次确认的删除目标；null 表示当前没有待确认项。 */
  onRemoveFromLibrary: (digest: string) => void;
  onViewDetails: (digest: string) => void;
}) {
  const [tab, setTab] = useState<PickerTab>('preset');
  const [keyword, setKeyword] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) return;
    setTab('preset');
    setKeyword('');
  }, [isOpen]);

  const disabled = model.disabled || !model.capabilities.replace;
  const TABS = model.capabilities.importLocal ? TAB_ORDER : TAB_ORDER.slice(0, 1);
  // 多人模式没有本地库，页签被隐藏后必须把当前页签退回预设。只在这里兜一道：
  // 再往 effect 里加一条 setTab 就等于让 activeTab 和 tab 各自决定一次渲染内容。
  const activeTab: PickerTab = TABS.includes(tab) ? tab : 'preset';
  const { tabId: activeTabId, panelId: activePanelId } = modalTabIds(TAB_ID_PREFIX, activeTab);
  const presets = model.presets.map(toCardItem);
  const library = model.library.map(toCardItem);
  const search = (items: WebPackageCardItem[]): WebPackageCardItem[] => {
    const needle = keyword.trim().toLowerCase();
    if (!needle) return items;
    // 身份单列匹配：内置预设的 summary 是描述，光搜 title+summary 会让搜索框
    // 承诺的「id@version」对预设完全失效。
    return items.filter((item) => `${item.title} ${item.summary} ${item.identity}`.toLowerCase().includes(needle));
  };

  return (
    <BaseModal
      isOpen={isOpen}
      title="选择 Web 包"
      titleId="web-package-picker-title"
      description="内置预设随应用分发；本地库中的包只保存在这台设备，可随时删除或导出。"
      maxWidthClassName="max-w-5xl"
      onClose={onClose}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ModalTabs
            idPrefix={TAB_ID_PREFIX}
            ariaLabel="Web 包来源"
            items={TABS.map((option) => ({
              value: option,
              label: (
                <span className="inline-flex items-center gap-1.5">
                  {option === 'preset' ? <Package className="h-4 w-4" /> : <HardDrive className="h-4 w-4" />}
                  {option === 'preset' ? '内置预设' : '本地库'}
                </span>
              ),
              count: option === 'preset' ? presets.length : library.length,
            }))}
            value={activeTab}
            onValueChange={setTab}
          />
          <input
            type="search"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索 Web 包名称或 id@version"
            aria-label="搜索 Web 包"
            className="input-field !py-2 w-full sm:w-64"
          />
        </div>

        {model.selected?.ref ? <WebPackageBaseRisk packageRef={model.selected.ref} /> : null}

        {/* tabpanel 与 tab 一一对应；预设页签在多人模式下没有本地库，panel 仍指向它。 */}
        <div
          role="tabpanel"
          id={activePanelId}
          aria-labelledby={activeTabId}
        >
        {activeTab === 'preset' ? (
          <WebPackageCardGrid
            items={search(presets)}
            selectedDigest={model.selected?.digest ?? null}
            disabled={disabled}
            busyDigest={model.busyDigest}
            downloadingDigest={model.downloadingDigest}
            emptyHint={(
              <div className="space-y-3">
                <p>
                  {keyword.trim()
                    ? '没有匹配的内置 Web 包预设。'
                    : '当前没有内置 Web 包预设。'}
                </p>
                <p className="text-xs leading-5 text-gray-500">
                  {keyword.trim()
                    ? '换个关键词或清空搜索框再试。也可以切到「本地库」导入自己的 ZIP。'
                    : '可以切到「本地库」页签导入自己的 ZIP：包是「引擎 + 素材」，AI 只生成包指定的那一个数据文件。'}
                </p>
                <p className="text-xs">
                  <Link className="underline hover:text-gray-700" href={WEB_REPORT_HREF}>这是什么？</Link>
                </p>
              </div>
            )}
            onSelect={(digest) => { model.actions.select(digest); onClose(); }}
            onDownload={model.capabilities.downloadPreset
              ? (item) => { void model.actions.downloadPreset(item.digest); }
              : undefined}
            onViewDetails={(item) => onViewDetails(item.digest)}
          />
        ) : (
          <>
          <WebPackageCardGrid
            items={search(library)}
            selectedDigest={model.selected?.digest ?? null}
            disabled={disabled}
            busyDigest={model.busyDigest}
            downloadingDigest={model.downloadingDigest}
            emptyHint={model.libraryError ? (
              <div className="space-y-3">
                <p>本地库暂时读不出来，这里显示不出已保存的 Web 包。</p>
                <p className="text-xs leading-5 text-gray-500">
                  这不代表已保存的 Web 包被删除。先重试；仍失败请检查浏览器是否允许本站使用本地存储。
                </p>
                <button
                  type="button"
                  onClick={model.actions.reloadLibrary}
                  className="inline-flex min-h-11 items-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                >
                  重新读取本地库
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <p>{keyword.trim() ? '没有匹配的本地 Web 包。' : '还没有本地 Web 包。'}</p>
                <p className="text-xs leading-5 text-gray-500">
                  导入本地 ZIP 即可使用。导入默认只对本次会话有效，勾选「导入时保存到本地库」可以让它在刷新后依然存在。
                </p>
                {model.capabilities.importLocal ? (
                  <button
                    type="button"
                    disabled={model.disabled || model.importing}
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex min-h-11 items-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                  >
                    {model.importing ? '正在导入…' : '导入本地 ZIP'}
                  </button>
                ) : null}
                <p className="text-xs">
                  <Link className="underline hover:text-gray-700" href={WEB_REPORT_HREF}>Web 战报与 Web 包说明</Link>
                </p>
              </div>
            )}
            onSelect={(digest) => { model.actions.select(digest); onClose(); }}
            onDownload={(item) => { void model.actions.downloadFromLibrary(item.digest); }}
            // sessionOnly 的包没有本地库行可删；给它一个删除按钮只会是假动作。
            onDelete={model.capabilities.manageLibrary
              ? (item) => { if (!item.sessionOnly) onRemoveFromLibrary(item.digest); }
              : undefined}
            deletable={(item) => !item.sessionOnly}
            onViewDetails={(item) => onViewDetails(item.digest)}
          />
          <LocalLibraryStatusNote />
          </>
        )}
        </div>

        {model.importFeedback ? (
          <div className="space-y-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="status" data-testid="web-package-import-feedback">
            {model.importFeedback.message ? <p>{model.importFeedback.message}</p> : null}
            {model.importFeedback.hint ? <p className="text-red-600">{model.importFeedback.hint}</p> : null}
            {model.importFeedback.diagnostics.length > 0 ? (
              <ul className="list-disc pl-5 text-xs text-gray-600">
                {model.importFeedback.diagnostics.map((note: string) => <li key={note}>{note}</li>)}
              </ul>
            ) : null}
          </div>
        ) : null}
        {model.downloadError ? <p className="text-sm text-red-600" role="status">{model.downloadError}</p> : null}
        {model.libraryError ? (
          <p className="text-sm text-red-600" role="status" data-testid="web-package-library-error">
            本地库读取失败：{model.libraryError}
            <span className="mt-0.5 block text-xs text-red-500">
              这不代表已保存的 Web 包被删除；请检查浏览器是否允许本站使用本地存储后重试。
            </span>
            {model.capabilities.manageLibrary ? (
              <button
                type="button"
                onClick={model.actions.reloadLibrary}
                className="mt-2 inline-flex min-h-11 items-center rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
              >
                重新读取本地库
              </button>
            ) : null}
          </p>
        ) : null}

        {model.capabilities.importLocal ? (
          <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip,application/zip"
                className="sr-only"
                disabled={model.disabled || model.importing}
                onChange={(event) => {
                  void model.actions.importFile(event.target.files?.[0]);
                  event.target.value = '';
                }}
                aria-label="导入本地 Web 包 ZIP"
                data-testid="web-package-import-input"
              />
              <button
                type="button"
                disabled={model.disabled || model.importing}
                onClick={() => fileInputRef.current?.click()}
                className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 hover:bg-gray-50 disabled:opacity-50"
                data-testid="web-package-import"
              >
                {model.importing ? '正在导入…' : '导入本地 ZIP'}
              </button>
              <p className="text-xs text-gray-500">ZIP 在本浏览器解析并受限运行，不向服务器上传完整包。</p>
            </div>
            <LocalLibrarySavePreference
              checked={model.saveImportedToLibrary}
              onChange={model.actions.setSaveImportedToLibrary}
              disabled={model.disabled}
              label="导入时保存到本地库"
            />
          </div>
        ) : (
          <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3 text-xs leading-5 text-gray-600">
            <p>多人模式仅支持可共享的内置预设；本地 ZIP 包不可进入房间配置。</p>
            <p className="mt-1 text-gray-500">需要导入自己的 Web 包时，请在单人模式下打开选择器。</p>
          </div>
        )}
      </div>
    </BaseModal>
  );
}
