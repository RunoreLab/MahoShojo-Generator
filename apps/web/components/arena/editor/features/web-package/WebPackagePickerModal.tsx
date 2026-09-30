'use client';

import { useEffect, useRef, useState } from 'react';
import { HardDrive, Package } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
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

const TAB_STYLE = (active: boolean): string =>
  active ? 'bg-pink-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200';

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
    if (!isOpen) {
      setTab('preset');
      setKeyword('');
    }
    // 多人模式没有本地库：tab 被隐藏后必须把当前页签退回预设，否则内容区空着。
    if (!model.capabilities.importLocal && tab === 'local') setTab('preset');
  }, [isOpen, model.capabilities.importLocal, tab]);

  const disabled = model.disabled || !model.capabilities.replace;
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
          <div className="flex gap-2" role="tablist" aria-label="Web 包来源">
            <button type="button" role="tab" aria-selected={tab === 'preset'} className={`px-4 py-2 rounded text-sm font-medium ${TAB_STYLE(tab === 'preset')}`} onClick={() => setTab('preset')}>
              <span className="inline-flex items-center gap-1.5"><Package className="h-4 w-4" />内置预设 ({presets.length})</span>
            </button>
            {model.capabilities.importLocal ? (
            <button type="button" role="tab" aria-selected={tab === 'local'} className={`px-4 py-2 rounded text-sm font-medium ${TAB_STYLE(tab === 'local')}`} onClick={() => setTab('local')}>
              <span className="inline-flex items-center gap-1.5"><HardDrive className="h-4 w-4" />本地库 ({library.length})</span>
            </button>
          ) : null}
          </div>
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

        {tab === 'preset' || !model.capabilities.importLocal ? (
          <WebPackageCardGrid
            items={search(presets)}
            selectedDigest={model.selected?.digest ?? null}
            disabled={disabled}
            busyDigest={model.busyDigest}
            emptyHint="没有匹配的内置 Web 包预设。"
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
            emptyHint={model.libraryError
              ? '本地库暂时读不出来，这里显示不出已保存的 Web 包。'
              : '还没有本地 Web 包。导入本地 ZIP 即可使用；勾选「导入时保存到本地库」可让它在刷新后依然存在。'}
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
          <p className="text-xs text-gray-500">多人模式仅支持可共享的内置预设；本地 ZIP 包不可进入房间配置。</p>
        )}
      </div>
    </BaseModal>
  );
}
