import { describe, expect, it } from 'vitest';
import { buildEditableQuestionnaire, importEditableQuestionnaire } from '../src/questionnaire-editor';
const input = { id: 'custom', kind: 'magical-girl', title: '测试', questions: [{ id: 'q1', question: '问题', type: 'select', options: ['A', { label: 'B', value: 'b', disabled: true }] }] };
const roundtrip = (raw: unknown) => buildEditableQuestionnaire(importEditableQuestionnaire(JSON.stringify(raw)));
describe('shared questionnaire editor mapping', () => {
  it('keeps simple editor defaults and always exports non-native', () => {
    const { questionnaireData, jsonError } = roundtrip({ ...input, nativeAllowed: true, signature: 'untrusted', origin: 'official' });
    expect(jsonError).toBeNull();
    expect(questionnaireData).toMatchObject({ id: 'custom', nativeAllowed: false, questions: [{ id: 'q1', options: input.questions[0].options, allowCustom: true, required: false, maxLength: null }] });
    expect(questionnaireData).not.toHaveProperty('signature');
    expect(questionnaireData).not.toHaveProperty('origin');
  });
  it('preserves legitimate top, question and option extensions', () => {
    const raw = { ...input, extensions: { author: 'someone' }, questions: [{ ...input.questions[0], custom: { color: 'pink' }, options: [{ label: 'A', value: 'A', meaning: { x: 1 } }] }] };
    expect(roundtrip(raw).questionnaireData).toMatchObject(raw);
  });
  it.each([
    { displayIf: { questionId: 'q1', questionnaireId: 'other', value: 'A' } },
    { displayIf: { questionId: 'q1', value: ['A|B', 'C'] } },
    { displayIf: [{ questionId: 'q1', value: 'A' }] },
    { displayIf: { any: [{ questionId: 'q1', value: 'A' }], extension: true } },
    { optionsFrom: { questionId: 'q1', questionnaireId: 'other', extension: true }, suggestionsFrom: 'scope::q1' },
    { jump: [{ when: { questionId: 'q1', value: 'A' }, toEnd: true }] },
    { jump: { when: { questionId: 'q1', value: 'A' }, to: { questionId: 'q2', questionnaireId: 'other' } } },
  ])('preserves complex rule and reference semantics %j', (fields) => {
    expect(roundtrip({ ...input, questions: [{ ...input.questions[0], ...fields }] }).questionnaireData.questions[0]).toMatchObject(fields);
  });
  it('keeps simple conditions editable', () => {
    const editor = importEditableQuestionnaire(JSON.stringify({ ...input, questions: [{ ...input.questions[0], displayIf: { questionId: 'q0', operator: 'equals', value: 'A' } }] }));
    expect(editor.questions[0].displayIfEnabled).toBe(true);
    editor.questions[0].displayIfValue = 'B';
    expect(buildEditableQuestionnaire(editor).questionnaireData.questions[0].displayIf).toEqual({ questionId: 'q0', operator: 'equals', value: 'B' });
  });
  it('reports invalid advanced JSON without mutating input', () => {
    const editor = importEditableQuestionnaire(JSON.stringify(input));
    editor.questions[0].extraJson = 'null';
    const before = structuredClone(editor);
    expect(buildEditableQuestionnaire(editor).jsonError).toContain('额外字段 JSON');
    expect(editor).toEqual(before);
  });
  it('rejects malformed lists and bounded oversized input', () => {
    expect(() => importEditableQuestionnaire(' '.repeat(1024 * 1024 + 1))).toThrow('大小上限');
    expect(() => roundtrip({ ...input, questions: [{ question: 'bad', suggestions: [null] }] })).toThrow('灵感列表');
    expect(() => roundtrip({ ...input, questions: [{ question: 'bad', options: [null] }] })).toThrow('选项');
  });
  it('supports lore-only questionnaires', () => {
    expect(roundtrip({ kind: 'canshou', loreMarkdown: '设定', questions: [] }).jsonError).toBeNull();
  });
});
