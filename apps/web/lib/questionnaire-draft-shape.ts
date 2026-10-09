import type { QuestionnaireAnswerMatchTarget } from '@mahoshojo/domain/questionnaire';

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const answerEntry = (value: unknown): boolean => record(value)
  && (typeof value.answer === 'string' || typeof value.value === 'string');

/** 仅识别原读取器已经支持的形状；未知/未来文档必须留在原 key，不能被空 autosave 删除。 */
export function assertSupportedQuestionnaireAnswerDraft(value: unknown, targets: readonly QuestionnaireAnswerMatchTarget[]): void {
  if (Array.isArray(value)) {
    if (value.every((entry) => typeof entry === 'string' || answerEntry(entry))) return;
    throw new Error('unsupported answer draft entries');
  }
  if (!record(value)) throw new Error('unsupported answer draft');
  if (value.version !== undefined && ![1, 2, 3].includes(value.version as number)) throw new Error('unsupported answer draft version');
  const hasDirect = Object.prototype.hasOwnProperty.call(value, 'answersByKey');
  const hasEntries = Object.prototype.hasOwnProperty.call(value, 'answerEntries');
  if (hasDirect && (!record(value.answersByKey) || !Object.values(value.answersByKey).every((entry) => typeof entry === 'string'))) throw new Error('invalid keyed answers');
  if (hasEntries && (!Array.isArray(value.answerEntries) || !value.answerEntries.every(answerEntry))) throw new Error('invalid answer entries');
  if (hasDirect || hasEntries) return;
  // 历史字典只按题目 id / 零或一起始序号 / MG-N 读取，保留原有匹配策略。
  const knownKeys = new Set(targets.flatMap((target, index) => [target.questionId, `${index}`, `${index + 1}`, `MG-${index + 1}`].filter((key): key is string => Boolean(key))));
  if (Object.entries(value).some(([key, entry]) => knownKeys.has(key) && typeof entry === 'string')) return;
  throw new Error('unrecognized answer draft shape');
}
