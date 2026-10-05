// 竞技场与角色成长类型已迁移至 @mahoshojo/domain/arena-types（canonical 定义）。
// 本文件保留原路径，既有 `@/types/arena` 调用点无需改动。

export type {
  CurrentStateField,
  CharacterCurrentState,
  ArenaHistoryEntry,
  ArenaHistory,
  ChainedEvent,
  CustomOutcome,
  AdjudicatorEvent,
  AdjudicationResult,
  NarrativeHistoryEntry,
  NarrativeHistoryDataCardV1,
} from '@mahoshojo/domain/arena-types';
