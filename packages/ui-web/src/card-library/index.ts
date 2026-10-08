// card-library 共享数据卡选择器出口（D5.0e）。
// Web/Desktop 各自装配 CardLibraryHost 后渲染 CardLibraryModal；
// 纯展示件与读模型也被宿主的其它表面复用（徽章、技术值徽标、行映射等）。

export { CardLibraryModal } from './CardLibraryModal';
export type { CardLibraryModalProps, BattleDataTab } from './CardLibraryModal';

export { default as DataCard } from './DataCard';
export type { CardLibraryTilePlatform } from './DataCard';
export { DataCardEmptyState } from './DataCardEmptyState';
export type { DataCardEmptyStateTab } from './DataCardEmptyState';
export { default as SortSelector } from './SortSelector';

export { Button, ButtonAs, buttonClassName } from './Button';
export type { ButtonProps, ButtonSize, ButtonStyleOptions, ButtonVariant } from './Button';
export { default as Badge } from './Badge';
export { default as BadgeIcon } from './BadgeIcon';
export { TechBadge } from './TechBadge';
export { TierBadge } from './TierBadge';
export { getLucideIcon, getAvailableIcons, hasIcon, ICON_REGISTRY } from './icon-registry';
export type { BadgeDefinition, ColorConfig, IconConfig, ParsedTitle, UserBadge, UserDisplayInfo } from './badge-types';

export { buildTitleDisplay, DEFAULT_CARD_TITLE_MAX_CHARS } from './text';
export { getDataCardStatus, getDataCardVisibilityValue, isDataCardBanned } from './status';
export { normalizeOnlineDataCardVisibilityCompat } from './visibility';
export {
  isPublicVisibility,
  mapDataCardRuntimeSourceInfo,
  mapDataCardSourceMeta,
  mapPublicDataCardRowToBattleSelectionPayload,
  mapPublicDataCardRowToDetailsCard,
  normalizePublicVisibilityValue,
} from './read-mappers';
export type {
  BattleSelectionPayload,
  DataCardDetailsModalCard,
  DataCardRuntimeSourceInfo,
  DataCardSourceMeta,
  PublicDataCardCompatRow,
} from './read-mappers';
export {
  getCachedDataCardRowMeta,
  isCachedDataCardRow,
  isLocalDataCardRow,
  mapLocalCardRecordToDetailsCard,
  mapLocalCardRecordToRow,
  markCachedDataCardRow,
} from './rows';
export type { CachedDataCardRowMeta, LocalDataCardRow } from './rows';
export { saveLocalDataCard } from './save-local-data-card';
export type { SaveLocalDataCardInput, SaveLocalDataCardResult } from './save-local-data-card';
export { isDefinitiveClientTerminalStatus, isRetryableStatus } from './net-status';
export { createLocalStorageCardLibraryMarks, createStorageCardLibraryMarks } from './marks';

export { useCardLibrarySummaryPage } from './use-card-library-summary-page';
export type { CardLibrarySummaryPageFetcher, CardLibrarySummarySource } from './use-card-library-summary-page';
export { useLocalDataCards } from './use-local-data-cards';
export type { LocalDataCardPageState } from './use-local-data-cards';
export { useLocalLibraryAutoSave } from './use-local-library-auto-save';
export type { LocalLibraryAutoSaveInput, LocalLibraryAutoSaveResult } from './use-local-library-auto-save';

export type {
  CardLibraryAuthState,
  CardLibraryAuthStatus,
  CardLibraryCachedAvailability,
  CardLibraryCachedCardResult,
  CardLibraryCachedEntry,
  CardLibraryCachedListQuery,
  CardLibraryCachedPage,
  CardLibraryCacheStatus,
  CardLibraryCardMeta,
  CardLibraryDeckDetail,
  CardLibraryDetailsCard,
  CardLibraryDetailsModalProps,
  CardLibraryDecksModalProps,
  CardLibraryHost,
  CardLibraryLinkComponent,
  CardLibraryLinkProps,
  CardLibraryLocalPort,
  CardLibraryMarks,
  CardLibraryOnlinePort,
  CardLibraryPlatform,
  CardLibraryPublicCachePort,
  CardLibraryPublicCardBody,
  CardLibraryPublicListBody,
  CardLibraryPublicListQuery,
  CardLibraryRemoteResult,
  CardLibrarySelectionContext,
  CardLibrarySlots,
  CardLibraryStatKind,
  CardLibraryTag,
} from './host';
