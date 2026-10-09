import { useEffect, useMemo, useRef } from 'react';

export interface TavernSourceSelection {
  begin: () => number;
  isCurrent: (token: number) => boolean;
}
/** Files and delayed library reads share one intent order; completion order has no authority. */
export function useTavernSourceSelection(): TavernSourceSelection {
  const epoch = useRef(0);
  useEffect(() => () => { epoch.current += 1; }, []);
  return useMemo(() => ({ begin: () => ++epoch.current, isCurrent: (token: number) => token === epoch.current }), []);
}
