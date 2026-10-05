import type {
  BattleMode,
  StoryLength,
} from '@mahoshojo/contracts/arena-room';

import { languageDisplayName } from '@/lib/languages';
import { hasCustomStoryLength } from '@/lib/story-length';

/**
 * 多人房间共享配置“值”的用户文案 registry：
 * 配置 diff 与提案摘要共用同一份映射，内部枚举值不得进入一级文案。
 */

export const arenaBattleModeCopy: Readonly<Record<BattleMode, string>> = {
  classic: '经典模式',
  kizuna: '羁绊模式',
  daily: '日常模式',
  scenario: '情景模式',
};

export const arenaStoryLengthCopy: Readonly<Record<StoryLength, string>> = {
  default: '默认',
  short: '简短',
  standard: '标准',
  detailed: '详细',
  long: '长篇',
};

export const arenaStoryLengthValueCopy = (
  storyLength: StoryLength,
  customStoryLength: string | null,
): string => {
  if (hasCustomStoryLength(customStoryLength)) return `自定义（${customStoryLength?.trim()} 字）`;
  return arenaStoryLengthCopy[storyLength];
};

export const arenaLanguageCopy = (code: string): string => languageDisplayName(code);
