import type { AuthenticatedUser } from '@/lib/auth/server';
import { deriveSeasonStrictRules, type SeasonMeta, type SeasonStrictRules } from '@/lib/seasons';
import { fetchCurrentSeasonFromOrigin } from '@/lib/seasons-config';

type AuthUserResolver = {
  getUser: () => Promise<AuthenticatedUser | null>;
};

type BattleReportWriteContextInput = {
  requestUrl: string;
  authUserResolver: AuthUserResolver;
  fetchCurrentSeason?: (origin: string) => Promise<SeasonMeta | null>;
};

export type BattleReportWriteContext = {
  getAuthUser: () => Promise<AuthenticatedUser | null>;
  getCurrentSeason: () => Promise<SeasonMeta | null>;
  getSeasonStrictRules: () => Promise<SeasonStrictRules>;
};

const toNullOnError = async <T>(promise: Promise<T>): Promise<T | null> => {
  try {
    return await promise;
  } catch {
    return null;
  }
};

export const createBattleReportWriteContext = (
  input: BattleReportWriteContextInput,
): BattleReportWriteContext => {
  const origin = new URL(input.requestUrl).origin;
  const readCurrentSeason = input.fetchCurrentSeason ?? fetchCurrentSeasonFromOrigin;

  // 提前在请求存活期间解析这些依赖，避免成功写库阶段落到 waitUntil 后再失去请求上下文。
  const authUserPromise = toNullOnError(input.authUserResolver.getUser());
  const currentSeasonPromise = toNullOnError(readCurrentSeason(origin));
  const seasonStrictRulesPromise = currentSeasonPromise.then((season) => deriveSeasonStrictRules(season));

  return {
    getAuthUser: () => authUserPromise,
    getCurrentSeason: () => currentSeasonPromise,
    getSeasonStrictRules: () => seasonStrictRulesPromise,
  };
};
