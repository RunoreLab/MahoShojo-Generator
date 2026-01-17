import type { MagicTeaPartySession } from '@/lib/magic-tea-party/types';
import { deleteMagicTeaPartySession, listMagicTeaPartySessions } from '@/lib/magic-tea-party/storage';

const DAY_MS = 24 * 60 * 60 * 1000;

export type MagicTeaPartyCleanupPlan = {
  sessions: MagicTeaPartySession[];
  expired: MagicTeaPartySession[];
  overLimit: MagicTeaPartySession[];
  candidates: MagicTeaPartySession[];
};

const uniqById = (items: MagicTeaPartySession[]): MagicTeaPartySession[] => {
  const seen = new Set<string>();
  const result: MagicTeaPartySession[] = [];
  for (const item of items) {
    const id = item?.id ? String(item.id) : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(item);
  }
  return result;
};

export const buildMagicTeaPartyCleanupPlan = async (options: {
  retentionDays: number;
  maxSessions: number;
  excludeSessionId?: string | null;
  now?: number;
}): Promise<MagicTeaPartyCleanupPlan> => {
  const retentionDays = Math.max(1, Math.floor(options.retentionDays));
  const maxSessions = Math.max(1, Math.floor(options.maxSessions));
  const now = typeof options.now === 'number' ? options.now : Date.now();
  const excludeId = options.excludeSessionId ?? null;

  const sessions = await listMagicTeaPartySessions({ limit: 9999 });
  const sorted = [...sessions].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

  const expired = sorted.filter((session) => {
    if (excludeId && session.id === excludeId) return false;
    const updatedAt = session.updatedAt ?? session.createdAt ?? 0;
    return updatedAt > 0 && now - updatedAt > retentionDays * DAY_MS;
  });

  const keepIds = new Set<string>();
  if (excludeId) keepIds.add(excludeId);
  sorted.forEach((session) => {
    if (keepIds.size >= maxSessions && !(excludeId && session.id === excludeId)) return;
    keepIds.add(session.id);
  });

  const overLimit = sorted.filter((session) => {
    if (excludeId && session.id === excludeId) return false;
    return !keepIds.has(session.id);
  });

  const candidates = uniqById([...expired, ...overLimit]);

  return {
    sessions: sorted,
    expired,
    overLimit,
    candidates,
  };
};

export const cleanupMagicTeaPartySessions = async (options: {
  retentionDays: number;
  maxSessions: number;
  excludeSessionId?: string | null;
}): Promise<{ deletedIds: string[] }> => {
  const plan = await buildMagicTeaPartyCleanupPlan(options);
  const deletedIds: string[] = [];
  for (const session of plan.candidates) {
    if (!session?.id) continue;
    await deleteMagicTeaPartySession(session.id);
    deletedIds.push(session.id);
  }
  return { deletedIds };
};
