import { parseJson, type Row } from './ui-model';

export const DIFF_LIMITS = { inputChars: 200_000, depth: 12, nodes: 2_000, changes: 100, previewChars: 2_000 } as const;
export type ContentChange = { path: string; kind: 'added' | 'removed' | 'modified'; before: string; after: string };
export type FieldDiff = { field: string; label: string; before: unknown; after: unknown; inherited: boolean; changes: ContentChange[]; notices: string[] };
const absent = Symbol('absent');

function preview(value: unknown, json = false): string {
  if (value === absent) return '（不存在）';
  if (value === null) return 'null';
  if (Array.isArray(value)) return `数组（${value.length} 项，展开原文查看）`;
  if (typeof value === 'object') return '对象（展开原文查看）';
  const text = String(value);
  const shortened = text.slice(0, DIFF_LIMITS.previewChars);
  const rendered = json && typeof value === 'string' ? JSON.stringify(shortened) : shortened;
  return rendered + (text.length > DIFF_LIMITS.previewChars ? '…（预览已截断，请查看完整原文）' : '');
}
function change(path: string, before: unknown, after: unknown, json = false): ContentChange {
  return { path, kind: before === absent ? 'added' : after === absent ? 'removed' : 'modified', before: preview(before, json), after: preview(after, json) };
}
function record(value: unknown): value is Row {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function jsonContentDiff(before: unknown, after: unknown): Pick<FieldDiff, 'changes' | 'notices'> {
  const changes: ContentChange[] = []; const notices: string[] = [];
  if ([before, after].some(value => typeof value === 'string' && value.length > DIFF_LIMITS.inputChars)) {
    notices.push('内容超过结构化对照大小上限，已降级为文本对照；预览可能截断，请查看完整原文。');
    if (before !== after) changes.push(change('内容', before, after));
    return { changes, notices };
  }
  // parseJson deliberately preserves invalid JSON as text; distinguish it from a valid JSON string.
  let left: unknown; let right: unknown;
  try { left = typeof before === 'string' ? JSON.parse(before) : before; right = typeof after === 'string' ? JSON.parse(after) : after; }
  catch {
    notices.push('存在无效 JSON，已降级为文本对照，请核对完整原文。');
    if (before !== after) changes.push(change('内容', before, after));
    return { changes, notices };
  }
  let nodes = 0; let truncated = false;
  const walk = (a: unknown, b: unknown, path: string, depth: number): void => {
    if (nodes >= DIFF_LIMITS.nodes || changes.length >= DIFF_LIMITS.changes) { truncated = true; return; }
    nodes++;
    if (Object.is(a, b)) return;
    if (depth >= DIFF_LIMITS.depth) { truncated = true; return; }
    if (Array.isArray(a) && Array.isArray(b)) {
      for (let index = 0; index < Math.max(a.length, b.length); index++) {
        walk(index < a.length ? a[index] : absent, index < b.length ? b[index] : absent, `${path}/${index}`, depth + 1);
        if (nodes >= DIFF_LIMITS.nodes || changes.length >= DIFF_LIMITS.changes) { if (index + 1 < Math.max(a.length, b.length)) truncated = true; break; }
      }
    } else if (record(a) && record(b)) {
      const childPath = (key: string) => `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
      for (const key in a) {
        if (!Object.hasOwn(a, key)) continue;
        if (nodes >= DIFF_LIMITS.nodes || changes.length >= DIFF_LIMITS.changes) { truncated = true; return; }
        walk(a[key], Object.hasOwn(b, key) ? b[key] : absent, childPath(key), depth + 1);
      }
      for (const key in b) {
        if (!Object.hasOwn(b, key) || Object.hasOwn(a, key)) continue;
        if (nodes >= DIFF_LIMITS.nodes || changes.length >= DIFF_LIMITS.changes) { truncated = true; return; }
        walk(absent, b[key], childPath(key), depth + 1);
      }
    } else changes.push(change(path || '/', a, b, true));
  };
  walk(left, right, '', 0);
  if (truncated) notices.push('结构化对照已达到深度、节点或变更条数上限，结果不完整；请核对完整原文。');
  return { changes, notices };
}

export function buildContentDiff(selected: Row): { hasCurrent: boolean; fields: FieldDiff[] } {
  const parsed = parseJson(selected.currentCard); const current = record(parsed) ? parsed : null;
  const fields = [['name', '名称'], ['description', '描述'], ['data', 'JSON 内容']].map(([field, label]): FieldDiff => {
    const before = current?.[field]; const inherited = selected[field] == null; const after = inherited ? before : selected[field];
    const result = !current ? { changes: [], notices: [] } : field === 'data' ? jsonContentDiff(before, after) : { changes: before === after ? [] : [change(label, before, after)], notices: [] };
    return { field, label, before, after, inherited, ...result };
  });
  return { hasCurrent: Boolean(current), fields };
}
