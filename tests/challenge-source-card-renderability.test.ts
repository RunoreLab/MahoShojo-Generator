import { describe, expect, test } from 'bun:test';

import {
  inferChallengeRenderableTemplate,
  isChallengeRenderableSourceCard,
} from '@/lib/challenge/source-card-renderability';
import { GENERAL_CHARACTER_TEMPLATE_ID } from '@/lib/schemas/general-character';

describe('challenge source card renderability', () => {
  test('magical-girl 需要完整关键字段', () => {
    expect(
      isChallengeRenderableSourceCard({
        codename: '雪绒',
      }),
    ).toBe(false);
  });

  test('完整 magical-girl 会被识别并通过', () => {
    const card = {
      codename: '雪绒',
      appearance: {},
      magicConstruct: {},
      wonderlandRule: {},
      blooming: {},
      analysis: {},
    };

    expect(inferChallengeRenderableTemplate(card)).toBe('magical-girl');
    expect(isChallengeRenderableSourceCard(card)).toBe(true);
  });

  test('general 模板对象会被识别并通过', () => {
    const card = {
      templateId: GENERAL_CHARACTER_TEMPLATE_ID,
      name: '雪绒',
      content: '这是一张通用角色卡。',
    };

    expect(inferChallengeRenderableTemplate(card)).toBe('general');
    expect(isChallengeRenderableSourceCard(card)).toBe(true);
  });

  test('未知模板会被拒绝', () => {
    const card = {
      title: '无法识别模板的对象',
      body: '这不是 challenge 可直接展示的角色卡。',
    };

    expect(inferChallengeRenderableTemplate(card)).toBeNull();
    expect(isChallengeRenderableSourceCard(card)).toBe(false);
  });
});
