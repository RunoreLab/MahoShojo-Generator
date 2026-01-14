import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { formatKilobytes, MAX_DATA_CARD_BYTES } from '@/lib/data-card-size';
import { buildTavernCloudSavePayload, type TavernCloudSavePreset } from '@/lib/tavern-card';
import type { User } from '@/lib/useAuth';

interface TavernCloudSaveModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
  baseDataCard: unknown;
  defaultName: string;
  defaultDescription: string;
  saving: boolean;
  error: string | null;
  onSave: (payload: {
    preset: TavernCloudSavePreset;
    name: string;
    description: string;
    isPublic: number;
    data: unknown;
    estimatedBytes: number;
  }) => void | Promise<void>;
}

const PRESET_LABELS: Record<TavernCloudSavePreset, string> = {
  standard: '标准（保留更多文本）',
  light: '轻量（推荐）',
  minimal: '极限（移除对话样例 + 精简元信息）',
};

const PRESET_DESCRIPTIONS: Record<TavernCloudSavePreset, string> = {
  standard: '仅强制移除 `_tavern.raw`，其余字段保持原样。可能超出 300KB。',
  light: '对常见大字段做截断（mes_example/description/scenario 等），在可读性与体积之间取平衡。',
  minimal: '进一步移除 mes_example，并把 `_tavern.meta` 精简为可溯源信息（spec/sourceChunk 等）。',
};

export function TavernCloudSaveModal({
  isOpen,
  onClose,
  user,
  baseDataCard,
  defaultName,
  defaultDescription,
  saving,
  error,
  onSave,
}: TavernCloudSaveModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(0);
  const [preset, setPreset] = useState<TavernCloudSavePreset>('standard');

  useEffect(() => {
    if (!isOpen) return;
    setName((defaultName || '').trim().slice(0, 20));
    setDescription((defaultDescription || '').trim().slice(0, 300));
    setIsPublic(0);
    setPreset('standard');
  }, [defaultDescription, defaultName, isOpen]);

  const candidates = useMemo(() => {
    if (!isOpen) return null;
    if (!user) return null;
    const author = { id: user.id, username: user.username };
    const standard = buildTavernCloudSavePayload(baseDataCard, author, 'standard');
    const light = buildTavernCloudSavePayload(baseDataCard, author, 'light');
    const minimal = buildTavernCloudSavePayload(baseDataCard, author, 'minimal');
    return { standard, light, minimal } as const;
  }, [baseDataCard, isOpen, user]);

  useEffect(() => {
    if (!isOpen) return;
    if (!candidates) return;
    const standard = candidates.standard;
    if ('error' in standard) return;
    if (!standard.overLimit) return;

    const light = candidates.light;
    if (!('error' in light) && !light.overLimit) {
      setPreset('light');
      return;
    }

    const minimal = candidates.minimal;
    if (!('error' in minimal) && !minimal.overLimit) {
      setPreset('minimal');
    }
  }, [candidates, isOpen]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const currentCandidate = candidates ? candidates[preset] : null;

  const candidateError =
    currentCandidate && 'error' in currentCandidate ? currentCandidate.error : candidates === null ? '请先登录后再保存到云端。' : null;

  const estimateText =
    currentCandidate && !('error' in currentCandidate)
      ? `${formatKilobytes(currentCandidate.estimatedBytes)}KB / ${MAX_DATA_CARD_BYTES / 1024}KB`
      : null;

  const overLimit = Boolean(currentCandidate && !('error' in currentCandidate) && currentCandidate.overLimit);

  const content = (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{
        zIndex: 999999,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={() => {
        if (saving) return;
        onClose();
      }}
    >
      <div
        className="bg-white rounded-2xl p-6 max-w-lg w-full relative shadow-2xl border border-pink-100"
        style={{ zIndex: 1000000 }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-2xl leading-none"
          aria-label="关闭"
          disabled={saving}
        >
          ×
        </button>

        <div className="pr-8">
          <h2 className="text-xl font-bold text-gray-900">保存到档案馆</h2>
          <div className="mt-1 text-xs text-gray-600">
            写入前会按服务端逻辑注入 <code>_author/_authorId</code> 并计算 UTF-8 字节数（上限 300KB）。
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        ) : null}

        {candidateError ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {candidateError}
          </div>
        ) : null}

        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-pink-700">
              数据卡名称 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 20))}
              className="mt-2 w-full rounded-xl border border-pink-100 bg-white/80 p-3 text-sm text-gray-900"
              placeholder="请输入数据卡名称"
              disabled={saving}
              maxLength={20}
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-pink-700">描述</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, 300))}
              className="mt-2 w-full resize-y rounded-xl border border-pink-100 bg-white/80 p-3 text-sm text-gray-900"
              rows={3}
              placeholder="（可选）"
              disabled={saving}
              maxLength={300}
            />
          </div>

          <label className="flex items-center gap-2 rounded-xl border border-pink-100 bg-white/70 p-3">
            <input
              type="checkbox"
              checked={isPublic === 1}
              onChange={(e) => setIsPublic(e.target.checked ? 1 : 0)}
              disabled={saving}
            />
            <span className="text-sm text-gray-900">设为公开（其他用户可见）</span>
          </label>

          <div className="rounded-xl border border-pink-100 bg-white/70 p-3">
            <div className="text-sm font-semibold text-pink-700">降级策略</div>
            <div className="mt-2 space-y-2">
              {(Object.keys(PRESET_LABELS) as TavernCloudSavePreset[]).map((key) => {
                const item = candidates ? candidates[key] : null;
                const itemError = item && 'error' in item ? item.error : null;
                const itemText =
                  item && !('error' in item) ? `${formatKilobytes(item.estimatedBytes)}KB` : itemError ? '无法计算' : '—';
                const itemOverLimit = Boolean(item && !('error' in item) && item.overLimit);
                return (
                  <label
                    key={key}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
                      preset === key ? 'border-pink-300 bg-pink-50' : 'border-pink-100 bg-white/70 hover:bg-pink-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="tavern-cloud-save-preset"
                      className="mt-1"
                      checked={preset === key}
                      onChange={() => setPreset(key)}
                      disabled={saving}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold text-gray-900">{PRESET_LABELS[key]}</div>
                        <div className={`text-xs ${itemOverLimit ? 'text-red-700' : 'text-gray-700'}`}>{itemText}</div>
                        {itemOverLimit ? <div className="text-xs text-red-700">超限</div> : null}
                      </div>
                      <div className="mt-1 text-xs text-gray-600">{PRESET_DESCRIPTIONS[key]}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {estimateText ? (
            <div className={`rounded-xl border p-3 text-sm ${overLimit ? 'border-red-200 bg-red-50 text-red-700' : 'border-green-200 bg-green-50 text-green-800'}`}>
              预计写入大小：{estimateText}
              {overLimit ? '（已超限，请选择更强的降级策略）' : ''}
            </div>
          ) : null}

          {currentCandidate && !('error' in currentCandidate) && currentCandidate.warnings.length > 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <div className="font-semibold">保存提示</div>
              <ul className="mt-1 list-disc pl-5">
                {currentCandidate.warnings.map((w, idx) => (
                  <li key={idx} className="whitespace-pre-wrap">
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex gap-2">
            <button
              type="button"
              className={`flex-1 generate-button ${!name.trim() || saving || Boolean(candidateError) || overLimit ? 'opacity-50 cursor-not-allowed' : ''}`}
              disabled={!name.trim() || saving || Boolean(candidateError) || overLimit}
              onClick={() => {
                if (!currentCandidate || 'error' in currentCandidate) return;
                void onSave({
                  preset,
                  name: name.trim(),
                  description: description.trim(),
                  isPublic,
                  data: currentCandidate.data,
                  estimatedBytes: currentCandidate.estimatedBytes,
                });
              }}
            >
              {saving ? '保存中...' : overLimit ? '超限' : '保存'}
            </button>
            <button
              type="button"
              className={`flex-1 generate-button ${saving ? 'opacity-50 cursor-not-allowed' : ''}`}
              disabled={saving}
              onClick={onClose}
              style={{
                background: 'white',
                backgroundImage: 'none',
                color: '#6b7280',
                border: '2px solid #e5e7eb',
              }}
            >
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return typeof window !== 'undefined' ? createPortal(content, document.body) : null;
}
