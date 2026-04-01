import { json } from '@/lib/internal-api/response';

export type InternalApiPrincipal = {
  name: string;
  scopes: string[];
};

type InternalApiTokenDefinition = {
  name: string;
  token: string;
  scopes: string[];
};

type InternalTokenConfig =
  | {
      enabled: false;
      tokens: [];
      error: null;
    }
  | {
      enabled: true;
      tokens: InternalApiTokenDefinition[];
      error: string | null;
    };

type InternalTokenDeps = {
  getEnv: (key: string) => string | undefined;
};

export type RequireInternalTokenOptions = {
  scopes?: string[];
};

export type RequireInternalTokenResult = { principal: InternalApiPrincipal } | { response: Response };

export type InternalTokenApi = {
  getTokenPrincipal: (req: Request) => Promise<InternalApiPrincipal | null>;
  requireInternalToken: (req: Request, options?: RequireInternalTokenOptions) => Promise<RequireInternalTokenResult>;
};

const defaultInternalTokenDeps: InternalTokenDeps = {
  getEnv: (key) => process.env[key],
};

const toNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeScopes = (value: unknown): string[] => {
  if (!Array.isArray(value)) return ['*'];

  const scopes = value
    .map((item) => toNonEmptyString(item))
    .filter((item): item is string => Boolean(item));

  return scopes.length > 0 ? scopes : ['*'];
};

const parseJsonTokenConfig = (raw: string): InternalApiTokenDefinition[] | null => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;

    const tokens = parsed
      .map((item, index) => {
        if (!item || typeof item !== 'object') return null;
        const record = item as Record<string, unknown>;
        const token = toNonEmptyString(record.token);
        if (!token) return null;

        return {
          name: toNonEmptyString(record.name) ?? `token_${index + 1}`,
          token,
          scopes: normalizeScopes(record.scopes),
        } satisfies InternalApiTokenDefinition;
      })
      .filter((item): item is InternalApiTokenDefinition => Boolean(item));

    return tokens.length > 0 ? tokens : null;
  } catch {
    return null;
  }
};

const readInternalTokenConfig = (deps: InternalTokenDeps): InternalTokenConfig => {
  const enabled = deps.getEnv('INTERNAL_API_ENABLED') === 'true';
  if (!enabled) {
    return { enabled: false, tokens: [], error: null };
  }

  const multiTokenRaw = toNonEmptyString(deps.getEnv('INTERNAL_API_TOKENS'));
  if (multiTokenRaw) {
    const tokens = parseJsonTokenConfig(multiTokenRaw);
    if (!tokens) {
      return {
        enabled: true,
        tokens: [],
        error: 'INTERNAL_API_TOKENS 不是有效配置',
      };
    }
    return { enabled: true, tokens, error: null };
  }

  const singleToken = toNonEmptyString(deps.getEnv('INTERNAL_API_TOKEN'));
  if (singleToken) {
    return {
      enabled: true,
      tokens: [
        {
          name: 'default',
          token: singleToken,
          scopes: ['*'],
        },
      ],
      error: null,
    };
  }

  return {
    enabled: true,
    tokens: [],
    error: '未配置 INTERNAL_API_TOKEN 或 INTERNAL_API_TOKENS',
  };
};

const getBearerToken = (req: Request): string | null => {
  const authorization = req.headers.get('authorization');
  if (!authorization || !authorization.startsWith('Bearer ')) return null;
  return toNonEmptyString(authorization.slice('Bearer '.length));
};

const constantTimeEquals = (left: string, right: string): boolean => {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);

  if (leftBytes.length !== rightBytes.length) return false;

  let diff = 0;
  for (let i = 0; i < leftBytes.length; i += 1) {
    diff |= leftBytes[i] ^ rightBytes[i];
  }

  return diff === 0;
};

const matchesScope = (grantedScope: string, requiredScope: string): boolean => {
  if (grantedScope === '*') return true;
  if (grantedScope === requiredScope) return true;
  if (grantedScope.endsWith('*')) {
    return requiredScope.startsWith(grantedScope.slice(0, -1));
  }
  return false;
};

const hasRequiredScopes = (principal: InternalApiPrincipal, requiredScopes: string[]): boolean => {
  if (requiredScopes.length === 0) return true;
  return requiredScopes.every((requiredScope) =>
    principal.scopes.some((grantedScope) => matchesScope(grantedScope, requiredScope)),
  );
};

const findPrincipalByToken = (config: InternalTokenConfig, bearerToken: string): InternalApiPrincipal | null => {
  if (!config.enabled || config.error) return null;

  const token = config.tokens.find((item) => constantTimeEquals(item.token, bearerToken));
  if (!token) return null;

  return {
    name: token.name,
    scopes: token.scopes,
  };
};

const getTokenPrincipalWithDeps = async (req: Request, deps: InternalTokenDeps): Promise<InternalApiPrincipal | null> => {
  const bearerToken = getBearerToken(req);
  if (!bearerToken) return null;

  const config = readInternalTokenConfig(deps);
  return findPrincipalByToken(config, bearerToken);
};

const requireInternalTokenWithDeps = async (
  req: Request,
  options: RequireInternalTokenOptions,
  deps: InternalTokenDeps,
): Promise<RequireInternalTokenResult> => {
  const config = readInternalTokenConfig(deps);
  if (!config.enabled) {
    return { response: json({ error: '内部自动化接口未启用' }, { status: 503 }) };
  }

  if (config.error) {
    return { response: json({ error: '内部自动化接口配置无效' }, { status: 503 }) };
  }

  const bearerToken = getBearerToken(req);
  if (!bearerToken) {
    return { response: json({ error: '未授权' }, { status: 401 }) };
  }

  const principal = findPrincipalByToken(config, bearerToken);
  if (!principal) {
    return { response: json({ error: '未授权' }, { status: 401 }) };
  }

  const requiredScopes = options.scopes ?? [];
  if (!hasRequiredScopes(principal, requiredScopes)) {
    return { response: json({ error: '权限不足' }, { status: 403 }) };
  }

  return { principal };
};

export const createInternalTokenAuth = (overrides: Partial<InternalTokenDeps> = {}): InternalTokenApi => {
  const deps: InternalTokenDeps = {
    ...defaultInternalTokenDeps,
    ...overrides,
  };

  return {
    getTokenPrincipal: (req) => getTokenPrincipalWithDeps(req, deps),
    requireInternalToken: (req, options = {}) => requireInternalTokenWithDeps(req, options, deps),
  };
};

const defaultInternalTokenAuth = createInternalTokenAuth();

export const getTokenPrincipal = (req: Request): Promise<InternalApiPrincipal | null> =>
  defaultInternalTokenAuth.getTokenPrincipal(req);

export const requireInternalToken = (
  req: Request,
  options: RequireInternalTokenOptions = {},
): Promise<RequireInternalTokenResult> => defaultInternalTokenAuth.requireInternalToken(req, options);
