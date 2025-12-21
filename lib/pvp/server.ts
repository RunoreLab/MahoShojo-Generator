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

