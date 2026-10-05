// 叙事历史 payload schema 已迁入共享域层（D5.0e）：@mahoshojo/domain/narrative-history。
// 本文件保留原路径作为 barrel，既有调用点无需改 import。
export {
  NarrativeHistoryEntrySchema,
  NarrativeHistorySchema,
} from '@mahoshojo/domain/narrative-history';
export type { NarrativeHistoryData } from '@mahoshojo/domain/narrative-history';
