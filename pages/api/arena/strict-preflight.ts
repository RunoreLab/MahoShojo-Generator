import type { NextRequest } from 'next/server';

import { getUserByAuthKey } from '@/lib/d1';
import { validateRankedMatchTicketForRequest } from '@/lib/arena/ranked-match';
import { isStrictRankedModelBlacklisted } from '@/lib/arena/ranked-model-policy';
import { getStrictDailyUsage, STRICT_DAILY_LIMIT } from '@/lib/database/arena-ratings';

export const config = {
  runtime: 'edge',
};

type ApiSuccessResponse = {
  success: true;
  willCount: boolean;
  reasons: string[];
  rankedMatch: {
    ok: boolean;
    reason: string | null;
    matchId: string | null;
    expiresAt: string | null;
  };
  daily: {
    used: number | null;
    limit: number;
    exceeded: boolean | null;
    sinceIso: string | null;
  };
};

type ApiErrorResponse = { success: false; error: string };

const readString = (value: unknown): string => (typeof value === 'string' ? value : '');
const trimString = (value: unknown): string => readString(value).trim();
const readBoolean = (value: unknown): boolean => value === true || value === 'true' || value === 1 || value === '1';
const readNonNegativeInt = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
};

export default async function handler(req: NextRequest) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method Not Allowed' } satisfies ApiErrorResponse), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await req.json()) as any;

    const battleMode = trimString(body?.battleMode ?? body?.mode);
    const selectedLevel = readString(body?.selectedLevel);
    const language = trimString(body?.language);
    const storyLength = readString(body?.storyLength);

    const settings = body?.settings && typeof body.settings === 'object' ? body.settings : {};
    const userGuidance = readString(settings?.userGuidance);
    const readArenaHistory = readBoolean(settings?.readArenaHistory);
    const readCurrentState = readBoolean(settings?.readCurrentState);
    const readNarrativeHistory = readBoolean(settings?.readNarrativeHistory);

    const combatants = Array.isArray(body?.combatants) ? body.combatants : null;
    const adjudicationEventCount = readNonNegativeInt(body?.adjudicationEventCount);

    const customProvider = body?.customProvider && typeof body.customProvider === 'object' ? body.customProvider : null;
    const customModelId = trimString(customProvider?.modelId);

    const authHeader = req.headers.get('authorization');
    const authKey = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;
    const user = authKey ? await getUserByAuthKey(authKey) : null;

    const rankedMatchValidation = await validateRankedMatchTicketForRequest({
      ticket: body?.rankedMatch ?? null,
      userId: user?.id ?? null,
      combatants,
      mode: battleMode,
      selectedLevel,
      language,
      storyLength,
      nowMs: Date.now(),
    });

    const reasons: string[] = [];
    if (!user?.id) reasons.push('need-login');
    if (battleMode !== 'classic') reasons.push('mode-not-classic');
    if (!Array.isArray(combatants) || combatants.length !== 2) reasons.push('combatant-count-not-2');
    if (trimString(language) !== 'zh-CN') reasons.push('language-not-zh-cn');
    if (trimString(selectedLevel)) reasons.push('level-not-default');
    if (trimString(userGuidance)) reasons.push('has-user-guidance');
    if (readArenaHistory) reasons.push('read-arena-history');
    if (readCurrentState) reasons.push('read-current-state');
    if (readNarrativeHistory) reasons.push('read-narrative-history');
    if (adjudicationEventCount > 0) reasons.push('has-adjudication-events');
    if (customModelId && isStrictRankedModelBlacklisted(customModelId)) reasons.push('ai-model-blacklisted');
    if (
      Array.isArray(combatants) &&
      combatants.some((c) => typeof c?.characterGuidance === 'string' && c.characterGuidance.trim())
    ) {
      reasons.push('has-character-guidance');
    }

    if (!rankedMatchValidation.ok) {
      const map: Record<string, string> = {
        missing: 'ranked-match-missing',
        'invalid-shape': 'ranked-match-invalid',
        'invalid-signature': 'ranked-match-invalid',
        'need-login': 'need-login',
        'user-mismatch': 'ranked-match-user-mismatch',
        expired: 'ranked-match-expired',
        'settings-changed': 'ranked-match-settings-changed',
        'combatants-not-2': 'combatant-count-not-2',
        'combatants-unrankable': 'ranked-match-unrankable',
        'roster-changed': 'ranked-match-roster-changed',
      };
      const raw = rankedMatchValidation.reason ?? '';
      const mapped = raw ? (map[raw] ?? `ranked-match:${raw}`) : 'need-ranked-match';
      reasons.push(mapped);
    }

    const dailyUsage = typeof user?.id === 'number' ? await getStrictDailyUsage(user.id) : null;
    const shouldConsiderDailyLimit = reasons.length === 0;
    if (shouldConsiderDailyLimit && (dailyUsage?.exceeded ?? false)) {
      reasons.push('daily-limit');
    }

    const response: ApiSuccessResponse = {
      success: true,
      willCount: reasons.length === 0,
      reasons,
      rankedMatch: {
        ok: rankedMatchValidation.ok,
        reason: rankedMatchValidation.ok ? null : rankedMatchValidation.reason,
        matchId: rankedMatchValidation.matchId,
        expiresAt: rankedMatchValidation.expiresAt,
      },
      daily: {
        used: dailyUsage?.used ?? null,
        limit: STRICT_DAILY_LIMIT,
        exceeded: dailyUsage?.exceeded ?? null,
        sinceIso: dailyUsage?.sinceIso ?? null,
      },
    };

    return new Response(JSON.stringify(response), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('strict-preflight 失败:', error);
    return new Response(JSON.stringify({ success: false, error: '无法检查严格排位计分状态' } satisfies ApiErrorResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

