import { CustomProviderRequestSchema } from '@mahoshojo/hosted-api/regular-generation';

import {
  resolveCustomProviderRuntime,
  type CustomProviderRuntimeDependencies,
} from './custom-provider-runtime';

export { formatQuestionnaireAnswers, compactQuestionnaireAnswerItems } from '@mahoshojo/domain/questionnaire';

export type LegacyProviderRuntimeLogger = {
  logInfo(_message: string, _meta: Record<string, unknown>): void;
  logWarn(_message: string, _meta: Record<string, unknown>): void;
};

export const resolveLegacyQuestionnaireProviderRuntime = (
  payload: unknown,
  ports: CustomProviderRuntimeDependencies & LegacyProviderRuntimeLogger,
) => {
  if (!payload) {
    return resolveCustomProviderRuntime(undefined, ports, {
      nonSystemLoadBalanceStrategy: 'custom',
      exposeEmptyBaseUrlModelOverride: true,
    });
  }

  const parsed = CustomProviderRequestSchema.safeParse(payload);
  if (!parsed.success) {
    const providerId = payload && typeof payload === 'object' && 'providerId' in payload
      ? payload.providerId
      : undefined;
    ports.logWarn('自定义 AI 供应商配置校验失败', {
      providerId,
      issues: parsed.error.issues,
    });
    return {
      response: new Response(
        JSON.stringify({ error: '自定义 AI 供应商配置无效' }),
        { status: 400 },
      ),
    } as const;
  }

  return resolveCustomProviderRuntime(parsed.data, ports, {
    nonSystemLoadBalanceStrategy: 'custom',
    exposeEmptyBaseUrlModelOverride: true,
    onEmptyBaseUrl: (meta) => {
      ports.logInfo(
        '检测到 baseUrl 为空的自定义供应商，改用系统默认通道，仅覆盖模型参数',
        meta,
      );
    },
  });
};
