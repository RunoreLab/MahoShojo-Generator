// ai-connections.ts
// AI 配置域中「用户连接」一侧的语义：Registry/预设是项目知识（provider-catalog.ts），
// 这里负责把用户拥有的配置（当前只有 Desktop `DirectProviderProfileV1`）映射成连接视图。
//
// 归属规则（DESK-ONLINE-002/003）：DirectProviderProfileV1 一律是自定义连接——
// 即使它的 baseUrl 与某个项目预设完全相同，也不会被自动认领为预设；「复制为自定义连接」
// 产生的记录从此拥有用户身份，不随预设更新被覆盖。

import type { DirectProviderProfileV1 } from '@mahoshojo/contracts/provider-profile';

import { AI_PROVIDER_REGISTRY, type AiProviderPreset } from './provider-catalog';

/**
 * 自定义连接的用户侧摘要。
 *
 * 只携带展示与身份字段：连接身份是 `profileId`（Profile 的 opaque id），与 Registry
 * 的命名 slug 属于不同命名空间——即使有人把 Profile id 起成 `deepseek`，预设查找也
 * 只走 `findAiProviderPreset`，两个命名空间不会发生解析碰撞。
 */
export type AiConnectionSummary = {
    kind: 'custom';
    profileId: string;
    name: string;
    adapter: DirectProviderProfileV1['adapter'];
    baseUrl: string;
    modelId: string;
    /** 凭据引用（不是明文）；未配置凭据时缺省。 */
    apiKeyRef?: string;
    createdAt: string;
    updatedAt: string;
};

/**
 * 把已保存的 Direct Provider Profile 投影成连接摘要。
 *
 * 它**永远**返回 `kind: 'custom'`：V1 Profile 没有预设来源字段，语义上全部是用户自建
 * 连接；端点与某预设一致只是信息性事实（见 `matchAiPresetByBaseUrl`），不改变所有权。
 */
export const describeProviderProfileConnection = (
    profile: DirectProviderProfileV1
): AiConnectionSummary => ({
    kind: 'custom',
    profileId: profile.id,
    name: profile.name,
    adapter: profile.adapter,
    baseUrl: profile.baseUrl,
    modelId: profile.modelId,
    ...(profile.apiKeyRef !== undefined ? { apiKeyRef: profile.apiKeyRef } : {}),
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
});

const normalizeBaseUrlForMatch = (baseUrl: string): string | null => {
    try {
        const url = new URL(baseUrl.trim());
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
    } catch {
        return null;
    }
};

/**
 * 信息性匹配：这个 baseUrl 是否恰好等于某个项目预设的端点。
 *
 * 只用于 UI 标注「与预设 X 端点相同」之类的说明；**不得**反过来用它把一条自定义连接
 * 展示或按预设处理（预设身份只能来自「复制为自定义连接」的显式记录，V1 无此来源）。
 */
export const matchAiPresetByBaseUrl = (baseUrl: string): AiProviderPreset | null => {
    const normalized = normalizeBaseUrlForMatch(baseUrl);
    if (normalized === null) return null;
    return AI_PROVIDER_REGISTRY.find(
        (preset) => normalizeBaseUrlForMatch(preset.baseUrl) === normalized
    ) ?? null;
};
