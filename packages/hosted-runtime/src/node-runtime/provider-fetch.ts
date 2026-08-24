import type { AIProvider } from './types';

const getProviderFetch = (provider: AIProvider, fetchImpl: typeof fetch = globalThis.fetch): typeof fetch => {
  if (provider.name.toLowerCase() !== "kourichat") {
    return (input, init) => fetchImpl(input, init);
  }

  return async (input, init) => {
    const headers = new Headers(init?.headers ?? undefined);
    headers.set("X-Forwarded-For", "233.233.233.233");

    // 仅在命中 KouriChat 时透传静态 IP，避免影响其他提供商
    return fetchImpl(input, { ...init, headers });
  };
};

export { getProviderFetch };
