import languageCatalogJson from '../../../content/languages.json';

export type LanguageCatalogEntry = Readonly<{ code: string; name: string }>;

/**
 * 仓库正式语言目录：权威源是根 `content/languages.json`，`public/` 副本只是构建期
 * 生成物。直接 import 权威源而不是生成副本——测试与 lint 流程不跑内容生成器，
 * 依赖 `public/` 会在干净检出上拿不到文件（MONO-006 也据此拦截）。
 * 展示层直接同步使用，不得再手抄语言列表。
 */
export const LANGUAGE_CATALOG: readonly LanguageCatalogEntry[] = languageCatalogJson;

/** 语言代码 → 正式显示名；目录外的代码原样回退（保持可诊断）。 */
export const languageDisplayName = (code: string): string => (
  LANGUAGE_CATALOG.find((entry) => entry.code === code)?.name ?? code
);
