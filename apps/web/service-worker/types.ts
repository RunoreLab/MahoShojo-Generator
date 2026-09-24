import type { WebPackageRef } from '@mahoshojo/contracts/web-package';

export type WebPackageResourceFile = Readonly<{
  mediaType: string;
  bytes: Uint8Array;
}>;

export type WebPackageResourceSnapshot = Readonly<{
  instanceId: string;
  packageRef: WebPackageRef;
  entry: string;
  files: ReadonlyMap<string, WebPackageResourceFile>;
}>;

export type WebPackageInstanceRecord = Readonly<{
  instanceId: string;
  packageRef: WebPackageRef;
  entry: string;
  createdAt: number;
  files: ReadonlyArray<Readonly<{ path: string; mediaType: string; bytes: ArrayBuffer }>>;
}>;
