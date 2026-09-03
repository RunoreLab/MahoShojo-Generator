'use client';

import { useRef, useState, type ChangeEvent } from 'react';

import { DisclosureButton } from '@/components/shared/CollapsibleSection';
import { ArenaMaterialList } from '../../presentation/ArenaMaterialList';

import type { ArenaMaterialSectionModel } from './material-contract';

/**
 * 单人与 Proposal 共用的“素材注入”区块组装。
 * 能力差异全部来自 adapter 提供的 capabilities/actions。
 */
export function ArenaMaterialSection({ model }: Readonly<{ model: ArenaMaterialSectionModel }>) {
  const { capabilities, actions } = model;
  const [isPasteVisible, setIsPasteVisible] = useState(false);
  const [pastedJson, setPastedJson] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    try {
      await actions.upload(event.target.files);
    } catch {
      // 失败原因由 adapter 呈现；文件输入无用户输入可保留，仅需复位。
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const onPaste = async () => {
    try {
      await actions.paste(pastedJson);
      setPastedJson('');
    } catch {
      // 失败原因由 adapter 呈现；保留输入，避免用户重写整段 JSON。
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {capabilities.browseOnline ? (
          <button
            type="button"
            onClick={actions.openModal}
            disabled={model.disabled || !model.hasReferenceCapacity}
            className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            浏览在线数据卡
          </button>
        ) : null}
        {capabilities.clearAll ? (
          <button
            type="button"
            onClick={actions.clearAll}
            disabled={model.disabled || model.items.length === 0}
            className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            清空
          </button>
        ) : null}
        <div className="text-xs text-gray-500">
          {model.statsLine ?? `已选素材 ${model.items.length}`}
        </div>
      </div>

      {model.notice ? <p className="text-xs text-gray-500">{model.notice}</p> : null}

      {capabilities.upload ? (
        <div>
          <label htmlFor="arena-material-upload" className="input-label">
            上传素材 JSON
          </label>
          <input
            ref={inputRef}
            id="arena-material-upload"
            type="file"
            multiple
            accept=".json,application/json"
            onChange={(event) => { void onFileChange(event); }}
            disabled={model.disabled || !model.hasReferenceCapacity}
            className="input-field cursor-pointer file:mr-4 file:rounded-full file:border-0 file:bg-emerald-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-emerald-700 hover:file:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
      ) : null}

      {capabilities.paste ? (
        <div>
          <DisclosureButton
            open={isPasteVisible}
            onToggle={() => setIsPasteVisible((prev) => !prev)}
            disabled={model.disabled || !model.hasReferenceCapacity}
            className="text-emerald-700 hover:underline"
          >
            {isPasteVisible ? '收起素材粘贴区域' : '展开素材粘贴区域'}
          </DisclosureButton>

          {isPasteVisible && (
            <div className="input-group mt-2">
              <textarea
                value={pastedJson}
                onChange={(event) => setPastedJson(event.target.value)}
                placeholder="在此处粘贴一个素材 JSON..."
                className="input-field h-24 resize-y"
                disabled={model.disabled}
              />
              <button
                type="button"
                onClick={() => { void onPaste(); }}
                disabled={!pastedJson.trim() || model.disabled || !model.hasReferenceCapacity}
                className="generate-button mb-0 mt-2"
                style={{
                  backgroundColor: '#059669',
                  backgroundImage: 'linear-gradient(to right, #059669, #10b981)',
                }}
              >
                从文本添加素材
              </button>
            </div>
          )}
        </div>
      ) : null}

      <ArenaMaterialList
        items={model.items}
        disabled={model.disabled}
        onMove={capabilities.reorder ? actions.move : undefined}
        onRemove={actions.remove}
      />
    </div>
  );
}
