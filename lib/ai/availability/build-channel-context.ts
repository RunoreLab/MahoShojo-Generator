import type { GenerateWithAIOptions } from '@/lib/ai';

export type ChannelContext = NonNullable<GenerateWithAIOptions['channelContext']>;

function isProviderPayload(value: unknown): value is { providerId: string; modelId: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).providerId === 'string' &&
    typeof (value as Record<string, unknown>).modelId === 'string'
  );
}

/**
 * 从自定义供应商配置构建 channelContext。
 * 用于接受 customProvider 参数的 handler。
 */
export function buildChannelContextFromPayload(
  payload: unknown,
  resolvedModelId?: string,
): ChannelContext {
  if (!isProviderPayload(payload)) {
    return { providerId: 'system', modelId: 'default' };
  }
  return {
    providerId: payload.providerId,
    modelId: resolvedModelId ?? payload.modelId,
  };
}

/**
 * 从 magic-tea-party 风格的 buildProviderOverride 结果构建 channelContext。
 */
export function buildChannelContextFromResolved(
  providerId: string,
  modelId: string,
): ChannelContext {
  return { providerId, modelId };
}

/**
 * 系统专用 handler 的 channelContext（无 customProvider 支持）。
 */
export function buildSystemChannelContext(modelId = 'default'): ChannelContext {
  return { providerId: 'system', modelId };
}
