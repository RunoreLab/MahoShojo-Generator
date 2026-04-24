'use client';

import { useEffect, useState, type ReactNode } from 'react';

import { hasCustomStoryLength, normalizeCustomStoryLength } from '@/lib/story-length';

export type StoryLengthOption = 'default' | 'short' | 'standard' | 'detailed' | 'long';

export type LanguageOption = {
  code: string;
  name: string;
};

type Props = {
  isGenerating: boolean;
  enableUserGuidance: boolean;
  languages?: LanguageOption[];
  allowEmptyLanguage?: boolean;
  showStoryLength?: boolean;
  showLanguage?: boolean;

  userGuidance: string;
  onUserGuidanceChange: (value: string) => void;
  afterUserGuidance?: ReactNode;

  storyLength: StoryLengthOption;
  onStoryLengthChange: (value: StoryLengthOption) => void;
  customStoryLength?: string;
  onCustomStoryLengthChange?: (value: string) => void;

  selectedLanguage: string;
  onSelectedLanguageChange: (value: string) => void;
};

export function StoryOptionsPanel({
  isGenerating,
  enableUserGuidance,
  languages,
  allowEmptyLanguage = false,
  showStoryLength = true,
  showLanguage = true,
  userGuidance,
  onUserGuidanceChange,
  afterUserGuidance,
  storyLength,
  onStoryLengthChange,
  customStoryLength = '',
  onCustomStoryLengthChange = () => {},
  selectedLanguage,
  onSelectedLanguageChange,
}: Props) {
  const storyOptions: { value: StoryLengthOption; label: string }[] = [
    { value: 'default', label: '默认' },
    { value: 'short', label: '简短(300+)' },
    { value: 'standard', label: '标准(600+)' },
    { value: 'detailed', label: '详细(1000+)' },
    { value: 'long', label: '长篇(2000+)' },
  ];

  const normalizedLanguages: LanguageOption[] = [
    ...(allowEmptyLanguage ? [{ code: '', name: '默认（不指定）' }] : []),
    ...(Array.isArray(languages) ? languages : []),
  ];
  const normalizedCustomStoryLength = normalizeCustomStoryLength(customStoryLength);
  const [isCustomStoryLengthMode, setIsCustomStoryLengthMode] = useState(() =>
    hasCustomStoryLength(customStoryLength),
  );

  useEffect(() => {
    if (normalizedCustomStoryLength) {
      setIsCustomStoryLengthMode(true);
    }
  }, [normalizedCustomStoryLength]);

  return (
    <>
      {enableUserGuidance && (
        <div className="input-group">
          <label htmlFor="arena-story-guidance" className="input-label">
            故事方向引导 (可选)
          </label>
          {/* 诱饵字段：优先吸收部分浏览器/系统的账号自动填充，避免误填到业务输入框 */}
          <div className="sr-only" aria-hidden="true">
            <input type="text" name="username" autoComplete="username" tabIndex={-1} readOnly />
            <input type="password" name="password" autoComplete="current-password" tabIndex={-1} readOnly />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="arena-story-guidance"
              name="arena_story_guidance"
              type="text"
              className="input-field flex-1 min-w-[12rem]"
              placeholder="输入关键词或一句话 (最多200字)"
              maxLength={200}
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-form-type="other"
              data-lpignore="true"
              data-1p-ignore="true"
              data-bwignore="true"
              disabled={isGenerating}
              value={userGuidance}
              onChange={(e) => onUserGuidanceChange(e.target.value)}
            />
            {userGuidance.trim() ? (
              <button
                type="button"
                className="battle-lite-tonal-button rounded px-3 py-2 text-xs font-semibold disabled:opacity-50"
                onClick={() => onUserGuidanceChange('')}
                disabled={isGenerating}
              >
                清空
              </button>
            ) : null}
          </div>
          <p className="battle-lite-subtle-text mt-1 text-xs">例如：“在雨中相遇”、“保卫要地”、“猫咖聚会”等。</p>
        </div>
      )}

      {afterUserGuidance}

      {showStoryLength ? (
        <div className="input-group">
          <label className="input-label">期望字数</label>
          <div className="flex flex-wrap gap-2">
            {storyOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => {
                  setIsCustomStoryLengthMode(false);
                  if (normalizedCustomStoryLength) {
                    onCustomStoryLengthChange('');
                  }
                  onStoryLengthChange(option.value);
                }}
                disabled={isGenerating}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                  !isCustomStoryLengthMode && !normalizedCustomStoryLength && storyLength === option.value
                    ? 'battle-lite-chip-active'
                    : 'battle-lite-tonal-button'
                }`}
              >
                {option.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setIsCustomStoryLengthMode(true)}
              disabled={isGenerating}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                isCustomStoryLengthMode || Boolean(normalizedCustomStoryLength)
                  ? 'battle-lite-chip-active'
                  : 'battle-lite-tonal-button'
              }`}
            >
              自定义
            </button>
          </div>
          {isCustomStoryLengthMode || normalizedCustomStoryLength ? (
            <div className="mt-3 space-y-1">
              <label htmlFor="custom-story-length" className="input-label">
                自定义目标字数
              </label>
              <input
                id="custom-story-length"
                name="custom_story_length"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                className="input-field"
                placeholder="输入正整数，例如 1200"
                disabled={isGenerating}
                value={customStoryLength}
                onChange={(e) => onCustomStoryLengthChange(e.target.value.replace(/[^\d]/g, ''))}
              />
              <p className="battle-lite-subtle-text text-xs">
                自定义目标字数仅作参考，生成结果不会严格等于该数字。
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {showLanguage ? (
        <div className="input-group">
          <label htmlFor="language-select" className="input-label">
            <img src="/globe.svg" alt="Language" className="inline-block w-4 h-4 mr-2" />
            生成语言
          </label>
          <select
            id="language-select"
            className="input-field"
            disabled={isGenerating}
            value={selectedLanguage}
            onChange={(e) => onSelectedLanguageChange(e.target.value)}
          >
            {normalizedLanguages.map((lang) => (
              <option key={lang.code || '__default__'} value={lang.code}>
                {lang.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </>
  );
}
