import type { WebPackageRef } from '@mahoshojo/contracts/web-package';
import { PRESET_METADATA } from './generated/preset-metadata';

/** Discovery metadata only; all behavior and exported bytes come from static package assets. */
export type BuiltinWebPackagePreset = Readonly<{
  packageRef: WebPackageRef;
  title: string;
  description: string;
  downloadUrl: string;
}>;
/** All registered builtins are discoverable; there are no unpublished legacy revisions. */
export const BUILTIN_WEB_PACKAGE_PRESETS: readonly BuiltinWebPackagePreset[] = Object.freeze(PRESET_METADATA.map((preset) => Object.freeze({ ...preset, packageRef: Object.freeze({ ...preset.packageRef }) })));
export const BUILTIN_ARENA_NEWS_PACKAGE_REF: Readonly<WebPackageRef> = BUILTIN_WEB_PACKAGE_PRESETS.find((preset) => preset.packageRef.id === 'mahoshojo.arena-news')!.packageRef;

const sameRef = (left: WebPackageRef, right: WebPackageRef): boolean => (
  left.id === right.id && left.version === right.version && left.digest === right.digest
);

/** Resolve only registered exact identities; never substitute a newer revision. */
export const findBuiltinWebPackagePreset = (ref: WebPackageRef | null | undefined): BuiltinWebPackagePreset | undefined => (
  ref ? BUILTIN_WEB_PACKAGE_PRESETS.find((preset) => sameRef(preset.packageRef, ref)) : undefined
);

export const isBuiltinWebPackageRegistryRef = (ref: WebPackageRef): boolean => Boolean(findBuiltinWebPackagePreset(ref));
