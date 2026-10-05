// 已迁入 @mahoshojo/ui-web/card-library（D5.0e 共源）；本文件保留既有签名，
// 取数器固定为 Web `/api/*` 通路。

import { useCardLibrarySummaryPage } from '@mahoshojo/ui-web/card-library';
import type { DataCardSummaryQueryInput } from '@mahoshojo/contracts/data-cards';
import { getDataCardSummaryPage } from '@/lib/data-card-list-client';

export function useDataCardSummaryPage(
  source: 'my' | 'favorites',
  ownerId: number | null,
  enabled: boolean,
  query: DataCardSummaryQueryInput,
) {
  return useCardLibrarySummaryPage(getDataCardSummaryPage, source, ownerId, enabled, query);
}
