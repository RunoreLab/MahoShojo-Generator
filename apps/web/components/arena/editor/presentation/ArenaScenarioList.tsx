'use client';

export type ArenaAuxScenarioItemView = {
  key: string;
  title: string;
  isNative?: boolean;
};

type ArenaAuxScenarioListProps = {
  items: readonly ArenaAuxScenarioItemView[];
  disabled?: boolean;
  onMove?: (fromIndex: number, toIndex: number) => void;
  onRemove: (key: string) => void;
};

/** 单人编辑与 Proposal 草稿共用的 safe 辅助情景列表。 */
export function ArenaAuxScenarioList({
  items,
  disabled = false,
  onMove,
  onRemove,
}: ArenaAuxScenarioListProps) {
  if (items.length === 0) return null;

  return (
    <ul className="list-disc list-inside text-sm text-gray-600 mt-3 space-y-2">
      {items.map((item, index) => (
        <li key={item.key} className="flex justify-between items-start gap-2">
          {onMove ? <div className="flex flex-col gap-1 pt-0.5">
            <button
              type="button"
              onClick={() => onMove(index, index - 1)}
              disabled={disabled || index === 0}
              className="relative w-6 h-6 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed after:absolute after:-inset-2 after:content-['']"
              aria-label={`上移 ${item.title}`}
              title="上移"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => onMove(index, index + 1)}
              disabled={disabled || index === items.length - 1}
              className="relative w-6 h-6 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed after:absolute after:-inset-2 after:content-['']"
              aria-label={`下移 ${item.title}`}
              title="下移"
            >
              ↓
            </button>
          </div> : null}

          <div className="flex items-center flex-grow min-w-0">
            <span className="break-words mr-2" title={item.title}>
              {item.title}
              {item.isNative ? <span className="text-xs text-green-600 ml-1">(原生)</span> : null}
            </span>
          </div>

          <div className="flex items-center flex-shrink-0">
            <button
              type="button"
              onClick={() => onRemove(item.key)}
              className={`relative w-5 h-5 bg-red-200 text-red-700 rounded-full flex items-center justify-center text-xs font-bold transition-colors flex-shrink-0 after:absolute after:rounded-full after:-inset-2.5 after:content-[''] ${
                disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-red-300'
              }`}
              aria-label={`移除 ${item.title}`}
              disabled={disabled}
            >
              X
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
