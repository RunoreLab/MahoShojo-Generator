import { MagicTeaPartyChatMessage } from '@/components/magic-tea-party/ChatMessage';

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
  tachieAssets?: MagicTeaPartyTachieAsset[];
  onStopGenerating: () => void;
  onSelectChoice: (text: string) => void;
  onUseAsReference: (message: MagicTeaPartyMessage, plainText: string) => void;
  onRegenerate: (message: MagicTeaPartyMessage) => void;
  canRegenerateMessage: (message: MagicTeaPartyMessage) => boolean;
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
    tachieAssets,
    onStopGenerating,
    onSelectChoice,
    onUseAsReference,
    onRegenerate,
    canRegenerateMessage,
  } = props;

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

      <div className="space-y-3">
        {messages.length === 0 ? (
          <div className="rounded-lg bg-pink-50 px-4 py-3 text-sm text-pink-800">
            还没有对话。输入你的行动、对白或叙事，例如：我推开酒馆的大门……
          </div>
        ) : (
          messages.map((message) => (
            <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className="max-w-[720px] w-full sm:w-auto">
                <MagicTeaPartyChatMessage
                  message={message}
                  session={activeSession}
                  preferences={preferences}
                  isGenerating={isGenerating}
                  tachieAssets={tachieAssets}
                  onSelectChoice={onSelectChoice}
                  onUseAsReference={onUseAsReference}
                  onRegenerate={onRegenerate}
                  showRegenerate={canRegenerateMessage(message)}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
