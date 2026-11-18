export type ArenaSeasonContext = {
  authorityAvailable: boolean;
  seasonId: string | null;
  mode: 'classic' | 'kizuna' | 'daily' | 'scenario';
  storyGuidance: string;
  scenarioPresetFilename: string | null;
  questionnaireLoreAllowed: boolean;
  questionnaireLorePresetIds: string[];
};

type SeasonRecord = {
  id?: unknown;
  status?: unknown;
  specialRules?: unknown;
};

const defaultContext = (authorityAvailable: boolean): ArenaSeasonContext => ({
  authorityAvailable,
  seasonId: null,
  mode: 'classic',
  storyGuidance: '',
  scenarioPresetFilename: null,
  questionnaireLoreAllowed: false,
  questionnaireLorePresetIds: [],
});

const safeMode = (value: unknown): ArenaSeasonContext['mode'] => (
  value === 'kizuna' || value === 'daily' || value === 'scenario' ? value : 'classic'
);

export const createArenaSeasonContextReader = (options: {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
  accessClientId?: string;
  accessClientSecret?: string;
  cacheTtlMs?: number;
  timeoutMs?: number;
  failureCacheTtlMs?: number;
  staleIfErrorTtlMs?: number;
}) => {
  const base = new URL(options.baseUrl);
  if (
    (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))
    || base.username
    || base.password
  ) throw new Error('ARENA_SEASON_CONTEXT_URL_INVALID');
  const fetcher = options.fetch ?? globalThis.fetch;
  const cacheTtlMs = options.cacheTtlMs ?? 60_000;
  const timeoutMs = options.timeoutMs ?? 3_000;
  const failureCacheTtlMs = options.failureCacheTtlMs ?? 5_000;
  const staleIfErrorTtlMs = options.staleIfErrorTtlMs ?? 30 * 60_000;
  let cached: { expiresAt: number; value: ArenaSeasonContext } | null = null;
  let lastValid: { staleUntil: number; value: ArenaSeasonContext } | null = null;

  return async (): Promise<ArenaSeasonContext> => {
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.value;
    const headers = new Headers({ Accept: 'application/json' });
    if (options.accessClientId?.trim() && options.accessClientSecret?.trim()) {
      headers.set('CF-Access-Client-Id', options.accessClientId.trim());
      headers.set('CF-Access-Client-Secret', options.accessClientSecret.trim());
    }
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => {
      timeoutController.abort('season-context-timeout');
    }, timeoutMs);
    (timeoutId as { unref?: () => void }).unref?.();
    let value: ArenaSeasonContext;
    let ttlMs = cacheTtlMs;
    try {
      const response = await fetcher(new URL('/config/seasons.json', base), {
        headers,
        signal: timeoutController.signal,
      });
      if (!response.ok) throw new Error(`ARENA_SEASON_CONTEXT_HTTP_${response.status}`);
      const payload = await response.json() as { schemaVersion?: unknown; seasons?: unknown };
      if (payload.schemaVersion !== 1 || !Array.isArray(payload.seasons)) {
        throw new Error('ARENA_SEASON_CONTEXT_INVALID');
      }
      const current = payload.seasons.find((item): item is SeasonRecord => (
        Boolean(item) && typeof item === 'object' && !Array.isArray(item)
        && (item as SeasonRecord).status === 'current'
      ));
      if (!current) value = defaultContext(true);
      else {
        const rules = current.specialRules && typeof current.specialRules === 'object'
          && !Array.isArray(current.specialRules)
          ? current.specialRules as Record<string, unknown>
          : {};
        const mode = safeMode(rules.mode);
        const questionnaireIds = Array.isArray(rules.questionnaireLorePresetIds)
          ? rules.questionnaireLorePresetIds.flatMap((item) => (
            typeof item === 'string' && item.trim() ? [item.trim()] : []
          )).slice(0, 10)
          : [];
        const scenarioPreset = mode === 'scenario' && typeof rules.scenarioPresetFilename === 'string'
          ? rules.scenarioPresetFilename.trim().slice(0, 128) || null
          : null;
        value = {
          authorityAvailable: true,
          seasonId: typeof current.id === 'string' ? current.id.trim().slice(0, 32) || null : null,
          mode,
          storyGuidance: typeof rules.storyGuidance === 'string'
            ? rules.storyGuidance.trim().slice(0, 200)
            : '',
          scenarioPresetFilename: scenarioPreset,
          questionnaireLoreAllowed: questionnaireIds.length > 0 || rules.questionnaireLoreAllowed === true,
          questionnaireLorePresetIds: questionnaireIds,
        };
      }
      lastValid = { staleUntil: Date.now() + staleIfErrorTtlMs, value };
    } catch {
      const errorAt = Date.now();
      // 已预热过赛季权威时优先走 stale-if-error，并用极短负缓存 TTL 避免 60 秒全量雪崩。
      value = lastValid && lastValid.staleUntil > errorAt
        ? lastValid.value
        : defaultContext(false);
      ttlMs = failureCacheTtlMs;
    } finally {
      clearTimeout(timeoutId);
    }
    cached = { expiresAt: Date.now() + ttlMs, value };
    return value;
  };
};
