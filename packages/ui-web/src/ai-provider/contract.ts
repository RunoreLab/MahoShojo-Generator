// AI Provider 选择器的宿主注入契约。
//
// 本切片刻意不触碰任何具体宿主 API：`window.localStorage`、`fetch`、导航组件、
// 可用性统计来源全部通过 props/端口注入（SPEC-desktop-online DESK-ONLINE-004/005）。
// Web 注入 localStorage 与 `/api/ai/channel-availability`；Desktop 使用同一份
// 受控选择逻辑，但持久化与执行位置由自己的 overlay store / profile bridge 承担。

import type { AIProviderOption } from '@mahoshojo/ai-core/provider-catalog';
import type { UserGenerationOverrides } from '@mahoshojo/ai-core/generation-settings';

/** 宿主提供的 KV 持久化端口（Web: localStorage；缺省调用方必须自行保证可用性）。 */
export interface AiProviderStoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * 单条「provider × model」的可用性统计。
 * 形状与 Web `/api/ai/channel-availability` 返回的条目一致；其他宿主可以注入自己的
 * 数据源，也可以不提供（选择器会正常渲染、不显示徽章）。
 */
export interface AiChannelAvailabilityEntry {
  providerId: string;
  modelId: string;
  primary: {
    window: '1h' | '24h' | 'none';
    successRate: number | null;
    status: 'healthy' | 'degraded' | 'poor' | 'unknown';
  };
  reference?: {
    window: '24h';
    successRate: number;
    status: 'healthy' | 'degraded' | 'poor';
  };
}

/** 跨选择器实例同步的 CustomEvent 名（沿用既有 wire 约定，不改名）。 */
export const AI_PROVIDER_SYNC_EVENT = 'mahoshojo:set-ai-provider-config';

/** 同步事件的 detail 形状：`Partial<UserAIProviderConfig>` 的宽松输入。 */
export interface AiProviderSyncDetail {
  providerId?: unknown;
  modelId?: unknown;
  apiKey?: unknown;
  generationOverrides?: unknown;
}

/** 选择器选项行（provider / model 共用）。 */
export interface AiProviderSelectOption {
  value: string;
  label: string;
  description?: string;
  availability?: AiChannelAvailabilityEntry;
}

export type { AIProviderOption, UserGenerationOverrides };
