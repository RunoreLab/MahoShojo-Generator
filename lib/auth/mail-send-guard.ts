import { anonymizeIp, getClientIpFromHeaders } from '@/lib/arena/battle-report-log-utils';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { countAuthAuditSuccessSince, getLatestAuthAuditSuccessEpoch } from '@/lib/db/repositories/auth-audit-logs';

export type MailSendGuardInput = {
  db: AppDrizzleDb;
  req: Request;
  eventType: string;
  businessUserId?: number | null;
  authUserId?: string | null;
  minIntervalSeconds?: number;
  maxPerUserWindow?: {
    windowSeconds: number;
    max: number;
  };
  maxPerIpWindow?: {
    windowSeconds: number;
    max: number;
  };
};

export type MailSendGuardResult = {
  allowed: boolean;
  reason: 'none' | 'user_interval' | 'user_window' | 'ip_window';
  retryAfterSeconds: number;
  ipAnonymized: string | null;
};

const asPositiveInteger = (value: unknown, fallback: number): number => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value);
  return fallback;
};

const clampRetryAfter = (value: number): number => {
  if (!Number.isFinite(value)) return 60;
  return Math.max(1, Math.min(600, Math.floor(value)));
};

const isQueryableDb = (db: unknown): db is AppDrizzleDb => {
  if (!db || typeof db !== 'object') return false;
  return typeof (db as { select?: unknown }).select === 'function';
};

export const guardMailSendByAudit = async (input: MailSendGuardInput): Promise<MailSendGuardResult> => {
  const nowEpochSeconds = Math.floor(Date.now() / 1000);
  const requestIp = getClientIpFromHeaders(input.req.headers);
  const ipAnonymized = anonymizeIp(requestIp);

  const minIntervalSeconds = asPositiveInteger(input.minIntervalSeconds, 0);
  const userWindowSeconds = asPositiveInteger(input.maxPerUserWindow?.windowSeconds, 0);
  const userWindowMax = asPositiveInteger(input.maxPerUserWindow?.max, 0);
  const ipWindowSeconds = asPositiveInteger(input.maxPerIpWindow?.windowSeconds, 0);
  const ipWindowMax = asPositiveInteger(input.maxPerIpWindow?.max, 0);

  if (!isQueryableDb(input.db)) {
    return {
      allowed: true,
      reason: 'none',
      retryAfterSeconds: 0,
      ipAnonymized,
    };
  }

  try {
    if (input.businessUserId && minIntervalSeconds > 0) {
      const latestByUser = await getLatestAuthAuditSuccessEpoch(input.db, {
        eventType: input.eventType,
        businessUserId: input.businessUserId,
        authUserId: input.authUserId,
      });

      if (typeof latestByUser === 'number' && nowEpochSeconds - latestByUser < minIntervalSeconds) {
        return {
          allowed: false,
          reason: 'user_interval',
          retryAfterSeconds: clampRetryAfter(minIntervalSeconds - (nowEpochSeconds - latestByUser)),
          ipAnonymized,
        };
      }
    }

    if (input.businessUserId && userWindowSeconds > 0 && userWindowMax > 0) {
      const countByUser = await countAuthAuditSuccessSince(input.db, {
        eventType: input.eventType,
        sinceEpochSeconds: nowEpochSeconds - userWindowSeconds,
        businessUserId: input.businessUserId,
        authUserId: input.authUserId,
      });

      if (countByUser >= userWindowMax) {
        return {
          allowed: false,
          reason: 'user_window',
          retryAfterSeconds: clampRetryAfter(Math.min(300, Math.max(30, Math.floor(userWindowSeconds / 2)))),
          ipAnonymized,
        };
      }
    }

    if (ipAnonymized && ipWindowSeconds > 0 && ipWindowMax > 0) {
      const countByIp = await countAuthAuditSuccessSince(input.db, {
        eventType: input.eventType,
        sinceEpochSeconds: nowEpochSeconds - ipWindowSeconds,
        ipAnonymized,
      });

      if (countByIp >= ipWindowMax) {
        return {
          allowed: false,
          reason: 'ip_window',
          retryAfterSeconds: clampRetryAfter(Math.min(300, Math.max(30, Math.floor(ipWindowSeconds / 2)))),
          ipAnonymized,
        };
      }
    }
  } catch (error) {
    // 风控不可用时降级放行，避免误伤正常流程。
    console.error('[mail-send-guard] 查询审计限流失败，已降级放行:', error);
  }

  return {
    allowed: true,
    reason: 'none',
    retryAfterSeconds: 0,
    ipAnonymized,
  };
};
