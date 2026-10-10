import { useCallback, useEffect, useRef, useState } from 'react';

/** Reports transient form state to the host's existing leave guard; owns no dialog or persistence. */
export type ArenaInputLifecyclePorts = Readonly<{
  onDirtyChange?(dirty: boolean): void;
  onBusyChange?(busy: boolean): void;
}>;
export function useArenaInputLifecycle(dirty: boolean, { onDirtyChange, onBusyChange }: ArenaInputLifecyclePorts, childBusy = false) {
  const [pending, setPending] = useState(0);
  const latestPorts = useRef({ onDirtyChange, onBusyChange });
  latestPorts.current = { onDirtyChange, onBusyChange };
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange?.(pending > 0 || childBusy); }, [pending, childBusy, onBusyChange]);
  useEffect(() => () => {
    latestPorts.current.onDirtyChange?.(false);
    latestPorts.current.onBusyChange?.(false);
  }, []);
  return useCallback(async <T,>(action: () => T | Promise<T>): Promise<T> => {
    setPending((value) => value + 1);
    try { return await action(); }
    finally { setPending((value) => value - 1); }
  }, []);
}
