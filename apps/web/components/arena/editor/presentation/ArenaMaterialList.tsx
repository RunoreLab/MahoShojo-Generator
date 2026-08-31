'use client';

export type ArenaMaterialItemView = {
  key: string;
  name: string;
  sourceLabel: string;
  fileName?: string | null;
};

type ArenaMaterialListProps = {
  items: readonly ArenaMaterialItemView[];
  disabled?: boolean;
  onMove: (fromIndex: number, toIndex: number) => void;
  onRemove: (key: string) => void;
  emptyLabel?: string;
};

/** 只消费 safe material view model，不接触素材正文。 */
export function ArenaMaterialList({
  items,
  disabled = false,
  onMove,
  onRemove,
  emptyLabel = '未添加素材',
}: ArenaMaterialListProps) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 bg-white/50 px-3 py-4 text-center text-sm text-gray-500">
        {emptyLabel}
      </div>
    );
  }

  return (
    <ul className="space-y-2 text-sm">
      {items.map((material, index) => (
        <li key={material.key} className="rounded-lg border border-gray-200 bg-white/80 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="break-words font-semibold text-gray-800">{material.name}</div>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-gray-500">
                <span>{material.sourceLabel}</span>
                {material.fileName ? <span>{material.fileName}</span> : null}
              </div>
            </div>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={() => onMove(index, index - 1)}
                disabled={disabled || index === 0}
                className="rounded border px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40"
                aria-label={`上移 ${material.name}`}
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => onMove(index, index + 1)}
                disabled={disabled || index === items.length - 1}
                className="rounded border px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40"
                aria-label={`下移 ${material.name}`}
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => onRemove(material.key)}
                disabled={disabled}
                className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label={`移除 ${material.name}`}
              >
                移除
              </button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
