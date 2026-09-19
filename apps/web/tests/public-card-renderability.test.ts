import { describe, expect, test } from 'vitest';

import {
  inferPublicCardRenderableTemplate,
  isPublicCardRenderable,
} from '@/lib/public-card-cache/renderability';
import { GENERAL_CHARACTER_TEMPLATE_ID } from '@/lib/schemas/general-character';

describe('public card renderability', () => {
  test('magical-girl 需要完整关键字段', () => {
    expect(
      isPublicCardRenderable({
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

    expect(inferPublicCardRenderableTemplate(card)).toBe('magical-girl');
    expect(isPublicCardRenderable(card)).toBe(true);
  });

  test('general 模板对象会被识别并通过', () => {
    const card = {
      templateId: GENERAL_CHARACTER_TEMPLATE_ID,
      name: '雪绒',
      content: '这是一张通用角色卡。',
    };

    expect(inferPublicCardRenderableTemplate(card)).toBe('general');
    expect(isPublicCardRenderable(card)).toBe(true);
  });

  test('未知模板会被拒绝', () => {
    const card = {
      title: '无法识别模板的对象',
      body: '这不是 公开卡缓存可直接展示的角色卡。',
    };

    expect(inferPublicCardRenderableTemplate(card)).toBeNull();
    expect(isPublicCardRenderable(card)).toBe(false);
  });
});
