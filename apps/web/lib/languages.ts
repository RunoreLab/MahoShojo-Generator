import languageCatalogJson from '@/public/languages.json';

export type LanguageCatalogEntry = Readonly<{ code: string; name: string }>;

/**
 * 仓库正式语言目录：与 public/languages.json 同源（本模块即由其导入生成），
 * 展示层直接同步使用，不得再手抄语言列表。
 */
export const LANGUAGE_CATALOG: readonly LanguageCatalogEntry[] = languageCatalogJson;

/** 语言代码 → 正式显示名；目录外的代码原样回退（保持可诊断）。 */
export const languageDisplayName = (code: string): string => (
  LANGUAGE_CATALOG.find((entry) => entry.code === code)?.name ?? code
);
