import fixture from '../fixtures/provider-targets.json';
import { describe, expect, it } from 'vitest';
import { ProviderTargetSchema, ProviderModelIdSchema, presetApiKeyRef, providerTargetKey } from '../src/provider-target';

describe('provider target identity', () => {
  it('keeps preset and custom identities independent', () => {
    expect(providerTargetKey(ProviderTargetSchema.parse({ kind: 'preset', providerId: 'deepseek' }))).toBe('preset:deepseek');
    expect(providerTargetKey(ProviderTargetSchema.parse({ kind: 'custom', profileId: 'deepseek' }))).toBe('custom:deepseek');
    expect(presetApiKeyRef('deepseek')).toBe('preset:deepseek:api-key');
  });
  it('rejects renderer endpoint and secret injection', () => {
    expect(ProviderTargetSchema.safeParse({ kind: 'preset', providerId: 'deepseek', baseUrl: 'https://evil.test' }).success).toBe(false);
    expect(ProviderTargetSchema.safeParse({ kind: 'preset', providerId: '../other' }).success).toBe(false);
    expect(ProviderTargetSchema.safeParse({ kind: 'system', apiKey: 'secret' }).success).toBe(false);
  });
  it('normalizes new model choices without truncation', () => {
    expect(ProviderModelIdSchema.parse(' model ')).toBe('model');
    expect(ProviderModelIdSchema.safeParse('a'.repeat(200)).success).toBe(true);
    for (const invalid of ['a'.repeat(201), '😀'.repeat(101), 'a\nb', '   ']) {
      expect(ProviderModelIdSchema.safeParse(invalid).success).toBe(false);
    }
  });
});

 it('matches the same identity and normalization fixtures as Rust', () => {
  for (const target of fixture.validTargets) expect(ProviderTargetSchema.parse(target)).toEqual(target);
  for (const target of fixture.invalidTargets) expect(ProviderTargetSchema.safeParse(target).success).toBe(false);
  for (const model of fixture.models) {
    const parsed = ProviderModelIdSchema.safeParse(model.input);
    expect(parsed.success ? parsed.data : null).toBe(model.output);
  }
});
