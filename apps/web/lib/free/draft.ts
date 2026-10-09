import { FREE_GENERATION_SCHEMA_IDS, type FreeSchemaId } from '@mahoshojo/ai-core/free-generation';

export const FREE_DRAFT_KEY = 'mahoshojo.free-generator.draft.v1';

export type FreeDraftDocument = Record<string, unknown> & {
  schemaId: FreeSchemaId;
  generationMode: 'stream' | 'non-stream';
  prompt: string;
  selectedLanguage?: string;
  showFieldGuide?: boolean;
  showLanguageSection?: boolean;
};

/** 页面原初始化的唯一 owner；设置首写也消费同一合法空文档。 */
export const createEmptyFreeDraftDocument = () => ({
  schemaId: 'general' as FreeSchemaId,
  generationMode: 'non-stream' as const,
  prompt: '',
  selectedLanguage: 'zh-CN',
  showFieldGuide: false,
  showLanguageSection: false,
});

/** Web v1 的版本在键名中；未知顶层扩展（含 version）不新增协议语义。 */
export const parseFreeDraftDocument = (raw: string): FreeDraftDocument => {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid draft');
  const draft = value as Record<string, unknown>;
  if (!(FREE_GENERATION_SCHEMA_IDS as readonly unknown[]).includes(draft.schemaId)
    || (draft.generationMode !== 'stream' && draft.generationMode !== 'non-stream')
    || typeof draft.prompt !== 'string'
    || (draft.selectedLanguage !== undefined && typeof draft.selectedLanguage !== 'string')
    || (draft.showFieldGuide !== undefined && typeof draft.showFieldGuide !== 'boolean')
    || (draft.showLanguageSection !== undefined && typeof draft.showLanguageSection !== 'boolean')) {
    throw new Error('invalid draft');
  }
  return draft as FreeDraftDocument;
};
