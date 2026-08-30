import { loadEnvConfig } from '@next/env';

/**
 * Loads ignored repository-root .env files only as a compatibility fallback.
 *
 * Next's env loader resets process.env to the environment captured before its
 * first load when forceReload is enabled. Preserve the already-loaded app env
 * and explicit process env so their normal precedence remains authoritative.
 */
export function loadRepositoryRootEnvFallback(repositoryRoot: string, development: boolean): void {
  const higherPriorityEnvironment = { ...process.env };

  loadEnvConfig(repositoryRoot, development, console, true);
  Object.assign(process.env, higherPriorityEnvironment);
}

export function loadApplicationEnvironmentWithRootFallback(
  applicationDirectory: string,
  repositoryRoot: string,
  development: boolean,
): void {
  loadEnvConfig(applicationDirectory, development, console, true);
  loadRepositoryRootEnvFallback(repositoryRoot, development);
}
