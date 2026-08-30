import type { AIProvider } from './types';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const getProviderFetch = (
  provider: AIProvider,
  fetchImpl: typeof fetch = globalThis.fetch,
  onDispatch: () => void = () => undefined,
): typeof fetch => async (input, init) => {
  const usesKouriForwardedIp = provider.name.toLowerCase() === 'kourichat';
  const headers = usesKouriForwardedIp
    ? new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    : null;
  if (headers) {
    // 仅在命中 KouriChat 时透传静态 IP，避免影响其他提供商。
    headers.set('X-Forwarded-For', '233.233.233.233');
  }

  onDispatch();
  const response = await fetchImpl(input, {
    ...init,
    ...(headers ? { headers } : {}),
    // 生成请求非幂等；redirect 必须由本边界显式判定，禁止原生 fetch 自动重放。
    redirect: 'manual',
  });
  if (REDIRECT_STATUSES.has(response.status)) {
    try {
      void response.body?.cancel('redirect-blocked').catch(() => undefined);
    } catch {
      // 关闭失败不改变 fail-closed 结论。
    }
    const error = new Error('AI_PROVIDER_REDIRECT_BLOCKED');
    error.name = 'AIProviderRedirectError';
    throw error;
  }
  return response;
};

export { getProviderFetch };
