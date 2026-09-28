import type { WebPackageRef } from '@mahoshojo/contracts/web-package';
import { BUILTIN_VISUAL_NOVEL_PACKAGE_REF } from './visual-novel-v1';
import { FORUM_PACKAGE_REF, CHOICE_PACKAGE_REF } from './creative-presets-v1';

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
  Object.freeze({
    packageRef: FORUM_PACKAGE_REF,
    title: '星屑社区 · 角色论坛',
    description: '在虚构社区里搜索话题、浏览角色的讨论，收藏值得回味的故事线索。',
    downloadUrl: 'web-package:builtin/mahoshojo.starlight-forum@1.0.0',
  }),
  Object.freeze({
    packageRef: CHOICE_PACKAGE_REF,
    title: '命运岔路 · 情境抉择',
    description: '走进角色的情境，选择行动、获得不同反馈与旅程回顾，还可以重玩探索。',
    downloadUrl: 'web-package:builtin/mahoshojo.crossroads@1.0.0',
  }),
]);

const sameRef = (left: WebPackageRef, right: WebPackageRef): boolean => (
  left.id === right.id && left.version === right.version && left.digest === right.digest
);

export const findBuiltinWebPackagePreset = (ref: WebPackageRef | null | undefined): BuiltinWebPackagePreset | undefined => (
  ref ? BUILTIN_WEB_PACKAGE_PRESETS.find((preset) => sameRef(preset.packageRef, ref)) : undefined
);

/** Builtin membership is registry-driven so a second preset is first-class without core edits. */
export const isBuiltinWebPackageRegistryRef = (ref: WebPackageRef): boolean => (
  BUILTIN_WEB_PACKAGE_PRESETS.some((preset) => sameRef(preset.packageRef, ref))
);
