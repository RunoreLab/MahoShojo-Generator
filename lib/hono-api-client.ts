import { authStorage } from '@/lib/auth';
import { resolveGenerationApiUrl } from '@/lib/hono-api-routing';

export { isHonoApiEnabled, isHonoApiPath, resolveGenerationApiUrl } from '@/lib/hono-api-routing';

export const generationApiFetch = async (
  input: string,
  init: RequestInit = {},
): Promise<Response> => {
  const target = resolveGenerationApiUrl(input);
  const headers = new Headers(init.headers ?? {});

  const authHeader = await authStorage.getAuthHeader();
  if (authHeader && !headers.has('Authorization')) {
    headers.set('Authorization', authHeader);
  }

  const activityHeaders = await authStorage.getActivityHeaders();
  for (const [name, value] of Object.entries(activityHeaders)) {
    if (!headers.has(name)) headers.set(name, value);
  }

  return fetch(target, {
    ...init,
    headers,
    credentials: target === input ? (init.credentials ?? 'same-origin') : 'omit',
  });
};
