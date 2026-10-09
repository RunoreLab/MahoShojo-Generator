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
    expect(questionnaireData).toHaveProperty('origin', 'official');
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
  it('rejects unsafe/deep source and advanced JSON; blocks oversized edited output', () => {
    expect(() => importEditableQuestionnaire('{"__proto__":{}}')).toThrow('不安全');
    let nested: unknown = 'x'; for (let i = 0; i < 70; i++) nested = { nested };
    expect(() => roundtrip({ ...input, nested })).toThrow('过深');
    const editor = importEditableQuestionnaire(JSON.stringify(input));
    editor.questions[0].extraJson = '{"constructor":{}}';
    expect(buildEditableQuestionnaire(editor).jsonError).toContain('额外字段');
    editor.questions[0].extraJson = ''; editor.loreMarkdown = 'x'.repeat(1024 * 1024);
    expect(buildEditableQuestionnaire(editor).jsonError).toContain('1 MiB');
  });
  it('budgets the actual pretty download, not just compact source', () => {
    const raw = { ...input, questions: [{ id: 'q1', question: 'Q', options: Array.from({ length: 8000 }, () => 'x'.repeat(124)) }] };
    expect(JSON.stringify(raw).length).toBeLessThan(1024 * 1024);
    expect(roundtrip(raw).jsonError).toContain('1 MiB');
  });
  it('accepts a UTF-8 BOM while the caller retains the unchanged source', () => {
    const source = '\uFEFF' + JSON.stringify({ ...input, title: '中文问卷' });
    expect(importEditableQuestionnaire(source).title).toBe('中文问卷');
    expect(source.charCodeAt(0)).toBe(0xfeff);
  });
  it('supports lore-only questionnaires', () => {
    expect(roundtrip({ kind: 'canshou', loreMarkdown: '设定', questions: [] }).jsonError).toBeNull();
  });
});
