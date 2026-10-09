interface QuestionnaireDraftPanelProps {
  readonly draftError: string | null;
  readonly draftBlocked: boolean;
  readonly busy: boolean;
  readonly actionClass: string;
  readonly onRetrySave: () => void;
}

/** 正常自动恢复/保存保持安静；失败时保留原数据保护和可重试入口。 */
export function QuestionnaireDraftPanel({
  draftError, draftBlocked, busy, actionClass, onRetrySave,
}: QuestionnaireDraftPanelProps) {
  if (!draftError) return null;
  return (
    <section aria-label="草稿保存异常" className="my-4 space-y-2 text-sm">
      <p role="alert">{draftBlocked ? '无法读取草稿，可能已损坏或版本不受支持。原数据已保留，可继续填写和生成；本次内容暂不自动保存，请在离开前导出备份。' : draftError}</p>
      {!draftBlocked && <button className={actionClass} disabled={busy} onClick={onRetrySave}>重试保存草稿</button>}
    </section>
  );
}
