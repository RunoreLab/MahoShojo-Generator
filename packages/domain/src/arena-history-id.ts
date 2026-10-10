/**
 * 只为新历战分配正安全整数，不转换、排序或修复旧条目。
 * 正常沿全部数值 ID 的最大 floor + 1；无法安全递增时从 1 找空位。
 * 编辑器按位置操作、按 String(id) 展示，所以 canonical 数字字符串只占号，
 * 不把任意旧文本（如 01、1e0 或超长字符串）解析成新的数值序列。
 */
export const getNextArenaHistoryEntryId = (entries: readonly unknown[]): number => {
  const occupied = new Set<number>();
  let maximum = 0;
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const id = (entry as Record<string, unknown>).id;
    if (typeof id === 'number' && Number.isFinite(id) && id > 0) {
      maximum = Math.max(maximum, Math.min(Math.floor(id), Number.MAX_SAFE_INTEGER));
      if (Number.isSafeInteger(id)) occupied.add(id);
    } else if (typeof id === 'string' && id.length > 0 && id.length <= 16) {
      const numeric = Number(id);
      if (Number.isSafeInteger(numeric) && numeric > 0 && String(numeric) === id) {
        occupied.add(numeric);
      }
    }
  }
  let next = maximum < Number.MAX_SAFE_INTEGER ? maximum + 1 : 1;
  while (occupied.has(next)) next = next < Number.MAX_SAFE_INTEGER ? next + 1 : 1;
  return next;
};
