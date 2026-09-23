'use client';

import { useRef } from 'react';

import type { ArenaWebPackageSectionModel } from './web-package-contract';

/**
 * 单人与 Proposal 共用的「Web 包」区块组装。
 * 能力差异全部来自 adapter 提供的 capabilities/actions。
 *
 * 产品不变量（规格 §16.1）：
 * - 默认简洁：非 Web 格式只显示格式切换；Web 格式才展开包选择。
 * - 当前选择清楚可见；未选择 = 自由 Web，无「禁用包」选项。
 * - 预设下载按钮独立于选择，避免误触。
 * - 本地导入失败原因与已加载摘要可见。
 * - 多人（capabilities.importLocal=false）不暴露本地包入口。
 */
export function ArenaWebPackageSection({ model }: Readonly<{ model: ArenaWebPackageSectionModel }>) {
  const { capabilities, actions } = model;
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!model.active) {
    return (
      <p className="text-xs text-gray-500">
        当前为 Markdown 战报；切换到 Web 后可选择预设或导入本地 Web 包。
      </p>
    );
  }

  const selectedLabel = model.selected
    ? model.selected.kind === 'local'
      ? `本地：${model.selected.title}`
      : model.selected.title
    : '自由生成网页（未选择 Web 包）';

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
            <p className="mt-0.5 text-xs text-gray-500">{model.selected.summary}</p>
          ) : null}
          {model.localSummary && model.selected?.kind === 'local' ? (
            <p className="mt-0.5 text-xs text-gray-500">{model.localSummary}</p>
          ) : null}
        </div>
        {capabilities.remove && model.selected ? (
          <button
            type="button"
            disabled={model.disabled}
            onClick={actions.remove}
            className="min-h-11 shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
          >
            移除
          </button>
        ) : null}
      </div>

      <div className="space-y-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
            更换 / 选择
          </span>
          <select
            value={model.selected?.digest ?? ''}
            disabled={model.disabled || !capabilities.replace}
            onChange={(event) => actions.select(event.target.value || null)}
            className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
            aria-label="选择 Web 包"
            data-testid="arena-web-package-select"
          >
            <option value="">自由生成网页</option>
            {model.options.map((option) => (
              <option key={option.digest} value={option.digest}>
                {option.kind === 'local' ? `本地：${option.title}` : option.title}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap gap-2">
          {capabilities.downloadPreset && model.selected?.kind === 'builtin' ? (
            <button
              type="button"
              disabled={model.disabled || model.downloading}
              onClick={() => { void actions.downloadPreset(model.selected!.digest); }}
              className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
              data-testid="arena-web-package-download"
            >
              {model.downloading ? '正在准备 ZIP…' : '下载 Web 包 ZIP'}
            </button>
          ) : null}

          {capabilities.importLocal ? (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip,application/zip"
                className="sr-only"
                disabled={model.disabled || model.importing}
                onChange={(event) => { void actions.importFile(event.target.files?.[0]); }}
                aria-label="导入本地 Web 包 ZIP"
                data-testid="arena-web-package-import-input"
              />
              <button
                type="button"
                disabled={model.disabled || model.importing}
                onClick={() => fileInputRef.current?.click()}
                className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
                data-testid="arena-web-package-import"
              >
                {model.importing ? '正在导入…' : '导入本地 ZIP'}
              </button>
            </>
          ) : null}
        </div>

        {model.importError ? (
          <span className="block text-xs text-red-600 dark:text-red-400" role="status" data-testid="arena-web-package-import-error">
            {model.importError}
          </span>
        ) : null}
        {model.downloadError ? (
          <span className="block text-xs text-red-600 dark:text-red-400" role="status" data-testid="arena-web-package-download-error">
            {model.downloadError}
          </span>
        ) : null}
        {!capabilities.importLocal ? (
          <p className="text-xs text-gray-500">
            多人模式仅支持可共享的内置预设；本地 ZIP 包不可进入房间配置。
          </p>
        ) : null}
      </div>
    </div>
  );
}
