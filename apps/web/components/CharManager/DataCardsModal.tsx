// 真实管理模态框已共源；Web 只装配网络、文件、详情与链接端口。
import { DataCardsModal as SharedDataCardsModal, type DataCardsModalProps, type DataCardsModalHost } from '@mahoshojo/ui-web/cloud-save';
import DataCardDetailsModal from '../DataCardDetailsModal';
import { config } from '@/lib/config';
import { downloadBlob } from '@/lib/client/blobUrl';
import { isHotCard } from '@/lib/constants';
import { authStorage } from '@/lib/auth';
import { getDataCardSummaryPage, loadFullDataCard } from '@/lib/data-card-list-client';
import { webCardTilePlatform } from '@/lib/card-tile-platform';

const host: DataCardsModalHost = {
  defaultCapacity: config.DEFAULT_DATA_CARD_CAPACITY,
  recycleLimit: config.RECYCLE_BIN_LIMIT,
  isHotCard,
  tilePlatform: webCardTilePlatform,
  DetailsModal: DataCardDetailsModal,
  fetchSummaryPage: (source, query, signal) => getDataCardSummaryPage(source, query, signal),
  loadFullCard: (card, source, signal) => loadFullDataCard(card, source, signal),
  downloadJson: (fileName, jsonText) => downloadBlob(new Blob([jsonText], { type: 'application/json' }), fileName),
  async fetchCardMetaBatch(cardIds, signal) {
    const authHeader = await authStorage.getAuthHeader();
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    if (authHeader) headers.Authorization = authHeader;
    const response = await fetch('/api/data-card-meta-batch', {
      method: 'POST', headers, body: JSON.stringify({ dataCardIds: cardIds }), signal,
    });
    if (!response.ok) return null;
    const json = await response.json();
    if (!json || json.success !== true || typeof json.items !== 'object' || !json.items) return null;
    return Object.fromEntries(Object.entries<any>(json.items).map(([id, item]) => [id, {
      techScore: typeof item?.metrics?.techScore === 'number' ? item.metrics.techScore : null,
      techLevel: typeof item?.metrics?.techLevel === 'string' ? item.metrics.techLevel : null,
      strictTier: typeof item?.strict?.tier === 'string' ? item.strict.tier : null,
      isNative: typeof item?.metrics?.isNative === 'boolean' ? item.metrics.isNative : null,
    }]));
  },
};

export default function DataCardsModal(props: Omit<DataCardsModalProps, 'host'>) {
  return <SharedDataCardsModal {...props} host={host} />;
}
