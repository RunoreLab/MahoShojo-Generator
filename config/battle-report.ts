export type BattleReportOutputPreviewMode = 'full' | 'truncate';

export type BattleReportOutputPreviewConfig = {
  /**
   * 默认：true（保留 D1 的 output_preview）
   * 设为 false：当 “R2 写入 + large_objects 索引成功” 后，会把 battle_report_generations.output_preview 置 NULL。
   */
  persistPreviewInD1: boolean;
  /**
   * 默认：full（尽量把全文写进 output_preview，会显著推高 D1 体积）
   * 可设为 truncate：仅保留 head/tail 拼接的摘要（适合“D1 只保留摘要，全文走 R2”）。
   */
  outputPreviewMode: BattleReportOutputPreviewMode;
};

export const battleReportOutputPreviewConfig: BattleReportOutputPreviewConfig = {
  persistPreviewInD1: true,
  outputPreviewMode: 'full',
};

