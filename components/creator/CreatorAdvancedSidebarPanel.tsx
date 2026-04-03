import AiProviderSelector, { type UserAIProviderConfig } from '@/components/AiProviderSelector';
import { ProviderCooldownNotice } from '@/components/ai/ProviderCooldownNotice';
import {
  CREATOR_INPUT_CLASS,
  CREATOR_SUBPANEL_SURFACE_CLASS,
  joinCreatorClassNames,
} from '@/components/creator/surfaceStyles';
import { GenerationModeSwitcher, type GenerationMode } from '@/components/shared/GenerationModeSwitcher';
import { TokenIndicator } from '@/components/shared/TokenIndicator';
import type { ProviderCooldownMode } from '@/lib/cooldown';

type CreatorAdvancedSidebarPanelProps = {
  tokenEstimateText: string;
  selectedLanguage: string;
  languages: Array<{ code: string; name: string }>;
  showLanguageSection: boolean;
  onToggleLanguageSection: () => void;
  onChangeLanguage: (nextLanguage: string) => void;
  generationMode: GenerationMode;
  submitting: boolean;
  onChangeGenerationMode: (mode: GenerationMode) => void;
  generationHint: string;
  onConfigChange: (config: UserAIProviderConfig | null) => void;
  providerCooldownMode: ProviderCooldownMode;
  isCooldown: boolean;
  otherRemainingTime: number;
  showBulkFillSection: boolean;
  onToggleBulkFillSection: () => void;
  bulkAnswers: string;
  onChangeBulkAnswers: (value: string) => void;
  onBulkFill: () => void;
  onClearDraft: () => void;
};

export function CreatorAdvancedSidebarPanel({
  tokenEstimateText,
  selectedLanguage,
  languages,
  showLanguageSection,
  onToggleLanguageSection,
  onChangeLanguage,
  generationMode,
  submitting,
  onChangeGenerationMode,
  generationHint,
  onConfigChange,
  providerCooldownMode,
  isCooldown,
  otherRemainingTime,
  showBulkFillSection,
  onToggleBulkFillSection,
  bulkAnswers,
  onChangeBulkAnswers,
  onBulkFill,
  onClearDraft,
}: CreatorAdvancedSidebarPanelProps) {
  return (
    <div className="space-y-4">
      <TokenIndicator
        text={tokenEstimateText}
        warningText="⚠️ 预计问卷回答较长，可能更易超时/失败。可尝试精简答案或减少问卷数量。"
      />

      <div
        data-creator-advanced-card="language"
        data-creator-surface="subpanel"
        className={joinCreatorClassNames(CREATOR_SUBPANEL_SURFACE_CLASS, 'p-3')}
      >
        <button
          type="button"
          onClick={onToggleLanguageSection}
          className="flex w-full items-center justify-between text-left font-medium text-[color:var(--app-text)] hover:text-sky-500"
        >
          <span>生成语言</span>
          <span className="ml-2">{showLanguageSection ? '▼' : '▶'}</span>
        </button>
        {showLanguageSection ? (
          <div className="mt-3">
            <select
              id="language-select"
              data-creator-control="field"
              value={selectedLanguage}
              onChange={(event) => onChangeLanguage(event.target.value)}
              className={CREATOR_INPUT_CLASS}
              disabled={submitting}
            >
              {languages.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      <div
        data-creator-advanced-card="generation-mode"
        data-creator-surface="subpanel"
        className={joinCreatorClassNames(CREATOR_SUBPANEL_SURFACE_CLASS, 'p-3')}
      >
        <GenerationModeSwitcher
          label="生成方式"
          value={generationMode}
          disabled={submitting}
          helper={false}
          onChange={onChangeGenerationMode}
        />
        <div className="mt-2 text-xs text-[color:var(--app-text-muted)]">{generationHint}</div>
      </div>

      <div
        data-creator-advanced-card="provider"
        data-creator-surface="subpanel"
        className={joinCreatorClassNames(CREATOR_SUBPANEL_SURFACE_CLASS, 'p-3')}
      >
        <AiProviderSelector onConfigChange={onConfigChange} />
        <p className="mt-2 text-xs text-[color:var(--app-text-subtle)]">使用自有 API Key 可缩短冷却至 3 秒，便于批量迭代生成。</p>
        <ProviderCooldownNotice
          currentMode={providerCooldownMode}
          currentIsCooldown={isCooldown}
          otherRemainingTime={otherRemainingTime}
          className="mt-2 text-xs text-[color:var(--app-text-subtle)]"
        />
      </div>

      <div
        data-creator-advanced-card="bulk-fill"
        data-creator-surface="subpanel"
        className={joinCreatorClassNames(CREATOR_SUBPANEL_SURFACE_CLASS, 'p-3')}
      >
        <button
          type="button"
          onClick={onToggleBulkFillSection}
          className="flex w-full items-center justify-between text-left font-medium text-[color:var(--app-text)] hover:text-sky-500"
        >
          <span>一键填充答案</span>
          <span className="ml-2">{showBulkFillSection ? '▼' : '▶'}</span>
        </button>
        {showBulkFillSection ? (
          <div className="mt-3">
            <textarea
              id="bulk-answers"
              data-creator-control="textarea"
              value={bulkAnswers}
              onChange={(event) => onChangeBulkAnswers(event.target.value)}
              placeholder="在此处粘贴所有答案：支持每行一个、Q/A 复制内容、编号列表、JSON。"
              className={joinCreatorClassNames(CREATOR_INPUT_CLASS, 'h-20')}
              rows={4}
            />
            <div className="mt-2 flex items-center justify-between">
              <button type="button" onClick={onBulkFill} className="text-sm text-sky-600 hover:underline">
                填充
              </button>
              <button type="button" onClick={onClearDraft} className="text-sm text-rose-600 hover:underline">
                清空存档
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
