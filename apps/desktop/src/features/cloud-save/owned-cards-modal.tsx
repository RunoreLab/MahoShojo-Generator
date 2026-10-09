import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { isHotCard } from '@mahoshojo/domain/data-card-size';
import { ONLINE_DATA_CARD_TYPES, type OnlineDataCardType } from '@mahoshojo/contracts/data-cards';
import { DataCardsModal, type DataCardsModalHost } from '@mahoshojo/ui-web/cloud-save';
import { createDesktopCardLibraryOnlinePort, useDesktopCardLibraryHost } from '../../platform/card-library-host';
import { readPrivateCloudCapacity } from '../../platform/private-cloud-save';
import type { InvokeFn } from '../../platform/cloud-bridge';
import { useDesktopCloudSession } from '../account/use-desktop-cloud-session';

export interface DesktopOwnedCard {
  id: string;
  type: OnlineDataCardType;
  name: string;
  description?: string | null;
  data: string;
  [key: string]: unknown;
}
export interface DesktopOwnedCardsModalProps {
  isOpen: boolean;
  onClose: () => void;
  expectedUserId: number;
  selectedType?: OnlineDataCardType;
  onReplaceCard?: (card: DesktopOwnedCard) => void | Promise<void>;
  onSelectCard?: (card: DesktopOwnedCard) => void | Promise<void>;
  refreshToken?: number;
  isBusy?: boolean;
  scopeKey?: string;
  titleOverride?: string;
  invokeFn?: InvokeFn;
}

const ownedCard = (value: unknown): DesktopOwnedCard => {
  if (!value || typeof value !== 'object') throw new Error('数据卡读取失败');
  const card = value as Record<string, unknown>;
  if (typeof card.id !== 'string' || typeof card.name !== 'string' || typeof card.data !== 'string' || !ONLINE_DATA_CARD_TYPES.includes(card.type as OnlineDataCardType)) {
    throw new Error('数据卡格式无效，请刷新后重试');
  }
  return card as DesktopOwnedCard;
};

/** 角色管理与生成结果都回用 Web 的真实管理模态框；不复制任何 Desktop 对话框。 */
export function DesktopOwnedCardsModal(props: DesktopOwnedCardsModalProps) {
  const { state, store } = useDesktopCloudSession();
  const epoch = store.getCredentialEpoch();
  const owns = state.account?.userId === props.expectedUserId && state.verification === 'verified' && state.authFlow.kind === 'idle';
  return <DesktopOwnedCardsModalScope key={`${props.expectedUserId}:${epoch}:${props.scopeKey ?? ''}`} {...props} isOpen={props.isOpen && owns}
    isCurrent={() => store.getCredentialEpoch() === epoch && store.getSnapshot().account?.userId === props.expectedUserId && store.getSnapshot().verification === 'verified' && store.getSnapshot().authFlow.kind === 'idle'} />;
}

function DesktopOwnedCardsModalScope({ isOpen, onClose, expectedUserId, selectedType, onReplaceCard, onSelectCard, refreshToken = 0, isBusy = false, titleOverride = '我的数据卡', invokeFn = invoke, isCurrent }: DesktopOwnedCardsModalProps & { isCurrent: () => boolean }) {
  const libraryHost = useDesktopCardLibraryHost();
  const online = useMemo(() => createDesktopCardLibraryOnlinePort(invokeFn, expectedUserId), [expectedUserId, invokeFn]);
  const host = useMemo<DataCardsModalHost>(() => ({
    fetchSummaryPage: online.fetchSummaryPage,
    loadFullCard: online.loadFullCard,
    fetchCardMetaBatch: (ids, signal) => online.fetchCardMetaBatch?.(ids, signal) ?? Promise.resolve(null),
    // 数字只作共享接口默认值；实际未读到容量时明确显示「未知」。
    defaultCapacity: 20,
    recycleLimit: 5,
    isHotCard,
    tilePlatform: { ...libraryHost.platform, reviewHref: '/encyclopedia/review', reportStat: online.reportCardStat },
    downloadJson: (fileName, jsonText) => {
      if (!libraryHost.platform.downloadJson) throw new Error('文件下载暂不可用，请保留编辑内容');
      return libraryHost.platform.downloadJson(fileName, jsonText);
    },
    DetailsModal: libraryHost.slots.CardDetailsModal,
  }), [libraryHost.platform, libraryHost.slots.CardDetailsModal, online]);
  const [page, setPage] = useState(1);
  const [capacity, setCapacity] = useState<{ capacity: number; usedSlots: number } | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setCapacity(null);
    void readPrivateCloudCapacity(invokeFn, expectedUserId).then((value) => { if (active) setCapacity(value); });
    return () => { active = false; };
  }, [expectedUserId, invokeFn, isOpen, refreshToken]);
  const allowedTypes = useMemo(() => selectedType ? [selectedType] : ['character', 'scenario'] as OnlineDataCardType[], [selectedType]);
  const defaultFilters = useMemo(() => selectedType ? { type: selectedType } : {}, [selectedType]);
  return <DataCardsModal host={host} isOpen={isOpen} onClose={onClose} summaryOwnerId={expectedUserId} dataCards={[]}
    currentPage={page} onPageChange={setPage} cardsPerPage={12} refreshKey={refreshToken} busy={isBusy}
    allowedTypes={allowedTypes} defaultFilters={defaultFilters}
    title={titleOverride} userCapacity={capacity?.capacity} userUsedSlots={capacity?.usedSlots} capacityKnown={capacity !== null}
    onLoadCard={onSelectCard ? async (card) => { if (isCurrent()) await onSelectCard(ownedCard(card)); } : undefined}
    onReplaceCard={onReplaceCard ? async (card) => { if (isCurrent()) await onReplaceCard(ownedCard(card)); } : undefined}
    allowHistoryReplace={true} />;
}
