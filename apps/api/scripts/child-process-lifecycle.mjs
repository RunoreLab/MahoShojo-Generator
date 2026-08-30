/**
 * @param {{
 *   exitCode: number | null;
 *   signalCode: NodeJS.Signals | null;
 *   kill: (signal: NodeJS.Signals) => boolean;
 *   once: (event: 'exit', listener: (...args: unknown[]) => void) => unknown;
 * }} child
 */
export const terminateChildProcess = async (child) => {
  if (child.exitCode !== null || child.signalCode !== null) return;

  const exited = new Promise((resolve) => {
    child.once('exit', resolve);
  });
  child.kill('SIGTERM');
  await exited;
};
