// canonical 实现已上移至 `@mahoshojo/domain/creator/selection`（D5.1-G3）；
// 保留本 re-export 以兼容既有 `@/lib/creator/questionnaire-template` 引用与测试。
export {
  filterCreatorQuestionnairePresetEntries,
  pickDefaultCreatorQuestionnairePresetEntry,
  reconcileQuestionnaireSelectionsForTemplate,
} from '@mahoshojo/domain/creator/selection';
