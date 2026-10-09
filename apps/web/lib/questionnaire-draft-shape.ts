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
  // 旧字典允许题 id 与信封字段同名；只有全为当前题 id 的字符串回答才优先识别。
  const questionIds = new Set(targets.map((target) => target.questionId).filter(Boolean));
  const entries = Object.entries(value);
  if (entries.length > 0 && entries.every(([key, answer]) => questionIds.has(key) && typeof answer === 'string')) return;
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

/** 比较答案语义与最后一次已恢复/成功保存的基线；删空也是修改，空占位不算新内容。 */
export function questionnaireAnswerDraftFingerprint(answers: Readonly<Record<string, string>>): string {
  return JSON.stringify(Object.entries(answers).filter(([, answer]) => answer.trim()).sort(([left], [right]) => left.localeCompare(right)));
}
