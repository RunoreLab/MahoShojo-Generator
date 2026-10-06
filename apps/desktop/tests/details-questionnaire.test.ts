import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  buildDetailsAnswers,
  buildDetailsFlowItems,
  builtinQuestionnaireSource,
  builtinSelectionId,
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
    expect(parsed.questions.map((question) => question.id)).toEqual(
      (canonical.questions as Array<{ id: string }>).map((question) => question.id),
    );
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

  it.each([undefined, []])('allowCustom:false + options=%j 回退为文本题，自由回答照常收集', async (options) => {
    // Web 既有口径：封闭题没有任何可点选选项时显示文本框；投影与 UI 一致，
    // 不把一个无法点选的题目变成提交时才报错的陷阱（D5.1a-r2）。
    const parsed = await loadFixture(fixture({ allowCustom: false, options }));
    const flow = buildDetailsFlowItems(parsed);
    expect(buildDetailsAnswers(flow, { [flow[0].key]: ' 自定义誓约 ' })[0].answer).toBe('自定义誓约');
  });

  it('allows accepted suggestions longer than the editing hint to be generated intact', async () => {
    const suggestion = '曾经为了守护同伴，选择承担所有后果。';
    const parsed = await loadFixture(fixture({ maxLength: 5, suggestions: [suggestion] }));
    const flow = buildDetailsFlowItems(parsed);
    expect(buildDetailsAnswers(flow, { [flow[0].key]: suggestion })[0].answer).toBe(suggestion);
  });

  it('内置预设未声明 nativeAllowed 时按 preset 语义归一化为 true', async () => {
    const parsed = await loadFixture(fixture({}));
    expect(parsed.nativeAllowed).toBe(true);
  });

  it('显式声明 nativeAllowed:false 的预设仍加载成功，只是无签名资格', async () => {
    const parsed = await loadFixture({ ...fixture({}), nativeAllowed: false });
    expect(parsed.nativeAllowed).toBe(false);
    expect(parsed.questions).toHaveLength(1);
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
    id: 'shared-questionnaire',
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
    expect(parsed.source).toMatchObject({ kind: 'cloud', title: '云端问卷', cardId: 'card-9' });
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

  it.each([undefined, false])('数据卡问卷 nativeAllowed=%j 仍可选择与生成，仅失去签名资格', (nativeAllowed) => {
    // `nativeAllowed` 不是可用性门禁：未声明/显式 false 的云端卡按 database
    // 语义归一化为 false，生成照常、hosted 请求携带 allowNativeSignature=false。
    const parsed = parseQuestionnaireSelection({
      ...basePayload, nativeAllowed,
      _cardType: 'questionnaire', _storageLocation: 'cloud', _cardName: '云端问卷',
    } as never);
    if ('error' in parsed) throw new Error(`unexpected parse error: ${parsed.error}`);
    expect(parsed.questionnaire.nativeAllowed).toBe(false);
  });

  it.each([
    ['cloud', { _cardType: 'questionnaire', _storageLocation: 'cloud', _cardName: '云端问卷' }, true],
    // 本地库卡按 upload 语义恒 false——即便正文声称 nativeAllowed 也不可信。
    ['local', { _cardType: 'questionnaire', _storageLocation: 'local', _cardName: '本地问卷' }, false],
  ] as const)('来源=%s 的数据卡问卷 nativeAllowed 归一化为 %j', (_kind, meta, expected) => {
    const parsed = parseQuestionnaireSelection({
      ...basePayload, nativeAllowed: true,
      ...meta,
    } as never);
    if ('error' in parsed) throw new Error(`unexpected parse error: ${parsed.error}`);
    expect(parsed.questionnaire.nativeAllowed).toBe(expected);
  });

  it('非问卷卡与空内容卡被拒绝', () => {
    expect(parseQuestionnaireSelection({ _cardType: 'character', _storageLocation: 'cloud' } as never))
      .toEqual({ error: '这张数据卡不是问卷。' });
    expect(parseQuestionnaireSelection({
      kind: 'magical-girl', nativeAllowed: true, questions: [],
      _cardType: 'questionnaire', _storageLocation: 'local', _cardName: '空',
    } as never)).toEqual({ error: '这张数据卡不包含可识别的问卷内容。' });
  });

  it('纯 Lore 问卷卡（无题目有设定）可以作为选择加入——与共享面板口径一致', () => {
    const parsed = parseQuestionnaireSelection({
      id: 'lore-only', kind: 'magical-girl', title: '世界观设定卡',
      questions: [], loreMarkdown: '# 世界观\n只有设定没有题目。',
      _cardType: 'questionnaire', _storageLocation: 'local', _cardName: '设定卡',
    } as never);
    if ('error' in parsed) throw new Error(`unexpected parse error: ${parsed.error}`);
    expect(parsed.questionnaire.questions).toHaveLength(0);
    expect(parsed.questionnaire.loreMarkdown).toContain('世界观');
    // 本地副本无服务器背书：即便正文声明 nativeAllowed 也强制为非原生。
    expect(parsed.questionnaire.nativeAllowed).toBe(false);
  });

  describe('selectionId 实例作用域（D5.0e-r1）', () => {
    const cloudPayload = {
      ...basePayload, _cardId: 'card-9', _cardName: '云端问卷',
      _cardType: 'questionnaire', _isPublic: 0, _storageLocation: 'cloud', _author: 'someone',
    } as never;
    const localPayload = {
      ...basePayload, _cardId: '', _cardName: '本地问卷',
      _cardType: 'questionnaire', _isPublic: false, _storageLocation: 'local', _author: '',
    } as never;

    it('采用宿主 selectionContext 作为权威实例标识', () => {
      const cloud = parseQuestionnaireSelection(cloudPayload, {
        selectionId: 'cloud:card-9', storageLocation: 'cloud', cloudCardId: 'card-9',
      });
      const local = parseQuestionnaireSelection(localPayload, {
        selectionId: 'local:rec-42', storageLocation: 'local',
      });
      if ('error' in cloud || 'error' in local) throw new Error('unexpected parse error');
      expect(cloud.source.selectionId).toBe('cloud:card-9');
      expect(local.source.selectionId).toBe('local:rec-42');
    });

    it('缺上下文时按来源兜底，云端与本地副本仍互不错投', () => {
      const cloud = parseQuestionnaireSelection(cloudPayload);
      const local = parseQuestionnaireSelection(localPayload);
      if ('error' in cloud || 'error' in local) throw new Error('unexpected parse error');
      expect(cloud.source.selectionId).toBe('cloud:card-9');
      expect(local.source.selectionId).toContain('local:');
      expect(local.source.selectionId).not.toBe(cloud.source.selectionId);
    });

    it('同一问卷的云端与本地实例产出不同答案键，canonical id 保持问卷身份', () => {
      const cloud = parseQuestionnaireSelection(cloudPayload);
      const local = parseQuestionnaireSelection(localPayload);
      if ('error' in cloud || 'error' in local) throw new Error('unexpected parse error');
      // 两份正文共享同一个 canonical questionnaire.id（normalizeQuestionnaireDefinition 同源）。
      const cloudFlow = buildDetailsFlowItems(cloud.questionnaire, cloud.source.selectionId);
      const localFlow = buildDetailsFlowItems(local.questionnaire, local.source.selectionId);
      expect(cloud.questionnaire.id).toBe(local.questionnaire.id);
      expect(cloudFlow[0].questionnaireId).toBe(localFlow[0].questionnaireId);
      expect(cloudFlow[0].key).not.toBe(localFlow[0].key);
      expect(cloudFlow[0].key).toBe(`cloud:card-9::q1`);
      expect(localFlow[0].key).toContain('local:');
      // 重复选中同一云端实例得到同一 scope；不同实例互不串答。
      const again = buildDetailsFlowItems(cloud.questionnaire, 'cloud:card-9');
      expect(again[0].key).toBe(cloudFlow[0].key);
      const answers = { [cloudFlow[0].key]: '云端回答', [localFlow[0].key]: '本地回答' };
      expect(buildDetailsAnswers(cloudFlow, answers)[0].answer).toBe('云端回答');
      expect(buildDetailsAnswers(localFlow, answers)[0].answer).toBe('本地回答');
    });

    it('内置问卷使用 builtin:<id> 作用域', async () => {
      const questionnaire = await loadFixture(fixture({}));
      const source = builtinQuestionnaireSource(questionnaire);
      expect(source.selectionId).toBe(builtinSelectionId(questionnaire.id));
      const flow = buildDetailsFlowItems(questionnaire, source.selectionId);
      expect(flow[0].key).toBe(`${builtinSelectionId(questionnaire.id)}::belief`);
      expect(flow[0].questionnaireScopeId).toBe(source.selectionId);
      // 不传 scopeId 时回落到 canonical id（兼容旧调用形态）。
      const legacy = buildDetailsFlowItems(questionnaire);
      expect(legacy[0].key).toBe(`${questionnaire.id}::belief`);
    });
  });
});
