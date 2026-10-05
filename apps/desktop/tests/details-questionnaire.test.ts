import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  buildDetailsAnswers,
  loadDefaultQuestionnaire,
  parseDefaultQuestionnaire,
} from '../src/features/details/questionnaire';

const source = () => JSON.parse(readFileSync(new URL('../../../content/questionnaires/presets/magical-girl-default.json', import.meta.url), 'utf8'));
const fixture = (question: Record<string, unknown>) => ({
  id: 'magical-girl-default', kind: 'magical-girl', title: '默认问卷', description: '说明',
  questions: [{ id: 'belief', question: '你的信念？', ...question }],
});

afterEach(() => vi.unstubAllGlobals());

describe('Desktop default questionnaire', () => {
  it('parses all 16 canonical questions without losing option values or suggestions', () => {
    const canonical = source();
    const parsed = parseDefaultQuestionnaire(canonical);
    expect(parsed.questions).toHaveLength(16);
    expect(parsed.questions).toEqual(canonical.questions);
    expect(new Set(parsed.questions.map((question) => question.id)).size).toBe(16);
  });

  it.each(['visibleIf', 'requiredIf', 'showIf', 'required', 'nextQuestionId'])(
    'fails closed when a question adds unsupported %s semantics', (field) => {
      expect(() => parseDefaultQuestionnaire(fixture({ [field]: { questionId: 'other', value: 'yes' } })))
        .toThrow('当前版本不支持');
    },
  );

  it('rejects malformed options and duplicate question identities', () => {
    expect(() => parseDefaultQuestionnaire(fixture({ options: [{ label: '守护' }] }))).toThrow('选项无法读取');
    const duplicate = fixture({});
    duplicate.questions.push({ ...duplicate.questions[0] });
    expect(() => parseDefaultQuestionnaire(duplicate)).toThrow('当前版本不支持');
  });

  it.each(['defaultRequired', 'rules', 'visibleIf'])('fails closed on unsupported root %s semantics', (field) => {
    expect(() => parseDefaultQuestionnaire({ ...fixture({}), [field]: true })).toThrow('内置问卷无法读取');
  });

  it.each(['visibleIf', 'disabledIf', 'nextQuestionId'])('fails closed on unsupported option %s semantics', (field) => {
    expect(() => parseDefaultQuestionnaire(fixture({ options: [{ value: 'yes', label: '是', [field]: 'other' }] })))
      .toThrow('选项无法读取');
  });

  const emptyOrUnknownAnswers: Record<string, string>[] = [
    {},
    { 'MG-1': ' \n\t ' },
    { unknown: '未知题目不能启动生成' },
  ];
  it.each(emptyOrUnknownAnswers)('requires at least one nonblank known answer: %j', (answers) => {
    expect(() => buildDetailsAnswers(parseDefaultQuestionnaire(source()), answers)).toThrow('至少填写一题');
  });

  it('trims answers, skips blanks and preserves canonical question ordering and identity', () => {
    const parsed = parseDefaultQuestionnaire(source());
    const answers = buildDetailsAnswers(parsed, { 'MG-3': ' 共同承担\n', 'MG-2': '  ', 'MG-1': '\t白思与 ' });
    expect(answers.map(({ questionId, answer }) => ({ questionId, answer }))).toEqual([
      { questionId: 'MG-1', answer: '白思与' }, { questionId: 'MG-3', answer: '共同承担' },
    ]);
    expect(answers[0]).toMatchObject({ questionnaireId: parsed.id, questionnaireTitle: parsed.title, question: parsed.questions[0].question });
  });

  it('checks trimmed selection values against enabled string and object options', () => {
    const parsed = parseDefaultQuestionnaire(fixture({
      allowCustom: false, options: ['守护', { value: 'together', label: '并肩前行' }, { value: 'disabled', label: '禁用', disabled: true }],
    }));
    expect(buildDetailsAnswers(parsed, { belief: ' 守护 ' })[0].answer).toBe('守护');
    expect(buildDetailsAnswers(parsed, { belief: ' together\n' })[0].answer).toBe('together');
    for (const answer of ['并肩前行', 'disabled', '自定义']) {
      expect(() => buildDetailsAnswers(parsed, { belief: answer })).toThrow('请选择一个可用选项');
    }
  });

  it('allows accepted suggestions longer than the editing hint to be generated intact', () => {
    const suggestion = '曾经为了守护同伴，选择承担所有后果。';
    const parsed = parseDefaultQuestionnaire(fixture({ maxLength: 5, suggestions: [suggestion] }));
    expect(buildDetailsAnswers(parsed, { belief: suggestion })[0].answer).toBe(suggestion);
  });

  it('loads the bundled same-origin asset without credentials or redirect fallback', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => source() }));
    vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    expect((await loadDefaultQuestionnaire(signal)).questions).toHaveLength(16);
    expect(fetch).toHaveBeenCalledWith('/questionnaires/presets/magical-girl-default.json', { signal, credentials: 'omit', redirect: 'error' });
  });

  it('rejects a missing bundled asset rather than accepting a response body', async () => {
    const json = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json })));
    await expect(loadDefaultQuestionnaire(new AbortController().signal)).rejects.toThrow('内置问卷加载失败');
    expect(json).not.toHaveBeenCalled();
  });
});
