import type { ReactNode } from 'react';

interface QuestionnaireDraftPanelProps {
  readonly pendingRestore: boolean;
  readonly draftSaved: boolean;
  readonly draftError: string | null;
  readonly draftBlocked: boolean;
  readonly busy: boolean;
  readonly actionClass: string;
  readonly onRestore: () => void;
  readonly onRetrySave: () => void;
  readonly onRequestClear: () => void;
  readonly onReload: () => void;
  readonly confirmation?: ReactNode;
}

/** 本机草稿的呈现层；恢复、清除和持久化仍由问卷宿主持有。 */
export function QuestionnaireDraftPanel({
  pendingRestore, draftSaved, draftError, draftBlocked, busy, actionClass,
  onRestore, onRetrySave, onRequestClear, onReload, confirmation,
}: QuestionnaireDraftPanelProps) {
  return (
    <section aria-label="草稿" className="my-4 text-sm">
      {pendingRestore ? (
        <div role="status" className="flex flex-wrap items-center gap-2">
          <span>发现上次草稿，请选择恢复或清除。</span>
          <button className={actionClass} onClick={onRestore}>恢复草稿</button>
        </div>
      ) : <p role="status">{draftSaved ? '当前内容已保存或无待保存变更。' : '当前内容尚未保存到草稿。'}</p>}
      {draftError && <p role="alert">{draftError}</p>}
      {draftError && !draftBlocked && (
        <button className={actionClass} disabled={busy || pendingRestore} onClick={onRetrySave}>重试保存草稿</button>
      )}
      <details className="mt-2" open={pendingRestore || Boolean(draftError)}>
        <summary className="cursor-pointer text-(--app-text-muted)">草稿说明与管理</summary>
        <div className="mt-2 space-y-2 text-(--app-text-muted)">
          <p>问卷、结果与中断正文自动保存在本机页面草稿中，恢复草稿不会自动重新生成。</p>
          <p>草稿不参与本地库整库备份或归档；保存到本地卡库的角色卡参与。草稿上限为序列化后 4 Mi 字符，超出或写入失败时请保留当前页面。</p>
          <div className="flex flex-wrap gap-2">
            <button className={actionClass} disabled={busy} onClick={onRequestClear}>清除草稿</button>
            <button className={actionClass} disabled={busy} onClick={onReload}>重新加载问卷与配置</button>
          </div>
        </div>
      </details>
      {confirmation}
    </section>
  );
}
