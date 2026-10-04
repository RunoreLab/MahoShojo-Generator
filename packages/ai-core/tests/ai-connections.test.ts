import {
    describeProviderProfileConnection,
} from '@mahoshojo/ai-core/ai-connections';
import { findAiProviderPreset } from '@mahoshojo/ai-core/provider-catalog';
import {
    DirectProviderProfileV1Schema,
    type DirectProviderProfileV1,
} from '@mahoshojo/contracts/provider-profile';

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
        const item = describeProviderProfileConnection(profile);
        expect(item).toEqual({
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

    it('未配置凭据的 Profile 列表项不含 apiKeyRef', () => {
        const item = describeProviderProfileConnection(buildProfile());
        expect(item).not.toHaveProperty('apiKeyRef');
    });

    it('端点与预设相同的 Profile 仍属自定义连接，不被认领为预设', () => {
        const deepseek = findAiProviderPreset('deepseek');
        expect(deepseek).not.toBeNull();
        const profile = buildProfile({ baseUrl: deepseek!.baseUrl });

        // 归属规则由类型边界保证：ai-connections 不提供端点到预设的匹配 API，
        // 「同 URL 自动认领为预设」在调用侧无处生长。
        const item = describeProviderProfileConnection(profile);
        expect(item.kind).toBe('custom');
        expect(item.profileId).toBe('p_test01');
    });

    it('完整 V1 Profile 经 schema round-trip 无损，持久化权威不含糊', () => {
        const profile = buildProfile({
            apiKeyRef: 'provider:p_test01:api-key',
            secretHeaderRefs: { 'x-custom-secret': 'provider:p_test01:x-secret' },
            publicHeaders: { 'x-org': 'acme' },
            generationDefaults: { temperature: 0.7, max_tokens: 512 },
            transport: { allowPublicHttp: false, maxRedirects: 1 },
            updatedAt: '2026-10-01T00:00:00.000Z',
        });
        // 持久化/编辑的权威是完整 Profile——headers/defaults/transport/secretRef/时间
        // 全部经 schema 往返保留。
        expect(DirectProviderProfileV1Schema.parse(profile)).toEqual(profile);
    });

    it('列表项只是 display model：headers/defaults/transport 不进入投影', () => {
        const profile = buildProfile({
            apiKeyRef: 'provider:p_test01:api-key',
            secretHeaderRefs: { 'x-custom-secret': 'provider:p_test01:x-secret' },
            publicHeaders: { 'x-org': 'acme' },
            generationDefaults: { temperature: 0.7 },
            transport: { maxRedirects: 1 },
        });
        const item = describeProviderProfileConnection(profile);
        // 「读 summary → 编辑 → 保存」必须被结构上禁止：投影里根本没有这些字段。
        for (const key of [
            'secretHeaderRefs',
            'publicHeaders',
            'generationDefaults',
            'transport',
        ] as const) {
            expect(item).not.toHaveProperty(key);
        }
        // apiKeyRef 只是 SecretStore 查询用的不透明引用，不是凭据状态。
        expect(item.apiKeyRef).toBe('provider:p_test01:api-key');
    });

    it('预设 id 与 Profile id 分属不同命名空间', () => {
        // 即便用户把 Profile id 起成与预设同名的 slug，连接身份仍是 opaque profileId；
        // 预设查找只查项目预设集合，不会被 profile id 干扰。
        const profile = buildProfile({ id: 'deepseek' });
        const item = describeProviderProfileConnection(profile);
        expect(item).toMatchObject({ kind: 'custom', profileId: 'deepseek' });
        expect(findAiProviderPreset('deepseek')?.endpointKind).toBe('provider-public');
    });
});
