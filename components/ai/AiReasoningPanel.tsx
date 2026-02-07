'use client';

import { useMemo, useState } from 'react';
import { Brain, Check, ChevronDown, Copy } from 'lucide-react';

import type { AIReasoningEnvelope, AIReasoningStatus } from '@/types/ai-reasoning';

type AiReasoningDisplayMode = 'stream' | 'content-only';

type AiReasoningPanelProps = {
  status?: AIReasoningStatus;
  summary?: string | null;
  reasoning?: AIReasoningEnvelope | null;
  compact?: boolean;
  displayMode?: AiReasoningDisplayMode;
  defaultExpanded?: boolean;
  onToggle?: (expanded: boolean) => void;
};

const getStatusText = (
  displayMode: AiReasoningDisplayMode,
  status: AIReasoningStatus,
  summary: string | null,
  hasText: boolean
): string => {
  if (displayMode === 'content-only') {
    if (summary) return `AI 思考内容：${summary}`;
    return 'AI 思考内容';
  }
  if (summary) return `AI 思考摘要：${summary}`;
  if (status === 'error') return 'AI 思考过程读取失败';
  if (status === 'thinking') return 'AI 正在思考…';
  if (!hasText || status === 'unavailable') return '该模型未返回可展示思考内容';
  return 'AI 思考过程';
};

const getSourceLabel = (source: AIReasoningEnvelope['source']): string => {
  switch (source) {
    case 'sdk':
      return '来源：SDK';
    case 'provider':
      return '来源：Provider';
    case 'heuristic':
      return '来源：正文提取(低置信)';
    default:
      return '来源：未知';
  }
};

export function AiReasoningPanel({
  status,
  summary,
  reasoning = null,
  compact = false,
  displayMode = 'stream',
  defaultExpanded = false,
  onToggle,
}: AiReasoningPanelProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [copied, setCopied] = useState(false);

  const resolvedStatus: AIReasoningStatus = status ?? reasoning?.status ?? 'idle';
  const reasoningText = typeof reasoning?.text === 'string' ? reasoning.text.trim() : '';
  const resolvedSummary = summary ?? reasoning?.summary ?? null;
  const hasReasoningText = Boolean(reasoningText);
  const hasRenderableContent = hasReasoningText || Boolean(resolvedSummary);
  const detailText =
    hasReasoningText
      ? reasoningText
      : (displayMode === 'content-only' && typeof resolvedSummary === 'string' ? resolvedSummary.trim() : '');
  const hasDetailText = Boolean(detailText);

  const shouldRender = useMemo(() => {
    if (displayMode === 'content-only') return hasRenderableContent;
    if (resolvedStatus !== 'idle') return true;
    return hasRenderableContent;
  }, [displayMode, hasRenderableContent, resolvedStatus]);

  const statusText = getStatusText(displayMode, resolvedStatus, resolvedSummary, hasReasoningText);
  const reasoningChars = hasDetailText ? detailText.length : 0;

  if (!shouldRender) return null;

  return (
    <div
      className={[
        'ai-reasoning-panel mt-3 rounded-xl border border-white/15 bg-black/20',
        compact ? 'p-2.5' : 'p-3',
      ].join(' ')}
    >
      <button
        type="button"
        className="flex w-full items-start gap-2 text-left"
        aria-expanded={expanded}
        onClick={() => {
          const next = !expanded;
          setExpanded(next);
          onToggle?.(next);
        }}
      >
        <ChevronDown
          className={[
            'mt-0.5 h-4 w-4 shrink-0 text-purple-200 transition-transform',
            expanded ? 'rotate-0' : '-rotate-90',
          ].join(' ')}
          aria-hidden
        />
        <Brain className="mt-0.5 h-4 w-4 shrink-0 text-purple-200" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className={compact ? 'text-xs font-medium text-purple-100' : 'text-sm font-medium text-purple-100'}>
            {statusText}
          </div>
        </div>
      </button>

      {expanded ? (
        <div className={compact ? 'mt-2 space-y-2' : 'mt-2.5 space-y-2.5'}>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-purple-100/80">
            <span className="rounded-full border border-white/15 px-2 py-0.5">{getSourceLabel(reasoning?.source ?? 'unknown')}</span>
            {typeof reasoning?.reasoningTokens === 'number' ? (
              <span className="rounded-full border border-white/15 px-2 py-0.5">推理 tokens：{reasoning.reasoningTokens.toLocaleString()}</span>
            ) : null}
            <span className="rounded-full border border-white/15 px-2 py-0.5">文本长度：{reasoningChars.toLocaleString()}</span>
            {Array.isArray(reasoning?.anomalyFlags) && reasoning.anomalyFlags.length > 0 ? (
              <span className="rounded-full border border-amber-300/40 bg-amber-400/10 px-2 py-0.5 text-amber-100">
                异常：{reasoning.anomalyFlags.join('、')}
              </span>
            ) : null}
          </div>

          <div className="rounded-lg border border-white/10 bg-black/25 p-3">
            {hasDetailText ? (
              <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed text-gray-100">{detailText}</pre>
            ) : (
              <p className="text-xs text-gray-300">
                {resolvedStatus === 'thinking' ? '正在等待模型返回可展示的思考内容…' : '暂无可展示思考内容。'}
              </p>
            )}
          </div>

          {hasDetailText ? (
            <div className="flex justify-end">
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-black/20 px-2 py-1 text-[11px] text-gray-200 hover:bg-black/35"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(detailText);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1200);
                  } catch {
                    setCopied(false);
                  }
                }}
              >
                {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                {copied ? '已复制' : '复制思考内容'}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default AiReasoningPanel;
