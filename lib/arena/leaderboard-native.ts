import { verifySignature } from '@/lib/signature';

type LeaderboardEntityType = 'data_card' | 'preset';

export type LeaderboardNativeItem = {
  entityType: LeaderboardEntityType;
  entityId: string;
  isNative: boolean | null;
};

type D1QueryFn = (sql: string, params: unknown[]) => Promise<unknown>;

type ExecutionContextLike = {
  waitUntil?: (promise: Promise<unknown>) => void;
} | null;

const readRows = <T,>(result: unknown): T[] => {
  const rows = (result as any)?.result?.[0]?.results;
  return Array.isArray(rows) ? (rows as T[]) : [];
};

const updateIsNativeBatch = async (queryFromD1: D1QueryFn, diffs: Array<{ id: string; isNative: boolean }>) => {
  if (diffs.length === 0) return;

  const nowIso = new Date().toISOString();
  const caseParts = diffs.map(() => 'WHEN ? THEN ?').join(' ');
  const wherePlaceholders = diffs.map(() => '?').join(', ');

  const params: unknown[] = [];
  for (const diff of diffs) {
    params.push(diff.id, diff.isNative ? 1 : 0);
  }
  params.push(nowIso);
  for (const diff of diffs) {
    params.push(diff.id);
  }

  await queryFromD1(
    `UPDATE data_card_metrics
     SET is_native = CASE data_card_id ${caseParts} ELSE is_native END,
         updated_at = ?
     WHERE data_card_id IN (${wherePlaceholders})`,
    params,
  );
};

export async function attachVerifiedNativeFlags(
  queryFromD1: D1QueryFn,
  items: LeaderboardNativeItem[],
  executionContext: ExecutionContextLike,
): Promise<LeaderboardNativeItem[]> {
  if (!process.env.SIGNATURE_SECRET_KEY) return items;

  const idsToVerify = items
    .filter((item) => item.entityType === 'data_card' && item.isNative !== true)
    .map((item) => item.entityId);

  if (idsToVerify.length === 0) return items;

  const placeholders = idsToVerify.map(() => '?').join(', ');

  let dataRows: Array<{ id: string; data: string }> = [];
  try {
    const result = await queryFromD1(
      `SELECT id, data
       FROM data_cards
       WHERE id IN (${placeholders})
         AND deleted_at IS NULL`,
      idsToVerify,
    );
    dataRows = readRows<{ id: string; data: string }>(result).filter(
      (row) => typeof row?.id === 'string' && typeof row?.data === 'string',
    );
  } catch (error) {
    console.warn('读取排行榜角色数据失败（降级为使用缓存原生性）:', error);
    return items;
  }

  const dataById = new Map<string, string>();
  for (const row of dataRows) {
    dataById.set(row.id, row.data);
  }

  const verifiedById = new Map<string, boolean>();
  await Promise.all(
    idsToVerify.map(async (id) => {
      const raw = dataById.get(id);
      if (!raw) return;
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        parsed = null;
      }
      if (!parsed || typeof parsed !== 'object') return;

      const hasSignature = typeof (parsed as any).signature === 'string';
      if (!hasSignature) {
        verifiedById.set(id, false);
        return;
      }

      try {
        const ok = await verifySignature(parsed as any);
        verifiedById.set(id, ok);
      } catch {
        verifiedById.set(id, false);
      }
    }),
  );

  const diffs: Array<{ id: string; isNative: boolean }> = [];
  const nextItems = items.map((item) => {
    if (item.entityType !== 'data_card') return item;
    const verified = verifiedById.get(item.entityId);
    if (verified == null) return item;

    if (item.isNative !== verified) {
      diffs.push({ id: item.entityId, isNative: verified });
    }

    return { ...item, isNative: verified };
  });

  if (diffs.length > 0) {
    const writePromise = updateIsNativeBatch(queryFromD1, diffs).catch((error) => {
      console.warn('回写 data_card_metrics.is_native 失败（忽略）:', error);
    });

    if (executionContext?.waitUntil) {
      executionContext.waitUntil(writePromise);
    } else {
      await writePromise;
    }
  }

  return nextItems;
}

