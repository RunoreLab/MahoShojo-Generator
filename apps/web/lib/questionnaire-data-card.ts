// 问卷数据卡判定已迁入共享域层（D5.0e）：@mahoshojo/domain/questionnaire-card。
// 本文件保留原路径作为薄 barrel，既有调用点无需改 import。

export {
  isQuestionnaireDataCard,
  isQuestionnairePayload,
  normalizeQuestionnaireDataCard,
  parseDataCardPayload,
} from '@mahoshojo/domain/questionnaire-card';
