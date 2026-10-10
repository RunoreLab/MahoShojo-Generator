import { describe, expect, it } from 'vitest';
import { encodeHostedStoryClientBodyIntent, digestHostedStoryClientBodyIntent } from '../src/arena-story-commit';
const inputDigest = `sha256:${'a'.repeat(64)}`;

describe('bounded story creation intent v1', () => {
  it('folds absent/default system, empty overrides and signed zero without JSON property-order dependence', () => {
    const funding = { mode: 'system' as const, providerId: 'system' as const, modelId: 'default' };
    expect(digestHostedStoryClientBodyIntent({ inputDigest })).toBe(digestHostedStoryClientBodyIntent({ inputDigest, funding }));
    expect(digestHostedStoryClientBodyIntent({ inputDigest, funding: { ...funding, generationOverrides: {} } })).toBe(digestHostedStoryClientBodyIntent({ inputDigest }));
    expect(digestHostedStoryClientBodyIntent({ inputDigest, funding: { ...funding, generationOverrides: { temperature: -0 } } }))
      .toBe(digestHostedStoryClientBodyIntent({ inputDigest, funding: { ...funding, generationOverrides: { temperature: 0 } } }));
    const first = { ...funding, generationOverrides: { maxOutputTokens: 1, temperature: 0.1 } };
    const second = { generationOverrides: { temperature: 0.1, maxOutputTokens: 1 }, modelId: 'default', providerId: 'system' as const, mode: 'system' as const };
    expect(digestHostedStoryClientBodyIntent({ inputDigest, funding: first })).toBe(digestHostedStoryClientBodyIntent({ funding: second, inputDigest }));
  });
  it('rejects unresolved or lossy model identities instead of silently changing the hash', () => {
    for (const modelId of [' default ', '\ud800', '\udfff']) {
      expect(() => encodeHostedStoryClientBodyIntent({ inputDigest, funding: { mode: 'system', providerId: 'system', modelId } })).toThrow();
      expect(() => encodeHostedStoryClientBodyIntent({ inputDigest, funding: { mode: 'preset', providerId: 'deepseek', modelId } })).toThrow();
    }
    expect(() => encodeHostedStoryClientBodyIntent({ inputDigest, funding: { mode: 'system', providerId: 'system', modelId: 'default',
      generationOverrides: { temperature: Number.POSITIVE_INFINITY } } })).toThrow();
  });
  it('rejects credentials, protocol mutation and stale revision in the hash input', () => {
    for (const key of ['apiKey', 'body', 'storyProtocolVersion', 'pendingRevision', 'serverPayloadHash']) {
      expect(() => encodeHostedStoryClientBodyIntent({ inputDigest, [key]: 'unexpected' })).toThrow();
    }
  });
  it('binds the exact input digest and every frozen non-secret funding choice', () => {
    const funding = { mode: 'preset' as const, providerId: 'deepseek', modelId: 'deepseek-v4-flash' };
    const base = digestHostedStoryClientBodyIntent({ inputDigest, funding });
    for (const input of [
      { inputDigest: `sha256:${'f'.repeat(64)}`, funding },
      { inputDigest, funding: { ...funding, providerId: 'openai' } },
      { inputDigest, funding: { ...funding, modelId: 'another-model' } },
      { inputDigest, funding: { ...funding, generationOverrides: { maxOutputTokens: 1 } } },
      { inputDigest, funding: { ...funding, generationOverrides: { temperature: 0 } } },
      { inputDigest, funding: { ...funding, generationOverrides: { thinking: { mode: 'default' as const } } } },
    ]) expect(digestHostedStoryClientBodyIntent(input)).not.toBe(base);
  });
});
