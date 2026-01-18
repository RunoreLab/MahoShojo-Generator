import { useEffect, useMemo, useRef } from 'react';

import { MagicTeaPartyChatMessage } from '@/components/magic-tea-party/ChatMessage';
import { useChatAutoScroll } from '@/components/magic-tea-party/useChatAutoScroll';

import type {
  MagicTeaPartyMessage,
  MagicTeaPartyPreferences,
  MagicTeaPartySession,
  MagicTeaPartyTachieAsset,
} from '@/lib/magic-tea-party/types';

type MagicTeaPartyChatTimelineProps = {
  activeSession: MagicTeaPartySession | null;
  preferences: MagicTeaPartyPreferences;
  messages: MagicTeaPartyMessage[];
  isGenerating: boolean;
  outputView: 'raw' | 'rendered';
  onOutputViewChange: (view: 'raw' | 'rendered') => void;
  tachieAssets?: MagicTeaPartyTachieAsset[];
  anchorMessageId?: string | null;
  editingMessageId?: string | null;
  editingDraft?: string;
  onStopGenerating: () => void;
  onSelectChoice: (text: string) => void;
  onUseAsReference: (message: MagicTeaPartyMessage, plainText: string) => void;
  onRegenerate: (message: MagicTeaPartyMessage) => void;
  onStartEdit: (message: MagicTeaPartyMessage) => void;
  onEditDraftChange: (value: string) => void;
  onCancelEdit: () => void;
  onConfirmEdit: (message: MagicTeaPartyMessage) => void;
};

const InlineSpinner = () => (
  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-pink-200 border-t-pink-600" aria-hidden="true" />
);

export function MagicTeaPartyChatTimeline(props: MagicTeaPartyChatTimelineProps) {
  const {
    activeSession,
    preferences,
    messages,
    isGenerating,
    outputView,
    onOutputViewChange,
    tachieAssets,
    anchorMessageId,
    editingMessageId,
    editingDraft,
    onStopGenerating,
    onSelectChoice,
    onUseAsReference,
    onRegenerate,
    onStartEdit,
    onEditDraftChange,
    onCancelEdit,
    onConfirmEdit,
  } = props;

  const visibleMessages = useMemo(() => {
    return messages.filter((message) => {
      const meta = message.meta && typeof message.meta === 'object' ? (message.meta as Record<string, unknown>) : null;
      return !meta || meta.noticeSuppressed !== true;
    });
  }, [messages]);

  const lastAssistantId = useMemo(() => {
    const lastAssistant = [...visibleMessages].reverse().find((message) => message.role === 'assistant');
    return lastAssistant?.id ?? null;
  }, [visibleMessages]);

  const canRegenerateMessage = (message: MagicTeaPartyMessage): boolean => {
    if (message.role !== 'assistant') return false;
    if (message.status === 'streaming') return false;
    if (!lastAssistantId || message.id !== lastAssistantId) return false;
    const meta = message.meta && typeof message.meta === 'object' ? (message.meta as Record<string, unknown>) : null;
    const kind = typeof meta?.kind === 'string' ? String(meta.kind) : '';
    if (kind === 'choices') return false;
    return true;
  };

  const lastMessage = visibleMessages[visibleMessages.length - 1];
  const lastMessageLength = typeof lastMessage?.content === 'string' ? lastMessage.content.length : 0;
  const autoScrollKey = `${activeSession?.id ?? 'no-session'}:${visibleMessages.length}:${lastMessage?.id ?? ''}:${lastMessage?.status ?? ''}:${lastMessageLength}`;
  const { containerRef, bottomRef, isAtBottom, scrollToBottom } = useChatAutoScroll({
    enabled: true,
    autoScrollKey,
    anchorMessageId,
    behavior: isGenerating ? 'auto' : 'smooth',
    mode: 'container',
  });

  const lastSeenCountRef = useRef(0);
  useEffect(() => {
    if (isAtBottom) {
      lastSeenCountRef.current = visibleMessages.length;
    }
  }, [isAtBottom, visibleMessages.length]);

  const newCount = Math.max(0, visibleMessages.length - lastSeenCountRef.current);
  const showJump = !isAtBottom && visibleMessages.length > 0;
  const jumpLabel = newCount > 0 ? `回到最新 · ${newCount}条新消息` : '回到最新';

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="text-sm font-semibold text-gray-800">对话</div>
          {isGenerating ? (
            <div className="flex items-center gap-2 text-xs font-semibold text-pink-700">
              <InlineSpinner />
              <span>生成中…</span>
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-full border border-pink-200 bg-white p-0.5 text-xs font-semibold text-pink-700">
            <button
              type="button"
              className={`rounded-full px-3 py-1 transition ${outputView === 'rendered' ? 'bg-pink-600 text-white' : 'hover:bg-pink-50'}`}
              onClick={() => onOutputViewChange('rendered')}
            >
              渲染
            </button>
            <button
              type="button"
              className={`rounded-full px-3 py-1 transition ${outputView === 'raw' ? 'bg-pink-600 text-white' : 'hover:bg-pink-50'}`}
              onClick={() => onOutputViewChange('raw')}
            >
              原始
            </button>
          </div>
          {isGenerating ? (
            <button
              type="button"
              className="rounded-lg border border-pink-200 bg-white px-3 py-1.5 text-xs font-semibold text-pink-700 hover:bg-pink-50"
              onClick={onStopGenerating}
            >
              停止生成
            </button>
          ) : null}
        </div>
      </div>

      <div className="relative">
        <div
          ref={containerRef}
          className="h-[60vh] max-h-[520px] min-h-[240px] overflow-y-auto pr-2"
        >
          <div className="space-y-3 pb-1">
            {visibleMessages.length === 0 ? (
              <div className="rounded-lg bg-pink-50 px-4 py-3 text-sm text-pink-800">
                还没有对话。输入你的行动、对白或叙事，例如：推开咖啡店的门……
              </div>
            ) : (
              visibleMessages.map((message) => (
                <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    id={`magic-tea-party-message-${message.id}`}
                    className={`max-w-[720px] w-full sm:w-auto ${anchorMessageId === message.id ? 'rounded-xl ring-2 ring-pink-200 shadow-sm' : ''}`}
                  >
                    <MagicTeaPartyChatMessage
                      message={message}
                      session={activeSession}
                      preferences={preferences}
                      isGenerating={isGenerating}
                      outputView={outputView}
                      tachieAssets={tachieAssets}
                      onSelectChoice={onSelectChoice}
                      onUseAsReference={onUseAsReference}
                      onRegenerate={onRegenerate}
                      showRegenerate={canRegenerateMessage(message)}
                      editingMessageId={editingMessageId}
                      editingDraft={editingDraft}
                      onStartEdit={onStartEdit}
                      onEditDraftChange={onEditDraftChange}
                      onCancelEdit={onCancelEdit}
                      onConfirmEdit={onConfirmEdit}
                    />
                  </div>
                </div>
              ))
            )}
            <div ref={bottomRef} aria-hidden="true" />
          </div>
        </div>
        {showJump ? (
          <button
            type="button"
            className="absolute bottom-3 right-2 rounded-full bg-pink-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-pink-700"
            onClick={() => scrollToBottom('smooth')}
          >
            {jumpLabel}
          </button>
        ) : null}
      </div>
    </>
  );
}
