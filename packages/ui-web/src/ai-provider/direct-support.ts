// Direct 支持度 → UI 文案。
//
// `describeAiPreset*DirectSupport` 返回结构化 reason（ai-core 的 D5.0a 分层结果）；
// 这里只做 reason → 展示文案的映射，不重复推导能力。

import type { AiPresetDirectUnsupportedReason } from '@mahoshojo/ai-core/provider-catalog';

/** Desktop Direct 不可用的展示文案；保持「可见但说明原因」而不是静默隐藏。 */
export const AI_DIRECT_UNSUPPORTED_REASON_TEXT: Record<AiPresetDirectUnsupportedReason, string> = {
  'server-policy': '服务器策略项，不提供客户端直连',
  'project-forward-endpoint': '项目转发端点，仅支持服务器路径',
  'unsupported-model': '该模型在此端点下未经客户端直连核验',
  'unsupported-protocol': '当前客户端尚未实现该适配协议',
  unverified: '该端点尚未完成客户端直连核验',
};

export const describeAiDirectUnsupportedReason = (
  reason: AiPresetDirectUnsupportedReason,
): string => AI_DIRECT_UNSUPPORTED_REASON_TEXT[reason];
