import {
    describeProviderProfileConnection,
    matchAiPresetByBaseUrl,
} from '@mahoshojo/ai-core/ai-connections';
import { findAiProviderPreset } from '@mahoshojo/ai-core/provider-catalog';
import type { DirectProviderProfileV1 } from '@mahoshojo/contracts/provider-profile';

const buildProfile = (overrides: Partial<DirectProviderProfileV1> = {}): DirectProviderProfileV1 => ({
    version: 1,
    id: 'p_test01',
    name: '测试连接',
    adapter: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:11434/v1',
    modelId: 'qwen3:8b',
    createdAt: '2026-09-30T12:00:00.000Z',
    updatedAt: '2026-09-30T12:00:00.000Z',
    ...overrides,
});

describe('provider profile connection mapping', () => {
    it('V1 Profile 一律映射为自定义连接，保留身份、secretRef 与时间', () => {
        const profile = buildProfile({
            id: 'p_my-conn',
            apiKeyRef: 'provider:p_my-conn:api-key',
            updatedAt: '2026-10-01T00:00:00.000Z',
        });
        const summary = describeProviderProfileConnection(profile);
        expect(summary).toEqual({
            kind: 'custom',
            profileId: 'p_my-conn',
            name: '测试连接',
            adapter: 'openai-compatible',
            baseUrl: 'http://127.0.0.1:11434/v1',
            modelId: 'qwen3:8b',
            apiKeyRef: 'provider:p_my-conn:api-key',
            createdAt: '2026-09-30T12:00:00.000Z',
            updatedAt: '2026-10-01T00:00:00.000Z',
        });
    });

    it('未配置凭据的 Profile 摘要不含 apiKeyRef', () => {
        const summary = describeProviderProfileConnection(buildProfile());
        expect(summary).not.toHaveProperty('apiKeyRef');
    });

    it('端点与预设相同的 Profile 仍属自定义连接，不被认领为预设', () => {
        const deepseek = findAiProviderPreset('deepseek');
        expect(deepseek).not.toBeNull();
        const profile = buildProfile({ baseUrl: deepseek!.baseUrl });

        // 信息性匹配能认出端点相同，但连接身份不变。
        expect(matchAiPresetByBaseUrl(profile.baseUrl)?.id).toBe('deepseek');
        const summary = describeProviderProfileConnection(profile);
        expect(summary.kind).toBe('custom');
        expect(summary.profileId).toBe('p_test01');
    });

    it('端点归一化覆盖尾斜杠与大小写，非 http(s) 不匹配', () => {
        expect(matchAiPresetByBaseUrl('https://api.deepseek.com/')?.id).toBe('deepseek');
        expect(matchAiPresetByBaseUrl('https://API.DEEPSEEK.COM')?.id).toBe('deepseek');
        expect(matchAiPresetByBaseUrl('ftp://api.deepseek.com')).toBeNull();
        expect(matchAiPresetByBaseUrl('not-a-url')).toBeNull();
        expect(matchAiPresetByBaseUrl('https://api.deepseek.com/v1')).toBeNull();
    });

    it('预设 id 与 Profile id 分属不同命名空间', () => {
        // 即便用户把 Profile id 起成与预设同名的 slug，连接身份仍是 opaque profileId；
        // 预设查找只查 Registry，不会被 profile id 干扰。
        const profile = buildProfile({ id: 'deepseek' });
        const summary = describeProviderProfileConnection(profile);
        expect(summary).toMatchObject({ kind: 'custom', profileId: 'deepseek' });
        expect(findAiProviderPreset('deepseek')?.endpointKind).toBe('provider-public');
    });
});
