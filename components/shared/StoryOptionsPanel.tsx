'use client';

import type { ReactNode } from 'react';

export type StoryLengthOption = 'default' | 'short' | 'standard' | 'detailed' | 'long';

export type LanguageOption = {
  code: string;
  name: string;
};

const battleLevels = [
  { value: '', label: '默认 (AI自动分配)' },
  { value: '种级', label: '种级 🌱' },
  { value: '芽级', label: '芽级 🍃' },
  { value: '叶级', label: '叶级 🌿' },
  { value: '蕾级', label: '蕾级 🌸' },
  { value: '花级', label: '花级 🌺' },
];

type Props = {
  battleMode: string;
  isGenerating: boolean;
  enableUserGuidance: boolean;
  languages?: LanguageOption[];
  allowEmptyLanguage?: boolean;

  selectedLevel: string;
  onSelectedLevelChange: (value: string) => void;

  userGuidance: string;
  onUserGuidanceChange: (value: string) => void;
  afterUserGuidance?: ReactNode;

  storyLength: StoryLengthOption;
  onStoryLengthChange: (value: StoryLengthOption) => void;

  selectedLanguage: string;
  onSelectedLanguageChange: (value: string) => void;
};

export function StoryOptionsPanel({
  battleMode,
  isGenerating,
  enableUserGuidance,
  languages,
  allowEmptyLanguage = false,
  selectedLevel,
  onSelectedLevelChange,
  userGuidance,
  onUserGuidanceChange,
  afterUserGuidance,
  storyLength,
  onStoryLengthChange,
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

  return (
    <>
      {battleMode !== 'daily' && (
        <div className="input-group">
          <label htmlFor="level-select" className="input-label">
            指定平均等级 (可选):
          </label>
          <select
            id="level-select"
            className="input-field"
            style={{ cursor: 'pointer' }}
            disabled={isGenerating}
            value={selectedLevel}
            onChange={(e) => onSelectedLevelChange(e.target.value)}
          >
            {battleLevels.map((level) => (
              <option key={level.value} value={level.value}>
                {level.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500 mt-1">默认由 AI 根据角色强度自动分配，以保证战斗平衡和观赏性。</p>
        </div>
      )}

      {enableUserGuidance && (
        <div className="input-group">
          <label htmlFor="user-guidance" className="input-label">
            故事方向引导 (可选)
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="user-guidance"
              name="maho-story-guidance"
              type="text"
              className="input-field flex-1 min-w-[12rem]"
              placeholder="输入关键词或一句话 (最多200字)"
              maxLength={200}
              autoComplete="off"
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
                className="px-3 py-2 text-xs font-semibold rounded bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                onClick={() => onUserGuidanceChange('')}
                disabled={isGenerating}
              >
                清空
              </button>
            ) : null}
          </div>
          <p className="text-xs text-gray-500 mt-1">例如：“在雨中相遇”、“保卫要地”、“猫咖聚会”等。</p>
        </div>
      )}

      {afterUserGuidance}

      <div className="input-group">
        <label className="input-label">期望字数</label>
        <div className="flex flex-wrap gap-2">
          {storyOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => onStoryLengthChange(option.value)}
              disabled={isGenerating}
              className={`px-3 py-1.5 text-xs font-semibold rounded-full transition-colors ${
                storyLength === option.value ? 'bg-pink-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

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
    </>
  );
}
