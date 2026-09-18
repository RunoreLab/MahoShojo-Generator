import { describe, expect, it } from 'vitest';

import {
  getSystemPrompt as getSharedSystemPrompt,
} from '@mahoshojo/hosted-runtime/arena-generation';
import { getSystemPrompt as getLegacySystemPrompt } from '@/lib/arena/constants';

const combatants = [
  {
    type: 'magical-girl',
    data: {
      codename: '星火',
      analysis: { personality: '坚定' },
      buildState: { level: '叶级' },
      userAnswers: [{ question: '你的真实名字是？', answer: '白思与' }],
      arena_history: {
        entries: [{
          id: 2,
          title: '旧日雨战',
          participants: ['星火', '夜潮'],
          winner: '星火',
          impact: '学会信任',
          metadata: {
            user_guidance: null,
            character_guidance: '保护同伴',
            scenario_title: null,
            non_native_data_involved: false,
          },
        }],
      },
      current_state: { summary: '轻伤', fields: [] },
    },
    characterGuidance: '优先保护站台上的乘客',
  },
  {
    type: 'canshou',
    data: { name: '夜潮', content: '会吞噬光线的蛹级残兽' },
  },
];

describe('Arena and tea-party system prompt compatibility', () => {
  it.each(['classic', 'kizuna', 'daily', 'scenario'])('%s system prompt 保持一致', (mode) => {
    expect(getSharedSystemPrompt(mode, combatants)).toBe(getLegacySystemPrompt(mode, combatants));
  });
});
