import type { WebPackageRef } from '@mahoshojo/contracts/web-package';
import { BUILTIN_VISUAL_NOVEL_PACKAGE_REF } from './visual-novel-v1';

/** Discovery/selection only; package behavior is defined by canonical ZIP identity. */
export type BuiltinWebPackagePreset = Readonly<{
  packageRef: WebPackageRef;
  title: string;
  description: string;
  downloadUrl: string;
}>;

export const BUILTIN_WEB_PACKAGE_PRESETS: readonly BuiltinWebPackagePreset[] = Object.freeze([
  Object.freeze({
    packageRef: BUILTIN_VISUAL_NOVEL_PACKAGE_REF,
    title: 'Visual Novel Lite · 视觉小说',
    description: '视觉小说使用内置阅读器，AI 只生成本场故事；完成后可切换安全文本显示。',
    downloadUrl: 'web-package:builtin/mahoshojo.visual-novel-lite@1.0.0',
  }),
]);

export const findBuiltinWebPackagePreset = (ref: WebPackageRef | null | undefined): BuiltinWebPackagePreset | undefined => (
  ref ? BUILTIN_WEB_PACKAGE_PRESETS.find((preset) => (
    preset.packageRef.id === ref.id
    && preset.packageRef.version === ref.version
    && preset.packageRef.digest === ref.digest
  )) : undefined
);
