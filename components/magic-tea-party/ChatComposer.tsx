import type { ChangeEvent } from 'react';

import type { MagicTeaPartyPreferences, MagicTeaPartySession } from '@/lib/magic-tea-party/types';

type MagicTeaPartyChatComposerProps = {
  activeSession: MagicTeaPartySession | null;
  preferences: MagicTeaPartyPreferences;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: (value: string) => void;
  onContinue: () => void;
  onGenerateChoices: () => void;
  isGenerating: boolean;
  hasMessages: boolean;
};

export function MagicTeaPartyChatComposer(props: MagicTeaPartyChatComposerProps) {
  const {
    activeSession,
    preferences,
    draft,
    onDraftChange,
    onSend,
    onContinue,
    onGenerateChoices,
    isGenerating,
    hasMessages,
  } = props;

  const outputFormat = activeSession?.settings.outputFormat ?? preferences.outputFormat;
  const canSend = Boolean(activeSession && !isGenerating && draft.trim());
  const canAction = Boolean(activeSession && !isGenerating);
  const hasSession = Boolean(activeSession);

  return (
    <div className="mt-4 grid gap-2">
      <textarea
        className="input-field h-24 resize-y"
        value={draft}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onDraftChange(event.target.value)}
        placeholder="输入你的行动、对白或叙事，例如：我推开奶茶店的门，风铃轻响……"
        disabled={!activeSession || isGenerating}
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 text-xs text-gray-500">
          {!hasSession
            ? '提示：请先新建或选择会话，再开始对话。'
            : outputFormat === 'markdown'
              ? '提示：Markdown 模式不会稳定解析选项/角色分段。'
              : '提示：JSONL 模式可解析旁白/对白/选项。'}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="flex-none whitespace-nowrap rounded-lg border border-pink-200 bg-white px-3 py-2 text-xs font-semibold text-pink-700 hover:bg-pink-50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canAction}
            onClick={onContinue}
            title={hasMessages ? '无需输入，继续推进剧情（会消耗 Token）' : '让 AI 根据角色/情景生成开场内容（会消耗 Token）'}
          >
            {hasMessages ? '继续生成' : '生成开场'}
          </button>
          <button
            type="button"
            className="flex-none whitespace-nowrap rounded-lg border border-pink-200 bg-white px-3 py-2 text-xs font-semibold text-pink-700 hover:bg-pink-50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canAction}
            onClick={onGenerateChoices}
            title="根据当前剧情生成下一步行动选项"
          >
            生成选项
          </button>
          <button
            type="button"
            className="flex-none whitespace-nowrap rounded-lg bg-pink-600 px-4 py-2 text-xs font-semibold text-white hover:bg-pink-700 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canSend}
            onClick={() => onSend(draft)}
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
