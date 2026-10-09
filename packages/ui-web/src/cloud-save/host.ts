import type { ComponentType } from 'react';
import type { CardLibraryCardMeta, CardLibraryDetailsModalProps, CardLibraryOnlinePort } from '../card-library/host';
import type { CardLibraryTilePlatform } from '../card-library/DataCard';

/** 管理模态框共源端口：UI/筛选/分页/选卡由共享组件拥有，副作用只由宿主提供。 */
export interface DataCardsModalHost {
  defaultCapacity: number;
  recycleLimit: number;
  fetchSummaryPage: CardLibraryOnlinePort['fetchSummaryPage'];
  loadFullCard: CardLibraryOnlinePort['loadFullCard'];
  fetchCardMetaBatch(cardIds: readonly string[], signal: AbortSignal): Promise<Record<string, CardLibraryCardMeta> | null>;
  downloadJson(fileName: string, jsonText: string): void | Promise<void>;
  tilePlatform: CardLibraryTilePlatform;
  isHotCard(record: { favorite_count?: number; usage_count?: number }): boolean;
  DetailsModal?: ComponentType<CardLibraryDetailsModalProps & { isOwner?: boolean; pendingNotice?: string }>;
}
