'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import AiProviderSelector from '@/components/AiProviderSelector';
import { config as appConfig } from '@/lib/config';

import { useBattleStore } from '../stores/useBattleStore';
import { BattleStoreState, LanguageOption, StoryLengthOption } from '../types';
import { StoryPreferencesFormValues, StoryPreferencesSchema } from '../utils/schemas';

const battleLevels = [
  { value: '', label: '默认 (AI自动分配)' },
  { value: '种级', label: '种级 🌱' },
  { value: '芽级', label: '芽级 🍃' },
  { value: '叶级', label: '叶级 🌿' },
  { value: '蕾级', label: '蕾级 🌸' },
  { value: '花级', label: '花级 🌺' },
];

interface StoryOptionsProps {
  languages: LanguageOption[] | undefined;
}

export function StoryOptions({ languages }: StoryOptionsProps) {
  const useBattleSelector = <T,>(selector: (state: BattleStoreState) => T) => useBattleStore(selector);
  const battleMode = useBattleSelector((state) => state.battleMode);
  const storyLength = useBattleSelector((state) => state.storyLength);
  const setStoryLength = useBattleSelector((state) => state.setStoryLength);
  const selectedLevel = useBattleSelector((state) => state.selectedLevel);
  const setSelectedLevel = useBattleSelector((state) => state.setSelectedLevel);
  const selectedLanguage = useBattleSelector((state) => state.selectedLanguage);
  const setSelectedLanguage = useBattleSelector((state) => state.setSelectedLanguage);
  const settings = useBattleSelector((state) => state.settings);
  const updateSettings = useBattleSelector((state) => state.updateSettings);
  const isGenerating = useBattleSelector((state) => state.isGenerating);
  const setUserProviderConfig = useBattleSelector((state) => state.setUserProviderConfig);

  const form = useForm<StoryPreferencesFormValues>({
    resolver: zodResolver(StoryPreferencesSchema),
    defaultValues: {
      selectedLevel,
      selectedLanguage,
      userGuidance: settings.userGuidance,
    },
    mode: 'onChange',
  });

  useEffect(() => {
    form.reset({
      selectedLevel,
      selectedLanguage,
      userGuidance: settings.userGuidance,
    });
  }, [form, selectedLanguage, selectedLevel, settings.userGuidance]);

  useEffect(() => {
    const subscription = form.watch((values) => {
      setSelectedLevel(values.selectedLevel ?? '');
      setSelectedLanguage(values.selectedLanguage ?? selectedLanguage);
      if (typeof values.userGuidance === 'string') {
        updateSettings({ userGuidance: values.userGuidance });
      }
    });
    return () => subscription.unsubscribe();
  }, [form, selectedLanguage, setSelectedLanguage, setSelectedLevel, updateSettings]);

  const storyOptions: { value: StoryLengthOption; label: string }[] = [
    { value: 'default', label: '默认' },
    { value: 'short', label: '简短(300+)' },
    { value: 'standard', label: '标准(600+)' },
    { value: 'detailed', label: '详细(1000+)' },
    { value: 'long', label: '长篇(2000+)' },
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
            {...form.register('selectedLevel')}
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

      <div className="input-group">
        <label className="input-label">期望字数</label>
        <div className="flex flex-wrap gap-2">
          {storyOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => setStoryLength(option.value)}
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
          {...form.register('selectedLanguage')}
        >
          {(languages || []).map((lang) => (
            <option key={lang.code} value={lang.code}>
              {lang.name}
            </option>
          ))}
        </select>
      </div>

      {appConfig.ENABLE_ARENA_USER_GUIDANCE && (
        <div className="input-group">
          <label htmlFor="user-guidance" className="input-label">
            故事方向引导 (可选)
          </label>
          <input
            id="user-guidance"
            type="text"
            className="input-field"
            placeholder="输入关键词或一句话 (最多50字)"
            maxLength={50}
            disabled={isGenerating}
            {...form.register('userGuidance')}
          />
          <p className="text-xs text-gray-500 mt-1">例如：“在雨中相遇”、“保卫要地”、“猫咖聚会”等。</p>
        </div>
      )}

      <AiProviderSelector onConfigChange={setUserProviderConfig} />
    </>
  );
}
