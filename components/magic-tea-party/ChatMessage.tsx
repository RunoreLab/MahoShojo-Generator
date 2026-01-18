import Link from 'next/link';
import type { ReactNode } from 'react';

import { ErrorMessage } from '@/components/ErrorMessage';
import { MarkdownBlock } from '@/components/MarkdownBlock';
import type {
  MagicTeaPartyMessage,
  MagicTeaPartyPreferences,
  MagicTeaPartySession,
  MagicTeaPartyTachieAsset,
} from '@/lib/magic-tea-party/types';

type MagicTeaPartyChatMessageProps = {
  message: MagicTeaPartyMessage;
  session: MagicTeaPartySession | null;
  preferences: MagicTeaPartyPreferences;
  isGenerating: boolean;
  outputView?: 'raw' | 'rendered';
  tachieAssets?: MagicTeaPartyTachieAsset[];
  onSelectChoice?: (text: string) => void;
  onUseAsReference?: (message: MagicTeaPartyMessage, plainText: string) => void;
  onRegenerate?: (message: MagicTeaPartyMessage) => void;
  showRegenerate?: boolean;
  editingMessageId?: string | null;
  editingDraft?: string;
  onStartEdit?: (message: MagicTeaPartyMessage) => void;
  onEditDraftChange?: (value: string) => void;
  onCancelEdit?: () => void;
  onConfirmEdit?: (message: MagicTeaPartyMessage) => void;
  onDeleteMessage?: (message: MagicTeaPartyMessage) => void;
};

const isMessageSuperseded = (message: MagicTeaPartyMessage): boolean => {
  const meta = message.meta && typeof message.meta === 'object' ? (message.meta as Record<string, unknown>) : null;
  return Boolean(meta && meta.superseded === true);
};

const getSpeakerNameFromRole = (session: MagicTeaPartySession | null, roleId: string): string => {
  const roles = session?.roles ?? [];
  const match = roles.find((role) => role.id === roleId);
  return match?.name || roleId;
};

const getAssistantPrefix = (session: MagicTeaPartySession | null): string => {
  const presetId = session?.settings?.presetId || '';
  const prefix = presetId.startsWith('arena-') ? 'A.R.E.N.A. 魔法茶会' : '魔法茶会';
  return `${prefix} · 叙述者`;
};

const getPlainTextFromMessage = (message: MagicTeaPartyMessage, session: MagicTeaPartySession | null): string => {
  const segments = Array.isArray(message.segments) ? message.segments : null;
  if (segments && segments.length > 0) {
    const lines: string[] = [];
    for (const seg of segments) {
      if (!seg) continue;
      if (seg.type === 'narration') {
        const text = typeof (seg as any).text === 'string' ? String((seg as any).text).trim() : '';
        if (text) lines.push(text);
        continue;
      }
      if (seg.type === 'dialogue') {
        const speakerName =
          typeof (seg as any).speakerName === 'string' && String((seg as any).speakerName).trim()
            ? String((seg as any).speakerName).trim()
            : typeof (seg as any).speakerId === 'string'
              ? getSpeakerNameFromRole(session, String((seg as any).speakerId))
              : '';
        const text = typeof (seg as any).text === 'string' ? String((seg as any).text).trim() : '';
        if (text) lines.push(speakerName ? `${speakerName}: ${text}` : text);
        continue;
      }
    }
    return lines.join('\n').trim();
  }
  return (message.content ?? '').trim();
};

const renderMessageAttachments = (
  message: MagicTeaPartyMessage,
  session: MagicTeaPartySession | null,
  assets: MagicTeaPartyTachieAsset[] | undefined
) => {
  if (!assets || assets.length === 0) return null;
  const attached = assets
    .filter((asset) => asset.anchorMessageId === message.id)
    .filter((asset) => Boolean(asset.imageUrl || asset.blobRef));
  if (attached.length === 0) return null;

  const sorted = [...attached].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  const display = sorted.slice(0, 2);
  const remaining = sorted.length - display.length;

  return (
    <div className="mt-2 space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        {display.map((asset) => {
          const url = asset.imageUrl || asset.blobRef || '';
          if (!url) return null;
          const kindLabel = asset.kind === 'illustration' ? '剧情插画' : '角色立绘';
          const roleLabel = asset.roleId ? getSpeakerNameFromRole(session, asset.roleId) : '';
          const label = [kindLabel, roleLabel].filter(Boolean).join(' · ');
          return (
            <div key={asset.id} className="overflow-hidden rounded-lg border border-pink-100 bg-white">
              <a href={url} target="_blank" rel="noreferrer" className="block">
                <img src={url} alt={label || '已生成图片'} className="h-36 w-full object-cover" loading="lazy" />
              </a>
              {label ? <div className="px-2 py-1 text-[11px] text-gray-600">{label}</div> : null}
            </div>
          );
        })}
      </div>
      {remaining > 0 ? <div className="text-[11px] text-gray-500">还有 {remaining} 张已绑定图片，可在下方“插画 / 立绘”面板查看。</div> : null}
    </div>
  );
};

const renderAssistantFooter = (message: MagicTeaPartyMessage) => {
  if (message.status === 'streaming') {
    return (
      <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-pink-200 border-t-pink-600" aria-hidden="true" />
        <span>生成中…</span>
      </div>
    );
  }

  if (message.status === 'blocked') {
    const blockedBy = message.safety?.blockedBy;
    const hint =
      blockedBy === 'server'
        ? '该内容不符合安全策略，已被拦截。'
        : '本轮输出被安全策略截断（可尝试修改输入或重新生成）。';
    return (
      <div className="mt-2 text-xs text-amber-700">
        <span>{hint}</span>
        <Link href="/encyclopedia/sensitive-words" className="ml-2 underline underline-offset-2 hover:opacity-90">
          查看百科：敏感词与逮捕
        </Link>
      </div>
    );
  }

  if (message.status === 'error') {
    const rawCode = message.error?.code ?? '';
    const status = /^\d{3}$/.test(rawCode) ? Number(rawCode) : null;
    const kind =
      message.meta && typeof message.meta === 'object' && typeof (message.meta as any).kind === 'string'
        ? String((message.meta as any).kind)
        : '';

    const title =
      kind === 'choices'
        ? '生成选项失败'
        : kind === 'opening'
          ? '生成开场失败'
          : kind === 'continue'
            ? '继续生成失败'
            : '生成失败';

    const lines: string[] = [`❌ ${title}`];
    if (status) lines.push(`HTTP：${status}`);
    else if (rawCode) lines.push(`错误码：${rawCode}`);
    if (message.error?.message?.trim()) lines.push(`原因：${message.error.message.trim()}`);

    return (
      <div className="mt-2">
        <ErrorMessage
          message={lines.join('\n')}
          status={status}
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
          linkClassName="text-red-700 underline underline-offset-2 hover:opacity-95"
        />
      </div>
    );
  }

  return null;
};

const renderAssistantActions = (props: {
  message: MagicTeaPartyMessage;
  session: MagicTeaPartySession | null;
  isGenerating: boolean;
  onUseAsReference?: (message: MagicTeaPartyMessage, plainText: string) => void;
  onRegenerate?: (message: MagicTeaPartyMessage) => void;
  showRegenerate?: boolean;
  onDeleteMessage?: (message: MagicTeaPartyMessage) => void;
}) => {
  const { message, session, isGenerating, onUseAsReference, onRegenerate, showRegenerate, onDeleteMessage } = props;
  if (message.status === 'streaming') return null;

  const plain = getPlainTextFromMessage(message, session);
  const canUseReference = plain && typeof onUseAsReference === 'function';
  const canRegenerate = showRegenerate && typeof onRegenerate === 'function';
  const canDelete = message.role !== 'system' && typeof onDeleteMessage === 'function';

  if (!canUseReference && !canRegenerate && !canDelete) return null;

  return (
    <div className="mt-2 flex items-center justify-end gap-2 text-xs text-gray-500">
      {canUseReference ? (
        <button
          type="button"
          className="underline underline-offset-2 hover:text-gray-700"
          onClick={() => onUseAsReference(message, plain.slice(0, 2000))}
          title="将该条 AI 输出作为插画/立绘的参考片段"
        >
          用作插画参考
        </button>
      ) : null}
      {canRegenerate ? (
        <button
          type="button"
          className="underline underline-offset-2 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => onRegenerate(message)}
          disabled={isGenerating}
          title="重新生成这条 AI 输出"
        >
          重新生成
        </button>
      ) : null}
      {canDelete ? (
        <button
          type="button"
          className="underline underline-offset-2 hover:text-gray-700"
          onClick={() => onDeleteMessage?.(message)}
          disabled={isGenerating}
          title="删除这条对话消息"
        >
          删除
        </button>
      ) : null}
    </div>
  );
};

const renderUserActions = (props: {
  message: MagicTeaPartyMessage;
  isGenerating: boolean;
  onStartEdit?: (message: MagicTeaPartyMessage) => void;
  onDeleteMessage?: (message: MagicTeaPartyMessage) => void;
}) => {
  const { message, isGenerating, onStartEdit, onDeleteMessage } = props;
  if (message.role !== 'user') return null;
  const canEdit = typeof onStartEdit === 'function' && !isGenerating;
  const canDelete = typeof onDeleteMessage === 'function' && !isGenerating;
  if (!canEdit && !canDelete) return null;

  return (
    <div className="mt-2 flex items-center justify-end gap-2 text-xs text-gray-500">
      {canEdit ? (
        <button
          type="button"
          className="underline underline-offset-2 hover:text-gray-700"
          onClick={() => onStartEdit?.(message)}
          title="编辑这条输入并创建新的会话分支"
        >
          编辑并分支
        </button>
      ) : null}
      {canDelete ? (
        <button
          type="button"
          className="underline underline-offset-2 hover:text-gray-700"
          onClick={() => onDeleteMessage?.(message)}
          title="删除这条对话消息"
        >
          删除
        </button>
      ) : null}
    </div>
  );
};

export function MagicTeaPartyChatMessage(props: MagicTeaPartyChatMessageProps) {
  const { message, session, preferences, isGenerating, tachieAssets } = props;
  const isUser = message.role === 'user';
  const bubbleClass = isUser ? 'bg-pink-600 text-white' : 'bg-white border border-pink-100 text-gray-800';
  const isRawView = message.role === 'assistant' && props.outputView === 'raw';
  const speakerName =
    message.meta && typeof message.meta === 'object' && typeof (message.meta as any).speakerName === 'string'
      ? String((message.meta as any).speakerName).trim()
      : '';
  const bubbleSpeaker =
    speakerName ||
    (message.role === 'system'
      ? 'system'
      : message.role === 'user'
        ? message.speakerId
          ? getSpeakerNameFromRole(session, message.speakerId)
          : (session?.settings.userDisplayName || preferences.userDisplayName || '旅人').trim() || '旅人'
        : getAssistantPrefix(session));
  const speakerClass = `px-1 text-xs font-semibold ${isUser ? 'text-right text-pink-700' : 'text-gray-600'}`;
  const isSuperseded = isMessageSuperseded(message);
  const isEditing = message.role === 'user' && props.editingMessageId === message.id;
  const editingDraft = typeof props.editingDraft === 'string' ? props.editingDraft : message.content;

  const withHeader = (bubble: ReactNode) => (
    <div className={`space-y-1 ${isSuperseded ? 'opacity-70' : ''}`}>
      <div className={speakerClass}>{bubbleSpeaker}</div>
      {bubble}
      {isSuperseded ? <div className="text-[11px] text-gray-400">该条消息已被更新替换</div> : null}
    </div>
  );

  if (isRawView) {
    return withHeader(
      <div className={`rounded-xl px-4 py-3 ${bubbleClass}`}>
        <div className="whitespace-pre-wrap leading-relaxed">{message.content}</div>
        {renderMessageAttachments(message, session, tachieAssets)}
        {renderAssistantFooter(message)}
        {renderAssistantActions({
          message,
          session,
          isGenerating,
          onUseAsReference: props.onUseAsReference,
          onRegenerate: props.onRegenerate,
          showRegenerate: props.showRegenerate,
          onDeleteMessage: props.onDeleteMessage,
        })}
      </div>
    );
  }

  if (message.role === 'assistant' && Array.isArray(message.segments) && message.segments.length > 0) {
    return withHeader(
      <div className={`rounded-xl px-4 py-3 ${bubbleClass} space-y-2`}>
        {message.segments.map((seg, idx) => {
          if (seg.type === 'narration') {
            return (
              <p key={`${message.id}-n-${idx}`} className="whitespace-pre-wrap leading-relaxed">
                {seg.text}
              </p>
            );
          }
          if (seg.type === 'dialogue') {
            const segSpeakerName = seg.speakerName || getSpeakerNameFromRole(session, seg.speakerId);
            return (
              <div key={`${message.id}-d-${idx}`} className="rounded-lg bg-pink-50 px-3 py-2">
                <div className="text-xs font-semibold text-pink-700">{segSpeakerName}</div>
                <div className="whitespace-pre-wrap leading-relaxed text-gray-800">{seg.text}</div>
              </div>
            );
          }
          if (seg.type === 'choices') {
            return (
              <div key={`${message.id}-c-${idx}`} className="grid gap-2 sm:grid-cols-2">
                {seg.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="rounded-xl border border-pink-200 bg-white px-4 py-2 text-left text-sm font-semibold text-pink-700 hover:bg-pink-50 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={isGenerating || !props.onSelectChoice}
                    onClick={() => props.onSelectChoice?.(item.text)}
                    title="选择该行动"
                  >
                    {item.text}
                  </button>
                ))}
              </div>
            );
          }
          return null;
        })}
        {renderMessageAttachments(message, session, tachieAssets)}
        {renderAssistantFooter(message)}
        {renderAssistantActions({
          message,
          session,
          isGenerating,
          onUseAsReference: props.onUseAsReference,
          onRegenerate: props.onRegenerate,
          showRegenerate: props.showRegenerate,
          onDeleteMessage: props.onDeleteMessage,
        })}
      </div>
    );
  }

  if (isEditing) {
    return withHeader(
      <div className={`rounded-xl px-4 py-3 ${bubbleClass} space-y-2`}>
        <textarea
          className="w-full rounded-lg border border-pink-200 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-pink-200"
          value={editingDraft}
          onChange={(event) => props.onEditDraftChange?.(event.target.value)}
          placeholder="编辑后将创建新会话分支"
          rows={4}
        />
        <div className="flex items-center justify-end gap-2 text-xs text-gray-500">
          <button
            type="button"
            className="rounded-md border border-gray-200 bg-white px-3 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50"
            onClick={() => props.onCancelEdit?.()}
          >
            取消
          </button>
          <button
            type="button"
            className="rounded-md bg-pink-600 px-3 py-1 text-xs font-semibold text-white hover:bg-pink-700 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => props.onConfirmEdit?.(message)}
            disabled={!editingDraft.trim()}
          >
            创建分支
          </button>
        </div>
      </div>
    );
  }

  const metaOutputFormat =
    message.meta && typeof message.meta === 'object' && typeof (message.meta as any).outputFormat === 'string'
      ? (message.meta as any).outputFormat
      : null;
  const preferMarkdown = metaOutputFormat === 'markdown' || (!metaOutputFormat && session?.settings.outputFormat === 'markdown');

  if (message.role === 'assistant' && preferMarkdown) {
    return withHeader(
      <div className={`rounded-xl px-4 py-3 ${bubbleClass}`}>
        <MarkdownBlock content={message.content || ''} variant="light" mode="article" />
        {renderMessageAttachments(message, session, tachieAssets)}
        {renderAssistantFooter(message)}
        {renderAssistantActions({
          message,
          session,
          isGenerating,
          onUseAsReference: props.onUseAsReference,
          onRegenerate: props.onRegenerate,
          showRegenerate: props.showRegenerate,
          onDeleteMessage: props.onDeleteMessage,
        })}
      </div>
    );
  }

  return withHeader(
    <div className={`rounded-xl px-4 py-3 ${bubbleClass}`}>
      <div className="whitespace-pre-wrap leading-relaxed">{message.content}</div>
      {renderMessageAttachments(message, session, tachieAssets)}
      {message.role === 'assistant'
        ? renderAssistantFooter(message)
        : null}
      {message.role === 'assistant'
        ? renderAssistantActions({
            message,
            session,
            isGenerating,
            onUseAsReference: props.onUseAsReference,
            onRegenerate: props.onRegenerate,
            showRegenerate: props.showRegenerate,
          })
        : renderUserActions({
            message,
            isGenerating,
            onStartEdit: props.onStartEdit,
            onDeleteMessage: props.onDeleteMessage,
          })}
    </div>
  );
}
