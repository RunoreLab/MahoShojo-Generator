export interface ArenaHistoryEntryLike {
  readonly id: unknown;
  readonly title?: string;
}

export interface ArenaHistoryLike {
  readonly entries?: readonly ArenaHistoryEntryLike[] | null;
  readonly attributes?: Record<string, unknown> | null;
  readonly [key: string]: unknown;
}

export interface CharacterManagerArenaHistorySectionProps {
  /** `data.arena_history`；`null`/`undefined` 时组件返回 null（由宿主决定是否包判空）。 */
  readonly history: ArenaHistoryLike | null | undefined;
  /** 写回整份 `arena_history` 对象；宿主再落到字段路径。 */
  readonly onChange: (next: Record<string, unknown>) => void;
  /** 「清除所有记录」的确认回调；默认 `window.confirm`。 */
  readonly confirm?: (text: string) => boolean;
  /** 「重置属性」生成新 `world_line_id`；默认 `crypto.randomUUID()`（带降级）。 */
  readonly createId?: () => string;
}

const defaultConfirm = (text: string): boolean =>
  typeof window === 'undefined' ? false : window.confirm(text);

const defaultCreateId = (): string => {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return typeof cryptoObj?.randomUUID === 'function'
    ? cryptoObj.randomUUID()
    : `wl-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

/**
 * 「历战记录管理」fieldset（自 Web `CharacterManagerPage` 抽取）：
 * 删除单条、重置属性（新 world_line_id + created_at）、清空 entries。
 * 原生性语义（删除/重置/清空是豁免操作）由宿主决定是否向用户解释，不影响这里的写入。
 */
export function CharacterManagerArenaHistorySection({
  history,
  onChange,
  confirm = defaultConfirm,
  createId = defaultCreateId,
}: CharacterManagerArenaHistorySectionProps) {
  if (!history) return null;

  const handleDeleteEntry = (id: unknown) => {
    onChange({
      ...history,
      entries: (history.entries ?? []).filter((entry) => entry.id !== id),
    });
  };

  const handleResetAttributes = () => {
    onChange({
      ...history,
      attributes: {
        ...(history.attributes ?? {}),
        world_line_id: createId(),
        created_at: new Date().toISOString(),
      },
    });
  };

  const handleClearEntries = () => {
    if (!confirm('确定要清除所有历战记录吗？此操作将清空 entries 数组。')) return;
    onChange({ ...history, entries: [] });
  };

  return (
    <fieldset className="border border-gray-300 p-4 rounded-lg mt-4">
      <legend className="text-sm font-semibold px-2 text-gray-600">历战记录管理</legend>
      <div className="space-y-4">
        {(history.entries ?? []).map((entry) => (
          <div key={String(entry.id)} className="flex items-start justify-between bg-gray-50 p-2 rounded">
            <p className="text-xs" title={entry.title}>{String(entry.id)}: {entry.title}</p>
            <button onClick={() => handleDeleteEntry(entry.id)} className="text-red-500 hover:text-red-700 text-xs font-bold px-2">删除</button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2 pt-2 border-t">
          <button onClick={handleResetAttributes} className="text-xs bg-yellow-100 text-yellow-800 px-3 py-1 rounded hover:bg-yellow-200">重置属性</button>
          <button onClick={handleClearEntries} className="text-xs bg-red-100 text-red-800 px-3 py-1 rounded hover:bg-red-200">清除所有记录</button>
        </div>
      </div>
    </fieldset>
  );
}
