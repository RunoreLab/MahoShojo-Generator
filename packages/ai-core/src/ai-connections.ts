// ai-connections.ts
// AI 配置域中「用户连接」一侧的语义：项目预设是共享知识（provider-catalog.ts），
// 这里负责把用户拥有的配置（当前只有 Desktop `DirectProviderProfileV1`）映射成连接视图。
//
// 归属规则（DESK-ONLINE-002/003）：DirectProviderProfileV1 一律是自定义连接——
// 即使它的 baseUrl 与某个项目预设完全相同，也不会被自动认领为预设；「复制为自定义连接」
// 产生的记录从此拥有用户身份，不随预设更新被覆盖。「不认领」由类型边界本身保证：
// 这里不导入、也不提供任何按端点匹配预设的 API。

import type { DirectProviderProfileV1 } from '@mahoshojo/contracts/provider-profile';

/**
 * 自定义连接的列表/展示用只读投影（read model）。
 *
 * 只携带展示与身份字段：连接身份是 `profileId`（Profile 的 opaque id），与预设
 * 的命名 slug 属于不同命名空间——即使有人把 Profile id 起成 `deepseek`，预设查找也
 * 只走 `findAiProviderPreset`，两个命名空间不会发生解析碰撞。
 *
 * **它只是 display model，不是可编辑领域模型**：`DirectProviderProfileV1` 的
 * `secretHeaderRefs`/`publicHeaders`/`generationDefaults`/`transport` 等字段被刻意
 * 排除。持久化权威始终是完整 V1 Profile——编辑一条已有连接必须读回完整 Profile
 * 做 patch/merge，**MUST NOT** 经由本投影做「读取→修改→保存」的有损往返。
 *
 * `apiKeyRef` 只是供 SecretStore 查询（`has_provider_secret` 等）的不透明引用，
 * 不是凭据值，也不得当成已配置凭据的证明——凭据状态由 SecretStore 回答。
 */
export type AiConnectionListItem = {
    kind: 'custom';
    profileId: string;
    name: string;
    adapter: DirectProviderProfileV1['adapter'];
    baseUrl: string;
    modelId: string;
    /** 凭据引用（不透明，不是明文）；Profile 未配置凭据字段时缺省。 */
    apiKeyRef?: string;
    createdAt: string;
    updatedAt: string;
};

/**
 * 把已保存的 Direct Provider Profile 投影成连接列表项。
 *
 * 它**永远**返回 `kind: 'custom'`：V1 Profile 没有预设来源字段，语义上全部是用户自建
 * 连接；端点与某预设一致只是事实，不改变所有权——本模块刻意不提供端点到预设的匹配
 * API，防止「同 URL 自动认领为预设」在调用侧被重新发明。
 */
export const describeProviderProfileConnection = (
    profile: DirectProviderProfileV1
): AiConnectionListItem => ({
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
