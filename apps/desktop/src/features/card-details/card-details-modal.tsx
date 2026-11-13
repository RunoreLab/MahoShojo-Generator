import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { EntityRatingHistoryButton, type RankingDetailsTarget } from '@mahoshojo/ui-web/ranking';
import { readDesktopRanking } from '../ranking/use-ranking-query';
import { BasicCardDetailsModal, CardDetailsActions } from '@mahoshojo/ui-web/card-details';
import type { CardLibraryDetailsModalProps } from '@mahoshojo/ui-web/card-library';
import { DENY_EXTERNAL_MEDIA, MarkdownBlock } from '@mahoshojo/ui-web/markdown';
import { useExternalLinks } from '../external-links/external-links-provider';
import { downloadTextFile } from '../../platform/download-text-file';

type DesktopCardDetailsProps = CardLibraryDetailsModalProps & { pendingNotice?: string; ratingHistoryEntity?: Pick<RankingDetailsTarget, 'entityType' | 'entityId'> };

/** 数据卡与当前问卷副本共用的受控 Markdown 出口。 */
export function DesktopCardDetailsMarkdown({ content }: { content: string }) {
  const { openContent } = useExternalLinks();
  return <div onClickCapture={(event) => {
    // 相对链接也不能绕开内容链接确认/校验而直接导航 WebView。
    const anchor = event.target instanceof Element ? event.target.closest('a') : null;
    if (!anchor) return;
    event.preventDefault(); event.stopPropagation();
    openContent(anchor.getAttribute('href') ?? '');
  }}><MarkdownBlock content={content} variant="light" className="text-sm" externalMediaPolicy={DENY_EXTERNAL_MEDIA} onNavigateExternal={openContent} /></div>;
}

export function DesktopCardDetailsModal(props: DesktopCardDetailsProps) {
  return props.isOpen ? <DesktopCardDetailsScope key={`${props.source.kind}:${props.card.id}`} {...props} /> : null;
}

function DesktopCardDetailsScope({ card, source, onSaveCopyToLocalLibrary, localLibrarySaveState, pendingNotice, ratingHistoryEntity, ...props }: DesktopCardDetailsProps) {
  const [isRatingHistoryOpen, setIsRatingHistoryOpen] = useState(false);
  const scope = useMemo(() => ({}), [card.id, card.data, source.kind]);
  const currentScope = useRef<object | null>(scope);
  const running = useRef(false);
  useLayoutEffect(() => {
    currentScope.current = scope; running.current = false;
    return () => { currentScope.current = null; };
  }, [scope]);
  const [feedback, setFeedback] = useState<{ scope: object; busy: boolean; error: string | null }>({ scope, busy: false, error: null });
  const busy = feedback.scope === scope && feedback.busy;
  const actionError = feedback.scope === scope ? feedback.error : null;
  const run = async (action: () => Promise<void> | void) => {
    if (running.current) return;
    running.current = true;
    setFeedback({ scope, busy: true, error: null });
    let error: string | null = null;
    try { await action(); } catch (cause) { error = cause instanceof Error ? cause.message : '操作失败，请重试'; }
    finally {
      if (currentScope.current === scope) {
        running.current = false;
        setFeedback({ scope, busy: false, error });
      }
    }
  };
  return <BasicCardDetailsModal {...props} card={card} source={source} obscured={isRatingHistoryOpen}
    renderMarkdown={(content) => <DesktopCardDetailsMarkdown content={content} />}
    beforeOverview={pendingNotice ? <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{pendingNotice}</p> : undefined}
    metadata={<section className="space-y-2 text-xs text-gray-500">{ratingHistoryEntity && <EntityRatingHistoryButton {...ratingHistoryEntity} readRanking={readDesktopRanking} onOpenChange={setIsRatingHistoryOpen} />}<p>原生：未确认（本机未验证）；未查询线上指标</p>{card.tagIds?.length ? <p>标签 ID（未取得名称）：{card.tagIds.join('、')}</p> : null}</section>}
    footer={<CardDetailsActions downloadDisabled={busy} onDownload={() => void run(async () => {
        const data: unknown = JSON.parse(card.data);
        if (!data || typeof data !== 'object') throw new Error('正文格式无效，无法下载数据卡');
        const name = (card.name.trim() || '数据卡').replace(/[\\/:*?"<>|\n\r\t]/g, '_');
        await downloadTextFile(`${name}.json`, JSON.stringify(data, null, 2));
      })} onSave={onSaveCopyToLocalLibrary ? () => void run(onSaveCopyToLocalLibrary) : undefined}
      saveBusy={busy || localLibrarySaveState?.busy} saveBusyLabel="处理中…"
      feedback={<>{actionError && <p role="alert" className="text-sm text-red-700">{actionError}</p>}{localLibrarySaveState?.message && <p role="status" className="text-sm text-(--app-text-muted)">{localLibrarySaveState.message}</p>}</>}
    />}
  />;
}
