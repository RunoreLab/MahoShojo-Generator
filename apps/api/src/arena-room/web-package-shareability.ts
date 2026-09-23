import type { ArenaRoomSharedConfig } from '@mahoshojo/contracts/arena-room';
import type { WebPackageRef } from '@mahoshojo/contracts/web-package';
import { isBuiltinWebPackageRef } from '@mahoshojo/web-package';

/**
 * Server-shareable Web Package sources are currently exactly the builtin registry.
 * Local staged packages and unknown revisions must not enter multiplayer Shared Config
 * or Proposal apply paths: other members and the authority process cannot resolve them.
 */
export const isServerShareableWebPackageRef = (ref: WebPackageRef): boolean => (
  isBuiltinWebPackageRef(ref)
);

export const assertServerShareableWebPackageRef = (ref: WebPackageRef | undefined): void => {
  if (ref !== undefined && !isServerShareableWebPackageRef(ref)) {
    throw new Error('ARENA_WEB_PACKAGE_REF_NOT_SERVER_SHAREABLE');
  }
};

export const assertSharedConfigServerShareableWebPackage = (
  config: Pick<ArenaRoomSharedConfig, 'webPackageRef'>,
): void => {
  assertServerShareableWebPackageRef(config.webPackageRef);
};
