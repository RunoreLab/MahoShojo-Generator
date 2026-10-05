import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  buildDetailsAnswers,
  buildDetailsFlowItems,
  loadDefaultQuestionnaire,
  parseQuestionnaireSelection,
} from '../src/features/details/questionnaire';
import { buildQuestionKey } from '@mahoshojo/domain/questionnaire-definition';

const source = () => JSON.parse(readFileSync(new URL('../../../content/questionnaires/presets/magical-girl-default.json', import.meta.url), 'utf8'));
const fixture = (question: Record<string, unknown>) => ({
  id: 'magical-girl-default', kind: 'magical-girl', title: '默认问卷', description: '说明',
  questions: [{ id: 'belief', question: '你的信念？', ...question }],
});

afterEach(() => vi.unstubAllGlobals());

const loadFixture = async (body: unknown) => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => body })));
  return loadDefaultQuestionnaire(new AbortController().signal);
};

describe('Desktop default questionnaire', () => {
  it('parses all 16 canonical questions preserving ids, order and option values', async () => {
    const canonical = source();
    const parsed = await loadFixture(canonical);
    expect(parsed.id).toBe('magical-girl-default');
    expect(parsed.kind).toBe('magical-girl');
    expect(parsed.questions).toHaveLength(16);
    expect(parsed.questions.map((question) => question.id)).toEqual(canonical.questions.map((question) => question.id));
    expect(new Set(parsed.questions.map((question) => question.id)).size).toBe(16);
  });

  it('keeps conditional/jump/reference semantics instead of rejecting them', async () => {
    const parsed = await loadFixture(fixture({
      displayIf: { questionId: 'other', operator: 'notEmpty' },
      jump: { when: { questionId: 'other', operator: 'equals', value: 'x' }, toEnd: true },
      optionsFrom: { questionId: 'other' },
      required: true,
    }));
    const question = parsed.questions[0];
    expect(question.displayIf).toBeTruthy();
    expect(question.jump).toBeTruthy();
    expect(question.optionsFrom).toEqual({ questionId: 'other', key: undefined, questionnaireId: undefined });
    expect(question.required).toBe(true);
  });

  const emptyOrUnknownAnswers: Record<string, string>[] = [
    {},
    { 'magical-girl-default::MG-1': ' \n\t ' },
    { 'other-questionnaire::MG-1': '其他问卷的回答不参与本卷' },
  ];
  it.each(emptyOrUnknownAnswers)('requires at least one nonblank known answer: %j', async (answers) => {
    const parsed = await loadFixture(source());
    expect(() => buildDetailsAnswers(buildDetailsFlowItems(parsed), answers)).toThrow('至少填写一题');
  });

  it('trims answers, skips blanks and preserves canonical question ordering and identity', async () => {
    const parsed = await loadFixture(source());
    const flow = buildDetailsFlowItems(parsed);
    const keyOf = (id: string) => buildQuestionKey(parsed.id, id, flow.findIndex((item) => item.question.id === id));
    const answers = buildDetailsAnswers(flow, {
      [keyOf('MG-3')]: ' 共同承担\n',
      [keyOf('MG-2')]: '  ',
      [keyOf('MG-1')]: '\t白思与 ',
    });
    expect(answers.map(({ questionId, answer }) => ({ questionId, answer }))).toEqual([
      { questionId: 'MG-1', answer: '白思与' }, { questionId: 'MG-3', answer: '共同承担' },
    ]);
    expect(answers[0]).toMatchObject({ questionnaireId: parsed.id, questionnaireTitle: parsed.title, question: parsed.questions[0].question });
  });

  it('checks trimmed selection values against enabled string and object options', async () => {
    const parsed = await loadFixture(fixture({
      allowCustom: false, options: ['守护', { value: 'together', label: '并肩前行' }, { value: 'disabled', label: '禁用', disabled: true }],
    }));
    const flow = buildDetailsFlowItems(parsed);
    const key = flow[0].key;
    expect(buildDetailsAnswers(flow, { [key]: ' 守护 ' })[0].answer).toBe('守护');
    expect(buildDetailsAnswers(flow, { [key]: ' together\n' })[0].answer).toBe('together');
    for (const answer of ['并肩前行', 'disabled', '自定义']) {
      expect(() => buildDetailsAnswers(flow, { [key]: answer })).toThrow('请选择一个可用选项');
    }
  });

  it('allows accepted suggestions longer than the editing hint to be generated intact', async () => {
    const suggestion = '曾经为了守护同伴，选择承担所有后果。';
    const parsed = await loadFixture(fixture({ maxLength: 5, suggestions: [suggestion] }));
    const flow = buildDetailsFlowItems(parsed);
    expect(buildDetailsAnswers(flow, { [flow[0].key]: suggestion })[0].answer).toBe(suggestion);
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

describe('parseQuestionnaireSelection', () => {
  const basePayload = {
    kind: 'magical-girl',
    title: '卡内问卷',
    nativeAllowed: true,
    questions: [{ id: 'q1', question: '名字？' }],
  };

  it('云端问卷卡保留服务器身份并归一化题目', () => {
    const parsed = parseQuestionnaireSelection({
      ...basePayload,
      _cardId: 'card-9', _cardName: '云端问卷', _cardType: 'questionnaire', _isPublic: 0,
      _storageLocation: 'cloud', _author: 'someone',
    } as never);
    if ('error' in parsed) throw new Error(parsed.error);
    expect(parsed.source).toEqual({ kind: 'cloud', title: '云端问卷', cardId: 'card-9' });
    expect(parsed.questionnaire.questions).toHaveLength(1);
  });

  it('本地库卡不带服务器身份', () => {
    const parsed = parseQuestionnaireSelection({
      ...basePayload,
      _cardId: '', _cardName: '本地问卷', _cardType: 'questionnaire', _isPublic: false,
      _storageLocation: 'local', _author: '',
    } as never);
    if ('error' in parsed) throw new Error(parsed.error);
    expect(parsed.source.kind).toBe('local');
    expect(parsed.source.cardId).toBeUndefined();
  });

  it.each([undefined, false])('数据卡问卷未声明 nativeAllowed === true 时拒绝在本机执行：%j', (nativeAllowed) => {
    expect(parseQuestionnaireSelection({
      ...basePayload, nativeAllowed,
      _cardType: 'questionnaire', _storageLocation: 'cloud', _cardName: '云端问卷',
    } as never)).toEqual({ error: '这张问卷数据卡未声明允许在客户端原生运行。' });
  });

  it('非问卷卡与空题问卷被拒绝', () => {
    expect(parseQuestionnaireSelection({ _cardType: 'character', _storageLocation: 'cloud' } as never))
      .toEqual({ error: '这张数据卡不是问卷。' });
    expect(parseQuestionnaireSelection({
      kind: 'magical-girl', nativeAllowed: true, questions: [],
      _cardType: 'questionnaire', _storageLocation: 'local', _cardName: '空',
    } as never)).toEqual({ error: '这张问卷数据卡没有可用题目。' });
  });
});
