/** Mounted page guards already know which operations cannot be interrupted. */
const operations = new Set<() => boolean>();

export function registerBusyOperation(isBusy: () => boolean): () => void {
  operations.add(isBusy);
  return () => { operations.delete(isBusy); };
}

export function hasBusyOperations(): boolean {
  return [...operations].some((isBusy) => isBusy());
}
