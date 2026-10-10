// 兼容入口；仅显示/下载命名，不回写 winner/headline 等裁决字段。
export {
  battleReportModeLabel,
  extractHtmlDocumentTitle,
  extractMetaHeadlineFromContent,
  resolveBattleReportDisplayTitle,
  resolveWebDisplayTitle,
  type BattleReportDisplayTitleInput,
  type WebDisplayTitleInput,
} from '@mahoshojo/ai-core/arena-generation';
