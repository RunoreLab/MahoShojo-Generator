import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DirectProviderExecutionProfileSchema,
  DirectProviderProfileV1Schema,
  toDirectProviderExecutionProfile,
  type DirectProviderProfileV1,
} from '../src/provider-profile';

interface ExecutionProfileFixture {
  valid: unknown[];
  invalid: { $case: string; profile: unknown }[];
}

const fixture: ExecutionProfileFixture = JSON.parse(
  readFileSync(
    path.join(import.meta.dirname, '..', 'fixtures', 'provider-execution-profiles.json'),
    'utf8',
  ),
) as ExecutionProfileFixture;

const baseProfile: DirectProviderProfileV1 = {
  version: 1,
  id: 'profile-fixture',
  name: 'Fixture',
  adapter: 'openai-compatible',
  baseUrl: 'https://api.example.com/v1',
  modelId: 'model-1',
  createdAt: '2026-09-30T00:00:00.000Z',
  updatedAt: '2026-09-30T00:00:00.000Z',
};

describe('DirectProviderExecutionProfile', () => {
  it('projects only the fields the native executor must resolve itself', () => {
    const projection = toDirectProviderExecutionProfile({
      ...baseProfile,
      apiKeyRef: 'provider:profile-fixture:api-key',
      generationDefaults: { temperature: 0.4 },
      publicHeaders: { 'x-client': 'mahoshojo-desktop' },
      transport: { maxRedirects: 1 },
    });

    expect(Object.keys(projection).sort()).toEqual([
      'adapter',
      'apiKeyRef',
      'baseUrl',
      'id',
      'modelId',
      'name',
      'publicHeaders',
      'transport',
    ]);
    expect(projection).not.toHaveProperty('generationDefaults');
    expect(projection).not.toHaveProperty('createdAt');
    expect(projection).not.toHaveProperty('version');
  });

  it('never carries a plaintext secret into the projection', () => {
    const projection = toDirectProviderExecutionProfile({
      ...baseProfile,
      secretHeaderRefs: { 'x-tenant-token': 'provider:profile-fixture:x-tenant-token' },
      publicHeaders: { 'x-client': 'mahoshojo-desktop' },
    });

    expect(projection.secretHeaderRefs).toEqual({
      'x-tenant-token': 'provider:profile-fixture:x-tenant-token',
    });
    expect(projection.apiKeyRef).toBeUndefined();
    expect(JSON.stringify(projection)).not.toMatch(/Bearer|sk-/u);
  });

  it('accepts every profile the shared fixture marks valid', () => {
    expect(fixture.valid.length).toBeGreaterThan(0);
    for (const profile of fixture.valid) {
      const parsed = DirectProviderExecutionProfileSchema.safeParse(profile);
      expect(parsed.success, JSON.stringify(profile)).toBe(true);
    }
  });

  it('rejects every profile the shared fixture marks invalid', () => {
    expect(fixture.invalid.length).toBeGreaterThan(0);
    for (const { $case, profile } of fixture.invalid) {
      const parsed = DirectProviderExecutionProfileSchema.safeParse(profile);
      expect(parsed.success, `${$case} must be rejected`).toBe(false);
    }
  });

  it('re-applies the cross-field rules instead of relying on pick() inheritance', () => {
    // Zod 4 的 .pick() 不携带对象级检查，所以投影必须显式挂同一份规则；
    // 同时投影是 strict 的，Rust 不解析的字段不得借此通道进入执行路径。
    const overlapping = {
      id: 'profile-fixture',
      name: 'Fixture',
      adapter: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      modelId: 'model-1',
      secretHeaderRefs: { 'X-Client': 'provider:profile-fixture:x-client' },
      publicHeaders: { 'x-client': 'value' },
    };
    expect(DirectProviderExecutionProfileSchema.safeParse(overlapping).success).toBe(false);
    expect(DirectProviderProfileV1Schema.safeParse({ ...baseProfile, ...overlapping }).success).toBe(
      false,
    );

    expect(
      DirectProviderExecutionProfileSchema.safeParse({
        ...toDirectProviderExecutionProfile(baseProfile),
        generationDefaults: { temperature: 0.4 },
      }).success,
    ).toBe(false);
  });

  it('requires explicit confirmation for cleartext HTTP to a non-loopback host', () => {
    // transport.allowPublicHttp 在此之前只是一个从未被强制执行的字段。
    for (const host of ['api.example.com', '10.0.0.5', 'mahoshojo.colanns.me']) {
      const insecure = { ...baseProfile, baseUrl: `http://${host}/v1` };
      expect(DirectProviderProfileV1Schema.safeParse(insecure).success, host).toBe(false);
      expect(
        DirectProviderProfileV1Schema.safeParse({
          ...insecure,
          transport: { allowPublicHttp: true },
        }).success,
        host,
      ).toBe(true);
    }

    // loopback 明文 HTTP 是本地推理服务的正常形态，不需要额外确认。
    for (const host of ['127.0.0.1', '127.0.0.53', 'localhost', '[::1]']) {
      expect(
        DirectProviderProfileV1Schema.safeParse({ ...baseProfile, baseUrl: `http://${host}:11434/v1` })
          .success,
        host,
      ).toBe(true);
    }
  });
});
