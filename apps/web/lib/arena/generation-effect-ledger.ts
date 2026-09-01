type LockPort = {
  request<T>(_name: string, _callback: () => Promise<T>): Promise<T>;
};

const inFlight = new Map<string, Promise<unknown>>();

export const runArenaGenerationEffectOnce = async <T>(input: {
  generationId: string;
  effect(): Promise<T>;
  locks?: LockPort | null;
}): Promise<T> => {
  const generationId = input.generationId.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(generationId)) {
    throw new Error('ARENA_GENERATION_ID_INVALID');
  }
  const active = inFlight.get(generationId);
  if (active) return active as Promise<T>;

  const operation = input.locks
    ? input.locks.request(`arena-generation-effects:${generationId}`, input.effect)
    : input.effect();
  inFlight.set(generationId, operation);
  try {
    return await operation;
  } finally {
    if (inFlight.get(generationId) === operation) inFlight.delete(generationId);
  }
};
