import type { Row } from './ui-model';

export function selectedExportIds(checked: string[], selected: Row | null): string[] {
  const ids = checked.length ? [...checked] : typeof selected?.id === 'string' ? [selected.id] : [];
  if (!ids.length) throw new Error('请勾选需要导出的记录，或先查看一条详情。');
  if (ids.length > 100) throw new Error('每次最多导出 100 条。');
  if (new Set(ids).size !== ids.length || ids.some(id => !id.trim() || id.length > 128)) throw new Error('导出范围无效，请重新选择。');
  return ids;
}
