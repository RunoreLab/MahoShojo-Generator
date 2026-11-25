'use client';

import type { ComponentProps, ReactNode } from 'react';
import type { MarkdownBlockProps } from '@/components/MarkdownBlock';
import type { BattleReportCardProps } from '@/components/BattleReportCard';
import type { StreamingBattleReportCardProps } from '@/components/stream/StreamingBattleReportCard';
import type { BattleIllustrationPanel as IllustrationPanel } from './BattleIllustrationPanel';
import { createDeferredRenderer } from '@/components/shared/createDeferredRenderer';
import { downloadFile } from '@/lib/client/downloadFile';

function PlainReport({ content, children, exportable = true }: {
  content: string;
  children?: ReactNode;
  exportable?: boolean;
}) {
  return <>
    <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-sm">{content}</pre>
    <div className="flex flex-wrap gap-2">
      {content && exportable ? <button type="button" className="rounded border px-3 py-1" onClick={() => {
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        void downloadFile(blob, '战报正文.txt').catch(() => window.alert('导出战报正文失败，请重试。'));
      }}>导出正文</button> : null}
      {children}
    </div>
  </>;
}

export const MarkdownBlock = createDeferredRenderer<MarkdownBlockProps>(
  () => import('@/components/MarkdownBlock').then((module) => ({ default: module.MarkdownBlock })),
  { label: '正文排版', fallback: ({ content }) => <PlainReport content={content} /> },
);

export const BattleReportCard = createDeferredRenderer<BattleReportCardProps>(
  () => import('@/components/BattleReportCard'),
  {
    label: '战报卡片',
    fallback: ({ report, liveBody, isStreaming, onStopGeneration }) => (
      <PlainReport content={[report.headline, liveBody ?? report.article?.body, report.article?.analysis,
        report.officialReport?.winner, report.officialReport?.conclusion].filter(Boolean).join('\n\n')}>
        {isStreaming && onStopGeneration ? <button type="button" onClick={onStopGeneration}>停止生成</button> : null}
      </PlainReport>
    ),
  },
);

export const StreamingBattleReportCard = createDeferredRenderer<StreamingBattleReportCardProps>(
  () => import('@/components/stream/StreamingBattleReportCard'),
  {
    label: '战报卡片',
    fallback: ({ content, reportContent, disableExport, additionalActions, isStreaming, onStopGeneration,
      stopGenerationLabel = '停止生成', stopGenerationDisabled, softTimeoutWarning }) => <>
      {/* Keep consent/safety in ArenaWebReport; mounting its iframe here would run it again when the card loads. */}
      {reportContent != null
        ? <p className="text-sm">网页预览将在卡片加载完成后显示，仍可使用下方导出操作。</p>
        : <PlainReport content={content} exportable={!disableExport} />}
      {softTimeoutWarning ? <p role="status">{softTimeoutWarning}</p> : null}
      {isStreaming && onStopGeneration ? (
        <button type="button" onClick={onStopGeneration} disabled={stopGenerationDisabled}
          className="rounded border px-3 py-1">{stopGenerationLabel}</button>
      ) : null}
      {additionalActions}
    </>,
  },
);

export const BattleIllustrationPanel = createDeferredRenderer<ComponentProps<typeof IllustrationPanel>>(
  () => import('./BattleIllustrationPanel').then((module) => ({ default: module.BattleIllustrationPanel })),
  { label: '战报插图工具' },
);
