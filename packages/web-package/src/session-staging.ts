import type { WebPackageRef } from '@mahoshojo/contracts/web-package';
import type { VerifiedWebPackage } from './verify';

type ResolvedWebPackage = VerifiedWebPackage;

const stagedByDigest = new Map<string, ResolvedWebPackage>();

const sameRef = (left: WebPackageRef, right: WebPackageRef): boolean => (
  left.id === right.id && left.version === right.version && left.digest === right.digest
);

/** Current-session staging only; optional persistence lives outside this package. */
export const stageLocalWebPackage = (pkg: ResolvedWebPackage): void => {
  stagedByDigest.set(pkg.ref.digest, Object.freeze(pkg));
};

export const unstageLocalWebPackage = (ref: WebPackageRef): void => {
  stagedByDigest.delete(ref.digest);
};

export const getStagedLocalWebPackage = (ref: WebPackageRef): ResolvedWebPackage | undefined => {
  const pkg = stagedByDigest.get(ref.digest);
  return pkg && sameRef(pkg.ref, ref) ? pkg : undefined;
};

export const listStagedLocalWebPackages = (): readonly ResolvedWebPackage[] => (
  [...stagedByDigest.values()]
);

export const clearLocalWebPackageSessionStaging = (): void => {
  stagedByDigest.clear();
};
