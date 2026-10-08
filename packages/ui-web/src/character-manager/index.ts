// 角色管理页的产品区段（D5.1-P2-r5，DESK-PARITY-001/005）。
//
// 共享层只承载 runtime-neutral 的视图、状态转移与规则；宿主（Web/Desktop）各自通过
// props/ports 注入账号投影、云端通路、文件读取、导航与保存语义。未交付能力经
// `CharacterManagerCapabilities` 投影后表现为入口不存在。

export type { CharacterManagerCapabilities } from './capabilities';
export {
  CharacterManagerPageHeader,
  type CharacterManagerPageHeaderProps,
} from './page-header';
export {
  CharacterManagerAccountPanel,
  type CharacterManagerAccountPanelProps,
  type CharacterManagerAccountStatus,
  type CharacterManagerMyDataCardsAction,
  type CharacterManagerSignedOutContent,
} from './account-panel';
export {
  CharacterManagerGuide,
  type CharacterManagerGuideProps,
  type CharacterManagerLinkComponent,
  type CharacterManagerLinkProps,
} from './guide';
export {
  CharacterManagerDraftBar,
  type CharacterManagerDraftBarProps,
} from './draft-bar';
export {
  CharacterManagerImportSection,
  type CharacterManagerImportSectionProps,
} from './import-section';
export {
  CHARACTER_MANAGER_TEMPLATE_ORDER,
  CHARACTER_MANAGER_TEMPLATE_PLACEHOLDER_VALUE,
  CharacterManagerTemplateSelect,
  type CharacterManagerTemplateSelectProps,
} from './template-select';
export {
  NAME_REPLACE_NATIVE_MAX_CHARS,
  cardTopName,
  extractCardBaseName,
  getDisplayCharCount,
  nameReplacePreservesNativeness,
  replaceAllNamesInData,
  shouldOfferNameReplace,
} from './name-assist';
export {
  DEFAULT_NATIVENESS_REPLACE_HINT,
  DEFAULT_RANDOM_CODENAME_BUTTON_CLASS,
  DEFAULT_REPLACE_NAMES_BUTTON_CLASS,
  characterManagerNameFieldAddon,
  type CharacterManagerNameAssistOptions,
} from './name-assist-addon';
export {
  CharacterManagerArenaHistorySection,
  type ArenaHistoryLike,
  type CharacterManagerArenaHistorySectionProps,
} from './arena-history-section';
export {
  CharacterManagerCurrentStateSection,
  type CharacterManagerCurrentStateSectionProps,
} from './current-state-section';
export {
  default as AdjudicatorEditor,
  type AdjudicatorEditorProps,
} from './adjudicator-editor';
export {
  default as ScenarioEditor,
  type ScenarioEditorProps,
} from './scenario-editor';
export {
  default as ScenarioBattleStoryPlanEditor,
  type ScenarioBattleStoryPlanEditorProps,
} from './scenario-battle-story-plan-editor';
export {
  CharacterManagerEditorBody,
  type CharacterManagerEditorBodyProps,
  type CharacterManagerFieldPath,
} from './editor-body';
export {
  CHARACTER_MANAGER_PAGE_DRAFT_KEY,
  CHARACTER_MANAGER_PAGE_DRAFT_TTL_MS,
  CHARACTER_MANAGER_PAGE_DRAFT_VERSION,
  buildCharacterManagerPageDraftPayload,
  clearCharacterManagerPageDraft,
  readCharacterManagerPageDraft,
  restoreCharacterManagerPageDraft,
  writeCharacterManagerPageDraft,
  type CharacterManagerPageDraftInput,
  type CharacterManagerPageDraftPayload,
  type RestoredCharacterManagerPageDraft,
} from './page-draft';
export { CharacterManagerPreviewPanel } from './preview-panel';
