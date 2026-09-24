export type ArenaGenerationOutputContract =
  | 'stream-markdown'
  | 'structured-report'
  | 'web-document'
  | 'web-package-target';

/** Ordinary generated Web (full HTML document) and package-backed targets share web reportFormat. */
export const isWebArenaOutputContract = (
  contract: unknown,
): boolean => contract === 'web-document' || contract === 'web-package-target';

/** Package-backed generation produces exactly one target file overlay, not a free-form HTML document. */
export const isPackageBackedOutputContract = (
  contract: unknown,
): boolean => contract === 'web-package-target';
