import { getUserByAuthKey } from '@/lib/d1';

export interface AuthenticatedUser {
  id: number;
  username: string;
  prefix?: string | null;
  is_banned?: string | null;
}

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

export type PvpApiHandler = (req: Request) => Promise<Response>;

/**
 * 兜底错误边界：避免 Edge Runtime 直接抛出 500（无 JSON），同时返回 traceId 便于定位。
 */
export const withPvpErrorBoundary =
  (handler: PvpApiHandler): PvpApiHandler =>
  async (req: Request): Promise<Response> => {
    const traceId = newTraceId();
    try {
      return await handler(req);
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

export const getAuthUser = async (req: Request): Promise<AuthenticatedUser | null> => {
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const authKey = authHeader.substring(7).trim();
  if (!authKey) return null;
  return (await getUserByAuthKey(authKey)) as AuthenticatedUser | null;
};

export const requireAuthUser = async (req: Request): Promise<{ user: AuthenticatedUser } | { response: Response }> => {
  const user = await getAuthUser(req);
  if (!user) return { response: json({ error: '未授权' }, { status: 401 }) };
  if (user.is_banned && String(user.is_banned).trim()) {
    return { response: json({ error: '账号已被封禁' }, { status: 403 }) };
  }
  return { user };
};

export const readJson = async <T = any>(req: Request): Promise<{ data: T } | { response: Response }> => {
  try {
    const data = (await req.json()) as T;
    return { data };
  } catch {
    return { response: json({ error: '请求体不是有效 JSON' }, { status: 400 }) };
  }
};

