// 正文最大 1MiB，且自有卡片还可能包含同样大小的待审核正文。
// ponytail: 先限制单次读取的峰值；客户端仍保留完整列表供现有编辑/导出功能使用。
export const DATA_CARD_LIST_PAGE_SIZE = 8;

export type DataCardListPage = { limit: number; offset: number };

export function readDataCardListPage(params: URLSearchParams): DataCardListPage | null {
  const limit = Number(params.get('limit') ?? DATA_CARD_LIST_PAGE_SIZE);
  const offset = Number(params.get('offset') ?? 0);
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(offset) || offset < 0
    || offset > Number.MAX_SAFE_INTEGER - DATA_CARD_LIST_PAGE_SIZE) return null;
  return { limit: Math.min(limit, DATA_CARD_LIST_PAGE_SIZE), offset };
}
