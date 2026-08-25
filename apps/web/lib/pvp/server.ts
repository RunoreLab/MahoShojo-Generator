import { getAuthUser as getUnifiedAuthUser, requireAuthUser as requireUnifiedAuthUser } from '@/lib/auth/server';
export type { AuthenticatedUser } from '@/lib/auth/server';

export const json = (payload: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(payload), {
    status: init?.status ?? 200,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

const newTraceId = (): string => {
  try {
    // Cloudflare / Edge Runtime 通常支持 crypto.randomUUID()
    if (typeof crypto !== 'undefined' && typeof (crypto as any).randomUUID === 'function') {
      return (crypto as any).randomUUID();
    }
  } catch {
    // ignore
  }
  return `pvp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};

export type PvpApiHandler<TArgs extends unknown[] = []> = (req: Request, ...args: TArgs) => Promise<Response>;

/**
 * 兜底错误边界：避免 Edge Runtime 直接抛出 500（无 JSON），同时返回 traceId 便于定位。
 */
export const withPvpErrorBoundary =
  <TArgs extends unknown[]>(handler: PvpApiHandler<TArgs>): PvpApiHandler<TArgs> =>
  async (req: Request, ...args: TArgs): Promise<Response> => {
    const traceId = newTraceId();
    try {
      return await handler(req, ...args);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[pvp][${traceId}] 未捕获异常:`, error);
      return json(
        {
          error: '服务器内部错误',
          code: 'INTERNAL_ERROR',
          traceId,
          detail: detail ? String(detail).slice(0, 500) : undefined,
        },
        { status: 500 }
      );
    }
  };

export const getAuthUser = getUnifiedAuthUser;
export const requireAuthUser = requireUnifiedAuthUser;

export const readJson = async <T = any>(req: Request): Promise<{ data: T } | { response: Response }> => {
  try {
    const data = (await req.json()) as T;
    return { data };
  } catch {
    return { response: json({ error: '请求体不是有效 JSON' }, { status: 400 }) };
  }
};
