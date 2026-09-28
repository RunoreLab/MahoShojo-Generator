import type { WebPackageRef } from '@mahoshojo/contracts/web-package';
import { PRESET_METADATA } from './generated/preset-metadata';

/** Discovery metadata only; all behavior and exported bytes come from static package assets. */
export type BuiltinWebPackagePreset = Readonly<{
  packageRef: WebPackageRef;
  title: string;
  description: string;
  downloadUrl: string;
}>;
export const BUILTIN_WEB_PACKAGE_REVISIONS = Object.freeze(PRESET_METADATA.map((preset) => Object.freeze({ ...preset, packageRef: Object.freeze({ ...preset.packageRef }) })));

/** Only active showcases appear in selection/download grids. Retained revisions still replay. */
export const BUILTIN_WEB_PACKAGE_PRESETS: readonly BuiltinWebPackagePreset[] = Object.freeze(BUILTIN_WEB_PACKAGE_REVISIONS.filter((preset) => preset.status === 'active'));

const sameRef = (left: WebPackageRef, right: WebPackageRef): boolean => (
  left.id === right.id && left.version === right.version && left.digest === right.digest
);

/** Exact lookup includes retired packages for existing selections and historical replay. */
export const findBuiltinWebPackagePreset = (ref: WebPackageRef | null | undefined): BuiltinWebPackagePreset | undefined => (
  ref ? BUILTIN_WEB_PACKAGE_REVISIONS.find((preset) => sameRef(preset.packageRef, ref)) : undefined
);

export const isBuiltinWebPackageRegistryRef = (ref: WebPackageRef): boolean => Boolean(findBuiltinWebPackagePreset(ref));
