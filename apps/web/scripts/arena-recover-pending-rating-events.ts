import { queryD1Payload } from '@/lib/database/core';

type Queue = 'strict' | 'free';
type Mode = 'skip' | 'failed';

type PendingEventRow = {
  id: string;
  generation_id: string;
  queue: Queue;
  created_at: string;
};

type CliOptions = {
  mode: Mode;
  queue: 'all' | Queue;
  olderThanMinutes: number;
  limit: number;
  apply: boolean;
  reason: string;
};

const parseRows = <T>(payload: unknown): T[] => {
  const root = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
  const result = root && Array.isArray(root.result) ? root.result[0] : null;
  const rows = result && typeof result === 'object' && Array.isArray((result as Record<string, unknown>).results)
    ? ((result as Record<string, unknown>).results as T[])
    : [];
  return rows;
};

const parseNumber = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
};

const parseArgs = (argv: string[]): CliOptions => {
  const map = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token?.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      map.set(key, 'true');
      continue;
    }
    map.set(key, next);
    i += 1;
  }

  const modeRaw = (map.get('mode') ?? 'skip').trim().toLowerCase();
  const mode: Mode = modeRaw === 'failed' ? 'failed' : 'skip';

  const queueRaw = (map.get('queue') ?? 'all').trim().toLowerCase();
  const queue: 'all' | Queue = queueRaw === 'strict' || queueRaw === 'free' ? queueRaw : 'all';

  const apply = (map.get('apply') ?? 'false').trim().toLowerCase() === 'true';
  const olderThanMinutes = parseNumber(map.get('older-than-minutes'), 30);
  const limit = parseNumber(map.get('limit'), 500);
  const reason = (map.get('reason') ?? 'recovery-pending-legacy').trim() || 'recovery-pending-legacy';

  return { mode, queue, olderThanMinutes, limit, apply, reason };
};

const chunk = <T>(list: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

const buildQueueClause = (queue: 'all' | Queue): { sql: string; params: unknown[] } => {
  if (queue === 'all') return { sql: '', params: [] };
  return { sql: 'AND queue = ?', params: [queue] };
};

const fetchPendingCandidates = async (options: CliOptions): Promise<PendingEventRow[]> => {
  const queueClause = buildQueueClause(options.queue);
  const sql = `
SELECT id, generation_id, queue, created_at
FROM arena_rating_events
WHERE status = 'pending'
  ${queueClause.sql}
  AND julianday(replace(replace(created_at, 'T', ' '), 'Z', '')) <= julianday('now', ?)
ORDER BY created_at ASC
LIMIT ?;
`;
  const params: unknown[] = [...queueClause.params, `-${options.olderThanMinutes} minutes`, options.limit];
  const payload = await queryD1Payload(sql, params);
  return parseRows<PendingEventRow>(payload);
};

const fetchPendingSummary = async (): Promise<Array<{ queue: string; total: number }>> => {
  const payload = await queryD1Payload(
    `SELECT queue, COUNT(*) as total
     FROM arena_rating_events
     WHERE status = 'pending'
     GROUP BY queue
     ORDER BY queue ASC`,
    [],
  );
  return parseRows<Array<{ queue: string; total: number }>[number]>(payload).map((row) => ({
    queue: row.queue,
    total: Number(row.total) || 0,
  }));
};

const applyStatusUpdate = async (ids: string[], mode: Mode, reason: string): Promise<number> => {
  if (ids.length === 0) return 0;
  const status = mode === 'failed' ? 'failed' : 'skipped';
  let totalChanged = 0;

  for (const batch of chunk(ids, 60)) {
    const placeholders = batch.map(() => '?').join(', ');
    const sql = `
UPDATE arena_rating_events
SET
  status = ?,
  skip_reason = COALESCE(skip_reason, ?)
WHERE status = 'pending'
  AND id IN (${placeholders});
`;
    const payload = await queryD1Payload(sql, [status, reason, ...batch]);
    const resultRows = parseRows<Record<string, unknown>>(payload);
    const meta = (payload && typeof payload === 'object' ? (payload as any)?.result?.[0]?.meta : null) as Record<string, unknown> | null;
    const changed = Number(meta?.changes ?? 0);
    totalChanged += Number.isFinite(changed) ? changed : resultRows.length;
  }

  return totalChanged;
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  console.log('[arena-recover] options:', JSON.stringify(options));

  const before = await fetchPendingSummary();
  console.log('[arena-recover] pending summary before:', JSON.stringify(before));

  const candidates = await fetchPendingCandidates(options);
  console.log(`[arena-recover] candidates: ${candidates.length}`);
  if (candidates.length > 0) {
    const sample = candidates.slice(0, 20);
    console.log('[arena-recover] sample:', JSON.stringify(sample));
  }

  if (!options.apply) {
    console.log('[arena-recover] dry-run only. add --apply true to execute.');
    return;
  }

  const changed = await applyStatusUpdate(
    candidates
      .map((row) => (typeof row.id === 'string' ? row.id.trim() : ''))
      .filter((id) => Boolean(id)),
    options.mode,
    options.reason,
  );
  console.log(`[arena-recover] changed rows: ${changed}`);

  const after = await fetchPendingSummary();
  console.log('[arena-recover] pending summary after:', JSON.stringify(after));
};

main().catch((error) => {
  console.error('[arena-recover] failed:', error);
  process.exit(1);
});
