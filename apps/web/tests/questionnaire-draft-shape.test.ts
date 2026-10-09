import { expect, it } from 'vitest';
import { assertSupportedQuestionnaireAnswerDraft } from '@/lib/questionnaire-draft-shape';
const targets = [{ key: 'preset:q::name', index: 0, question: '姓名', questionId: 'name' }];
it.each([
  ['回答'], [{ question: '姓名', answer: '回答' }], [{ value: '回答' }], [],
  { version: 3, answersByKey: { 'preset:q::name': '回答' }, answerEntries: [{ key: 'preset:q::name', answer: '回答' }] },
  { version: 2, answerEntries: [{ value: '回答' }] }, { answersByKey: {} }, { answerEntries: [] },
  { name: '回答' }, { '0': '回答' }, { '1': '回答' }, { 'MG-1': '回答' },
].map((value) => [value]))('retains a shape supported by the existing answer reader: %j', (value) => {
  expect(() => assertSupportedQuestionnaireAnswerDraft(value, targets)).not.toThrow();
});
it.each([
  null, true, 42, '回答', {}, { version: 99, answersByKey: {} },
  { version: 3, answersByKey: [] }, { answerEntries: [null] }, { unknown: { keep: true } },
].map((value) => [value]))('rejects an unknown payload before an empty autosave can remove it: %j', (value) => {
  expect(() => assertSupportedQuestionnaireAnswerDraft(value, targets)).toThrow();
});

it.each(['version', 'answerEntries', 'answersByKey'])('retains a legacy question id named %s without accepting a future envelope', (questionId) => {
  const custom = [{ key: `preset:q::${questionId}`, index: 0, question: '旧题', questionId }];
  expect(() => assertSupportedQuestionnaireAnswerDraft({ [questionId]: '旧回答' }, custom)).not.toThrow();
  expect(() => assertSupportedQuestionnaireAnswerDraft({ version: 99, answersByKey: {} }, custom)).toThrow();
});
