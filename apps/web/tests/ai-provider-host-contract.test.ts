// Web 侧 AiProviderSelector 薄封装的宿主契约回归（D5.0b-r1）。
//
// 共源抽取后 Web 正常路径无行为变化是冻结要求（DESK-ONLINE-003）：
// localStorage key 布局、`mahoshojo:set-ai-provider-config` 同步事件、
// `/api/ai/channel-availability` 数据源、`system` wire 与默认导出契约都必须保持。
// 存储端口的 `typeof window` 容错是有意的 robustness 改进（隐私模式下不再抛异常），
// 这里钉住的是宿主注入边界，而不是逐字实现。

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import {
  AI_PROVIDER_SYNC_EVENT,
  DEFAULT_AI_PROVIDER_STORAGE_NAMESPACE,
  createAiProviderStorageKeys,
} from '@mahoshojo/ui-web/ai-provider';

describe('Web AI provider selector host contract', () => {
  it('keeps the legacy storage namespace and key layout', () => {
    expect(DEFAULT_AI_PROVIDER_STORAGE_NAMESPACE).toBe('arena.customProvider');
    const keys = createAiProviderStorageKeys(DEFAULT_AI_PROVIDER_STORAGE_NAMESPACE);
    expect(keys.selectedProvider).toBe('arena.customProvider.selected');
    expect(keys.apiKeyPrefix).toBe('arena.customProvider.apiKey.');
    expect(keys.modelPrefix).toBe('arena.customProvider.model.');
    expect(keys.customModelPrefix).toBe('arena.customProvider.customModel.');
    expect(keys.maxOutputTokensPrefix).toBe('arena.customProvider.maxOutputTokens.');
    expect(keys.generationOverridesPrefix).toBe('arena.customProvider.generationOverrides.');
  });

  it('keeps the cross-instance sync event name stable', () => {
    expect(AI_PROVIDER_SYNC_EVENT).toBe('mahoshojo:set-ai-provider-config');
  });

  it('wires only the documented host ports into the shared view', async () => {
    const source = await readFile('components/AiProviderSelector.tsx', 'utf8');

    // 对外契约：默认导出 + UserAIProviderConfig re-export（约十个页面依赖）。
    expect(source).toContain('export default AiProviderSelector');
    expect(source).toMatch(/export type \{ UserAIProviderConfig \}/u);

    // 存储端口：localStorage 注入 + SSR/受限环境容错（有意的 robustness 改进）。
    expect(source).toContain('window.localStorage');
    expect(source).toContain("typeof window === 'undefined'");

    // 可用性数据源仍是项目固定路由。
    expect(source).toContain("'/api/ai/channel-availability'");

    // 跨实例同步走冻结的 CustomEvent 名。
    expect(source).toContain('AI_PROVIDER_SYNC_EVENT');

    // 文档入口仍是宿主注入的 Next Link 渲染。
    expect(source).toContain('renderDocsLink');
    expect(source).toContain('from \'next/link\'');

    // Web 不开放任意 endpoint / 自定义 Provider 实体 / 浏览器直连：
    // 不向视图注入 providers 覆盖，也不渲染执行位置或 Direct 控件。
    expect(source).not.toContain('providers=');
    expect(source).not.toContain('AiExecutionLocationField');
    expect(source).not.toContain('execution-location');
    expect(source).not.toMatch(/direct-local|direct-remote/iu);
  });
});
