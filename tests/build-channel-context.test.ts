import { describe, expect, it } from 'vitest';
import { buildChannelContextFromPayload, buildChannelContextFromResolved, buildSystemChannelContext } from '@/lib/ai/availability';

describe('buildChannelContextFromPayload', () => {
  it('null payload → system default', () => {
    const result = buildChannelContextFromPayload(null);
    expect(result).toEqual({ providerId: 'system', modelId: 'default' });
  });

  it('undefined payload → system default', () => {
    const result = buildChannelContextFromPayload(undefined);
    expect(result).toEqual({ providerId: 'system', modelId: 'default' });
  });

  it('payload 有 providerId 和 modelId → 使用 payload 值', () => {
    const result = buildChannelContextFromPayload({ providerId: 'kourichat', modelId: 'gpt-4o' });
    expect(result).toEqual({ providerId: 'kourichat', modelId: 'gpt-4o' });
  });

  it('payload + resolvedModelId → resolvedModelId 优先', () => {
    const result = buildChannelContextFromPayload(
      { providerId: 'kourichat', modelId: 'gpt-4o' },
      'gpt-4o-mini',
    );
    expect(result).toEqual({ providerId: 'kourichat', modelId: 'gpt-4o-mini' });
  });

  it('system provider + resolvedModelId → 使用 resolvedModelId', () => {
    const result = buildChannelContextFromPayload(
      { providerId: 'system', modelId: 'default' },
      'deepseek-v4-flash',
    );
    expect(result).toEqual({ providerId: 'system', modelId: 'deepseek-v4-flash' });
  });

  it('无效 payload（字符串）→ system default', () => {
    const result = buildChannelContextFromPayload('invalid');
    expect(result).toEqual({ providerId: 'system', modelId: 'default' });
  });

  it('无效 payload（缺少 providerId）→ system default', () => {
    const result = buildChannelContextFromPayload({ modelId: 'gpt-4o' });
    expect(result).toEqual({ providerId: 'system', modelId: 'default' });
  });

  it('无效 payload（缺少 modelId）→ system default', () => {
    const result = buildChannelContextFromPayload({ providerId: 'kourichat' });
    expect(result).toEqual({ providerId: 'system', modelId: 'default' });
  });
});

describe('buildChannelContextFromResolved', () => {
  it('返回正确的 providerId 和 modelId', () => {
    const result = buildChannelContextFromResolved('kourichat', 'gpt-4o');
    expect(result).toEqual({ providerId: 'kourichat', modelId: 'gpt-4o' });
  });
});

describe('buildSystemChannelContext', () => {
  it('默认 modelId = default', () => {
    const result = buildSystemChannelContext();
    expect(result).toEqual({ providerId: 'system', modelId: 'default' });
  });

  it('自定义 modelId', () => {
    const result = buildSystemChannelContext('deepseek-v4-flash');
    expect(result).toEqual({ providerId: 'system', modelId: 'deepseek-v4-flash' });
  });
});
