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
  /**
   * 分组标题（DESK-AIP-002）：相同 `group` 的连续选项渲染在同一分组下，
   * 如「内置供应商」「我的连接」。缺省不分组。
   */
  group?: string;
  /**
   * 选项身份标记（如 `preset` / `connection`）：真实 Profile 与目录预设即使
   * 显示名、Endpoint 相同也按身份区分；本字段只做展示/归类标记，`value`
   * 的唯一性仍由宿主保证。
   */
  kind?: string;
  /** 不可选；须同时给出 `disabledReason` 解释原因，不提供空转选项。 */
  disabled?: boolean;
  disabledReason?: string;
}

/**
 * 选择菜单操作区的独立动作（DESK-AIP-002）：如「＋ 新建自定义连接」「管理连接」。
 * 动作不是 Provider/模型选项：经 `onAction` 派发，绝不进入 `onChange` 的取值空间。
 */
export interface AiProviderSelectAction {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
  disabledReason?: string;
}

export type { AIProviderOption, UserGenerationOverrides };
