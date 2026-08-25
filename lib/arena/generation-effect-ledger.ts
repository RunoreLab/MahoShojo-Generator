export const ARENA_GENERATION_EFFECT_LEDGER_KEY = 'mahoshojo:arena:generation-effects:v1';

const MAX_LEDGER_ENTRIES = 32;

type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;

type LockPort = {
  request<T>(_name: string, _callback: () => Promise<T>): Promise<T>;
};

type LedgerEntry = { result: unknown; updatedAt: string };

type EffectLedger = {
  version: 1;
  entries: Record<string, LedgerEntry>;
};

const inFlight = new Map<string, Promise<unknown>>();

const readLedger = (storage: StoragePort | null): EffectLedger => {
  if (!storage) return { version: 1, entries: {} };
  try {
    const parsed = JSON.parse(
      storage.getItem(ARENA_GENERATION_EFFECT_LEDGER_KEY) ?? '',
    ) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { version: 1, entries: {} };
    }
    const record = parsed as { version?: unknown; entries?: unknown };
    if (record.version !== 1 || !record.entries || typeof record.entries !== 'object'
      || Array.isArray(record.entries)) return { version: 1, entries: {} };
    const entries = Object.fromEntries(Object.entries(record.entries).flatMap(([key, value]) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const entry = value as Partial<LedgerEntry>;
      if (typeof entry.updatedAt !== 'string' || !('result' in entry)) return [];
      return [[key, { result: entry.result, updatedAt: entry.updatedAt }]];
    }));
    return { version: 1, entries };
  } catch {
    return { version: 1, entries: {} };
  }
};

const writeEntry = (
  storage: StoragePort | null,
  generationId: string,
  result: unknown,
  now: () => Date,
): void => {
  if (!storage) return;
  const ledger = readLedger(storage);
  ledger.entries[generationId] = { result, updatedAt: now().toISOString() };
  const retained = Object.entries(ledger.entries)
    .sort(([, left], [, right]) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, MAX_LEDGER_ENTRIES);
  try {
    storage.setItem(ARENA_GENERATION_EFFECT_LEDGER_KEY, JSON.stringify({
      version: 1,
      entries: Object.fromEntries(retained),
    }));
  } catch {
    // The generation marker on returned cards remains the durable local re-entry guard.
  }
};

export const runArenaGenerationEffectOnce = async <T>(input: {
  generationId: string;
  storage: StoragePort | null;
  effect(): Promise<T>;
  locks?: LockPort | null;
  now?: () => Date;
}): Promise<T> => {
  const generationId = input.generationId.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(generationId)) {
    throw new Error('ARENA_GENERATION_ID_INVALID');
  }
  const active = inFlight.get(generationId);
  if (active) return active as Promise<T>;

  const execute = async (): Promise<T> => {
    const cached = readLedger(input.storage).entries[generationId];
    if (cached) return cached.result as T;
    const result = await input.effect();
    writeEntry(input.storage, generationId, result, input.now ?? (() => new Date()));
    return result;
  };
  const operation = input.locks
    ? input.locks.request(`arena-generation-effects:${generationId}`, execute)
    : execute();
  inFlight.set(generationId, operation);
  try {
    return await operation;
  } finally {
    if (inFlight.get(generationId) === operation) inFlight.delete(generationId);
  }
};
