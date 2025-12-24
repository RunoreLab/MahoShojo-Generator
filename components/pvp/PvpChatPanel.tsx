'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';

import emotesConfigRaw from '@/config/pvp-chat-emotes.json';
import phrasesConfigRaw from '@/config/pvp-chat-phrases.json';
import quickMessagesConfigRaw from '@/config/pvp-chat-quick-messages.json';
import { UserWithTitle } from '@/components/UserTitle';
import { authStorage } from '@/lib/auth';
import { isSafeEmojiString } from '@/lib/pvp/chat';
import type { UserBadge } from '@/types/badge';

type ViewerRole = 'player' | 'spectator';
type TextMode = 'none' | 'phrase' | 'quick';

type ChatMessage = {
  id: number;
  createdAt: string;
  sender: { userId: number; username: string; prefix?: string | null; role: ViewerRole };
  renderedText: string | null;
  stickerId: string | null;
  emoji: string | null;
};

type ChatResponse = { success: true; messages: ChatMessage[] } | { error: string; code?: string };

type PhrasePattern = (typeof phrasesConfigRaw)['patterns'][number];
type PhraseOption = { id: string; text: string };
type QuickMessage = (typeof quickMessagesConfigRaw)['items'][number];

const EMOTES = emotesConfigRaw.items;
const PATTERNS = phrasesConfigRaw.patterns;
const OPTIONS = phrasesConfigRaw.options as Record<string, PhraseOption[]>;
const QUICK_MESSAGES = quickMessagesConfigRaw.items as QuickMessage[];

const buildOptionsIndex = (): Record<string, Map<string, PhraseOption>> => {
  const idx: Record<string, Map<string, PhraseOption>> = {};
  for (const [k, list] of Object.entries(OPTIONS)) {
    idx[k] = new Map((Array.isArray(list) ? list : []).map((o) => [o.id, o]));
  }
  return idx;
};

const OPTIONS_INDEX = buildOptionsIndex();
const EMOTE_BY_ID = new Map(EMOTES.map((e) => [e.id, e]));
const QUICK_TEXT_BY_ID = new Map(QUICK_MESSAGES.map((m) => [m.id, m.text]));

const buildDefaultSelections = (pattern: PhrasePattern | undefined): Record<string, string> => {
  const selections: Record<string, string> = {};
  if (!pattern) return selections;
  for (const slot of pattern.slots) {
    const list = OPTIONS[slot.optionsKey] ?? [];
    if (list.length > 0) selections[slot.key] = list[0].id;
  }
  return selections;
};

const renderPreview = (pattern: PhrasePattern | undefined, selections: Record<string, string>): string => {
  if (!pattern) return '';
  const values: Record<string, string> = {};
  for (const slot of pattern.slots) {
    const chosen = selections[slot.key];
    const opt = OPTIONS_INDEX[slot.optionsKey]?.get(chosen);
    if (!opt) return '';
    values[slot.key] = opt.text;
  }
  const rendered = pattern.template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');
  return /\{\w+\}/.test(rendered) ? '' : rendered.trim();
};

export function PvpChatPanel(props: {
  roomId: string;
  viewerRole: ViewerRole;
  allowSpectatorChat: boolean;
  members?: { userId: number; username: string; prefix?: string | null; badges?: UserBadge[] }[];
  disabled?: boolean;
}) {
  const [textMode, setTextMode] = useState<TextMode>('none');
  const [patternId, setPatternId] = useState(PATTERNS[0]?.id ?? '');
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [selectedQuickId, setSelectedQuickId] = useState<string | null>(null);
  const [selectedStickerId, setSelectedStickerId] = useState<string | null>(null);
  const [emojiInput, setEmojiInput] = useState('');

  const [localError, setLocalError] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  const pattern = useMemo(() => PATTERNS.find((p) => p.id === patternId), [patternId]);
  const phrasePreviewText = useMemo(() => renderPreview(pattern, selections), [pattern, selections]);
  const quickPreviewText = useMemo(() => (selectedQuickId ? QUICK_TEXT_BY_ID.get(selectedQuickId) ?? '' : ''), [selectedQuickId]);

  const membersById = useMemo(() => {
    const map = new Map<number, { userId: number; username: string; prefix?: string | null; badges?: UserBadge[] }>();
    for (const m of props.members ?? []) {
      if (!m || typeof m.userId !== 'number') continue;
      map.set(m.userId, m);
    }
    return map;
  }, [props.members]);

  const canSend = props.viewerRole === 'player' || props.allowSpectatorChat;
  const emojiOk = !emojiInput.trim() || isSafeEmojiString(emojiInput);

  useEffect(() => {
    const next = PATTERNS.find((p) => p.id === patternId);
    setSelections(buildDefaultSelections(next));
  }, [patternId]);

  const chatQuery = useQuery({
    queryKey: ['pvp-room-chat', props.roomId],
    enabled: Boolean(props.roomId) && props.disabled !== true,
    refetchInterval: 1200,
    queryFn: async (): Promise<ChatMessage[]> => {
      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) throw new Error('未登录');
      const res = await fetch(`/api/pvp/rooms/${props.roomId}/chat`, {
        method: 'GET',
        headers: { Authorization: authHeader },
      });
      const data = (await res.json()) as ChatResponse;
      if (!res.ok) {
        const errorText = (data as any)?.error || `请求失败（HTTP ${res.status}）`;
        throw new Error(errorText);
      }
      return (data as any).messages ?? [];
    },
  });

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onScroll = () => {
      const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottomRef.current = distanceToBottom < 40;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (!stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [chatQuery.data?.length]);

  const sendMutation = useMutation({
    mutationFn: async () => {
      setLocalError(null);
      if (!canSend) throw new Error('当前身份不可聊天');
      if (!emojiOk) throw new Error('仅允许发送通用表情符号（emoji）');

      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) throw new Error('未登录');

      const emoji = emojiInput.trim() || null;
      const phrase =
        textMode === 'phrase' && pattern && Object.keys(selections).length > 0 ? { patternId: pattern.id, selections } : null;
      const quickTextId = textMode === 'quick' ? selectedQuickId : null;

      const res = await fetch(`/api/pvp/rooms/${props.roomId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({
          phrase,
          quickTextId,
          stickerId: selectedStickerId,
          emoji,
        }),
      });
      const data = (await res.json()) as any;
      if (!res.ok) {
        const errorText = data?.error || `发送失败（HTTP ${res.status}）`;
        throw new Error(errorText);
      }
      return data;
    },
    onSuccess: async () => {
      setEmojiInput('');
      setSelectedStickerId(null);
      setSelectedQuickId(null);
      await chatQuery.refetch();
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    },
    onError: (e: any) => setLocalError(e instanceof Error ? e.message : '发送失败'),
  });

  const disabledReason = props.disabled === true ? '聊天暂不可用' : !canSend ? '房主已关闭观众聊天' : null;
  const hasText = textMode === 'phrase' ? Boolean(phrasePreviewText) : textMode === 'quick' ? Boolean(selectedQuickId && quickPreviewText) : false;
  const hasAnyContent = hasText || Boolean(selectedStickerId) || Boolean(emojiInput.trim());

  return (
    <div className="p-4 rounded-xl bg-white border text-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="font-semibold text-gray-900">房间聊天</div>
        <div className="text-xs text-gray-500">
          支持预设文字/快捷消息与表情
        </div>
      </div>

      {disabledReason ? (
        <div className="mt-2 text-xs text-gray-500">{disabledReason}</div>
      ) : null}

      {chatQuery.isError ? (
        <div className="mt-2 text-xs text-red-600 whitespace-pre-wrap">
          {chatQuery.error instanceof Error ? chatQuery.error.message : '加载聊天失败'}
        </div>
      ) : null}

      <div
        ref={listRef}
        className="mt-3 h-72 overflow-y-auto rounded-lg border bg-gray-50 p-3 space-y-2"
      >
        {(chatQuery.data ?? []).length <= 0 ? (
          <div className="text-xs text-gray-500">暂无消息</div>
        ) : (
          (chatQuery.data ?? []).map((m) => (
            <div key={m.id} className="text-xs text-gray-800">
              <div className="flex items-baseline gap-2">
                {(() => {
                  const known = membersById.get(m.sender.userId);
                  const username = (known?.username || m.sender.username || '').trim() || `用户${m.sender.userId}`;
                  const badges = Array.isArray(known?.badges) ? known!.badges! : [];
                  return (
                    <UserWithTitle
                      username={username}
                      prefix={known?.prefix ?? m.sender.prefix}
                      badges={badges}
                      showBadges={true}
                      usernameClassName="font-semibold"
                      titleClassName="text-xs"
                    />
                  );
                })()}
                <span className="text-[11px] text-gray-500">
                  {m.sender.role === 'spectator' ? '观众' : '玩家'} · {new Date(m.createdAt).toLocaleTimeString()}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {m.stickerId ? (
                  <img
                    src={EMOTE_BY_ID.get(m.stickerId)?.src ?? ''}
                    alt={EMOTE_BY_ID.get(m.stickerId)?.label ?? m.stickerId}
                    className="h-10 w-10 rounded bg-white border"
                  />
                ) : null}
                {m.emoji ? <span className="text-lg leading-none">{m.emoji}</span> : null}
                {m.renderedText ? <span className="text-sm">{m.renderedText}</span> : null}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="mt-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-gray-600">文字内容</div>
          <div className="inline-flex rounded-lg border bg-white overflow-hidden">
            {(['none', 'phrase', 'quick'] as const).map((mode) => {
              const label = mode === 'none' ? '关闭' : mode === 'phrase' ? '句式' : '快捷';
              const active = textMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  className={active ? 'px-3 py-1 text-xs bg-blue-50 text-blue-700' : 'px-3 py-1 text-xs hover:bg-gray-50'}
                  onClick={() => setTextMode(mode)}
                  disabled={!canSend || sendMutation.isPending}
                  title={mode === 'none' ? '本次不发送文字' : mode === 'phrase' ? '使用句式组合发送文字' : '发送固定快捷消息'}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {textMode === 'phrase' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-600">句式</span>
            <select
              className="border rounded px-2 py-1"
              value={patternId}
              onChange={(e) => setPatternId(e.target.value)}
              disabled={!canSend || sendMutation.isPending}
            >
              {PATTERNS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-xs text-gray-600">预览</span>
            <div className="border rounded px-2 py-1 bg-gray-50 text-sm min-h-[34px]">
              {phrasePreviewText || <span className="text-gray-400">请选择组合</span>}
            </div>
          </div>
        </div>
        ) : null}

        {textMode === 'phrase' && pattern ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {pattern.slots.map((slot) => {
              const list = OPTIONS[slot.optionsKey] ?? [];
              return (
                <label key={slot.key} className="flex flex-col gap-1">
                  <span className="text-xs text-gray-600">{slot.label}</span>
                  <select
                    className="border rounded px-2 py-1"
                    value={selections[slot.key] ?? ''}
                    onChange={(e) => setSelections((s) => ({ ...s, [slot.key]: e.target.value }))}
                    disabled={!canSend || sendMutation.isPending}
                  >
                    {list.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.text}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
        ) : null}

        {textMode === 'quick' ? (
          <div className="rounded-lg border bg-gray-50 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-gray-600">快捷消息（点击选择/取消）</div>
              <button
                type="button"
                className="text-xs text-blue-700 hover:underline disabled:opacity-50"
                onClick={() => setSelectedQuickId(null)}
                disabled={!canSend || sendMutation.isPending}
              >
                清空快捷
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {QUICK_MESSAGES.map((q) => {
                const selected = selectedQuickId === q.id;
                return (
                  <button
                    type="button"
                    key={q.id}
                    onClick={() => setSelectedQuickId((cur) => (cur === q.id ? null : q.id))}
                    disabled={!canSend || sendMutation.isPending}
                    className={
                      selected
                        ? 'border rounded-full px-3 py-1 bg-blue-50 border-blue-400 text-xs text-blue-800'
                        : 'border rounded-full px-3 py-1 bg-white hover:bg-gray-50 text-xs text-gray-800'
                    }
                    title={q.id}
                  >
                    {q.text}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 text-xs text-gray-600">
              预览：{quickPreviewText ? <span className="text-gray-900 font-semibold">{quickPreviewText}</span> : <span className="text-gray-400">未选择</span>}
            </div>
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-gray-600">表情包（点击选择/取消）</div>
          <button
            type="button"
            className="text-xs text-blue-700 hover:underline disabled:opacity-50"
            onClick={() => setSelectedStickerId(null)}
            disabled={!canSend || sendMutation.isPending}
          >
            清空表情包
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {EMOTES.map((e) => {
            const selected = selectedStickerId === e.id;
            return (
              <button
                type="button"
                key={e.id}
                onClick={() => setSelectedStickerId((cur) => (cur === e.id ? null : e.id))}
                disabled={!canSend || sendMutation.isPending}
                className={
                  selected
                    ? 'border rounded-lg p-1 bg-blue-50 border-blue-400'
                    : 'border rounded-lg p-1 bg-white hover:bg-gray-50'
                }
                title={e.label}
              >
                <img src={e.src} alt={e.label} className="h-10 w-10 rounded" />
              </button>
            );
          })}
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-600">通用表情符号（emoji，可选）</span>
          <input
            className={`border rounded px-2 py-1 ${emojiOk ? '' : 'border-red-400'}`}
            value={emojiInput}
            onChange={(e) => setEmojiInput(e.target.value)}
            placeholder="例如：☺️ 😢"
            disabled={!canSend || sendMutation.isPending}
          />
          {!emojiOk ? <div className="text-xs text-red-600">仅允许 emoji，不支持普通文字</div> : null}
        </label>

        {localError ? <div className="text-xs text-red-600 whitespace-pre-wrap">{localError}</div> : null}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            className="generate-button"
            style={{ backgroundColor: '#3b82f6', backgroundImage: 'linear-gradient(to right, #3b82f6, #2563eb)' }}
            onClick={() => sendMutation.mutate()}
            disabled={!canSend || sendMutation.isPending || !hasAnyContent || !emojiOk}
          >
            {sendMutation.isPending ? '发送中…' : '发送'}
          </button>
        </div>
      </div>
    </div>
  );
}
