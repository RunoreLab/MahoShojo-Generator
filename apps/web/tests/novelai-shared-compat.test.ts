import { expect, it, vi } from 'vitest';
import * as shared from '@mahoshojo/ai-core/novelai';
import * as webSettings from '@/lib/tachie/novelai';
import * as webPrompt from '@/lib/tachie/novelai-prompt';

it('Web 兼容入口引用同一组共享常量与纯指令函数，不保留平行副本', () => {
  expect(webSettings.DEFAULT_NOVELAI_SETTINGS).toBe(shared.DEFAULT_NOVELAI_SETTINGS);
  expect(webSettings.NOVELAI_MODELS).toBe(shared.NOVELAI_MODELS);
  expect(webSettings.NOVELAI_SIZES).toBe(shared.NOVELAI_SIZES);
  expect(webPrompt.NOVELAI_PROMPT_PROFILES).toBe(shared.NOVELAI_PROMPT_PROFILES);
  expect(webPrompt.getNovelAIPromptProfile).toBe(shared.getNovelAIPromptProfile);
  expect(webPrompt.buildNovelAIPromptRewriteInstruction).toBe(shared.buildNovelAIPromptRewriteInstruction);
});

it('Web 预派发错误优先级仍是 Token、提示词、模型、端点、非秘密参数', () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  try {
    const invalid = { ...shared.DEFAULT_NOVELAI_SETTINGS, model: 'invalid', baseUrl: 'invalid', steps: NaN };
    const create = (token: string, prompt: string, patch = {}) =>
      () => webSettings.createNovelAIImageGenerator(token, prompt, { ...invalid, ...patch });
    expect(create('', '')).toThrow('Persistent API Token');
    expect(create('token', '')).toThrow('请填写提示词');
    expect(create('token', 'prompt')).toThrow('仅支持 V4.5');
    expect(create('token', 'prompt', { model: shared.NOVELAI_MODELS[0] })).toThrow('有效的 NovelAI Base URL');
    expect(create('token', 'prompt', { model: shared.NOVELAI_MODELS[0], baseUrl: '' })).toThrow('请检查 NovelAI 参数');
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
