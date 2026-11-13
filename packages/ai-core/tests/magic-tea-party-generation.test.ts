import { describe, expect, it } from 'vitest';
import type { MagicTeaPartyMessage, MagicTeaPartyRole, MagicTeaPartyScenario } from '@mahoshojo/domain/magic-tea-party/types';
import { estimateTokensFromText } from '@mahoshojo/domain/token-estimate';
import {
  MAGIC_TEA_PARTY_MAX_TOTAL_CHARS,
  appendMagicTeaPartySystemInstruction,
  applyMagicTeaPartyMessageLimits,
  buildMagicTeaPartyChoicesPrompt,
  buildMagicTeaPartyHistory,
  buildMagicTeaPartyJsonlPreview,
  buildMagicTeaPartyMainPrompt,
  buildMagicTeaPartyMainPromptMessages,
  buildMagicTeaPartyChoicesPromptMessages,
  buildMagicTeaPartySummarizePrompt,
  buildMagicTeaPartySummarizePromptMessages,
  buildMagicTeaPartyUpdatePrompt,
  buildMagicTeaPartyUpdatePromptMessages,
  buildRoleProfileText,
  buildWorldbookText,
  clipMagicTeaPartyMessageContent,
  createMagicTeaPartyJsonlStreamState,
  createMagicTeaPartyStreamPreview,
  estimateMagicTeaPartyHistoryTokens,
  estimateMagicTeaPartyTokens,
  extractMagicTeaPartyNoticesFromJsonl,
  extractMagicTeaPartyNoticesFromMarkdown,
  extractMagicTeaPartySideChannelsFromJsonl,
  flushMagicTeaPartyJsonlStream,
  getMagicTeaPartyPreset,
  ingestMagicTeaPartyJsonlChunk,
  isMagicTeaPartyTotalOverflow,
  mapMagicTeaPartyUpdateDraftCompat,
  parseMagicTeaPartyJsonl,
  resolveMagicTeaPartyMessageCharLimit,
  resolveMagicTeaPartyTokenBudget,
  trimMagicTeaPartyHistory,
  type MagicTeaPartyStreamPreviewUpdate,
} from '../src/magic-tea-party';

const message = (id: string, role: MagicTeaPartyMessage['role'], content: string): MagicTeaPartyMessage => ({
  id, sessionId: 'tea', role, content, createdAt: 0,
});

const role: MagicTeaPartyRole = {
  id: 'r1', name: '巡夜人', source: 'local', template: 'general',
  card: {
    templateId: '通用角色', name: '巡夜人', content: '守望街区的人。',
    signature: 'role-signature', isPreset: true,
    userAnswers: [{ question: '为何守望？', answer: '为了朋友。', questionnaireTitle: '来历' }],
    current_state: { summary: '湿透的斗篷', fields: [{ label: '持灯', type: 'boolean', value: true }] },
    arena_history: {
      entries: [{ id: 1, title: '旧桥重逢', participants: ['巡夜人', '旅人'], winner: '不适用', impact: '开始信任旅人', metadata: {} }],
    },
  },
};

const scenario: MagicTeaPartyScenario = {
  id: 's1', title: '雨夜茶馆', source: 'local',
  card: { templateId: '通用情景', title: '雨夜茶馆', content: '风铃下的茶馆还亮着灯。', signature: 'scenario-signature', metadata: { private: 'scenario-meta' } },
};

const promptInput = () => ({
  session: {
    playerRoleId: role.id,
    summary: '两人在旧桥相识。',
    protocolShadow: { updatedAt: 0, drafts: [{ roleId: role.id, characterName: role.name, impact: '约定同行', currentStateSummary: '已换上干衣' }] },
    settings: {
      providerId: 'openai', modelId: 'test-model', userDisplayName: '旅人',
      outputFormat: 'jsonl' as const, outputPlan: { choices: 'on' as const, summary: 'auto' as const, updates: 'on' as const },
      enableChoices: true, choiceCount: 4, readArenaHistory: true, readCurrentState: true,
      writeArenaHistory: true, writeCurrentState: true,
    },
  },
  roles: [role],
  scenario,
  auxScenarios: [{ ...scenario, id: 's2', title: '闭店前' }],
  worldbookText: '【世界书】雨城\n灯火不会熄灭。',
  stylePrompt: '留意细小的动作。',
  messages: [message('u1', 'user', '我推开门。'), message('a1', 'assistant', '巡夜人递来热茶。')],
});

describe('魔法茶会共享预算与历史', () => {
  it('保留有无 provider 的默认预算和估算系数', () => {
    expect(resolveMagicTeaPartyTokenBudget(undefined)).toMatchObject({ contextWindowTokens: 32_000, responseReserveTokens: 4096, historyBudgetTokens: 25_904 });
    expect(resolveMagicTeaPartyTokenBudget(undefined, 'openai')).toMatchObject({ contextWindowTokens: 128_000, responseReserveTokens: 10_240, historyBudgetTokens: 115_760 });
    expect(estimateMagicTeaPartyTokens('灯火 abc', 'anthropic')).toBe(Math.round(estimateTokensFromText('灯火 abc') * 1.1));
    expect(estimateMagicTeaPartyTokens('灯火 abc', 'unknown')).toBe(Math.round(estimateTokensFromText('灯火 abc') * 1.2));
  });

  it('保留 8000–48000 分档及 800000 原始总量的严格边界', () => {
    expect([8192, 32768, 65536, 131072, 131073, undefined].map(resolveMagicTeaPartyMessageCharLimit)).toEqual([8000, 16000, 24000, 32000, 48000, 48000]);
    const limited = applyMagicTeaPartyMessageLimits([message('u1', 'user', '😀'.repeat(400_000))], 8000);
    expect(limited.totalChars).toBe(MAGIC_TEA_PARTY_MAX_TOTAL_CHARS);
    expect(limited.clippedMessages[0]).toMatchObject({ id: 'u1', originalLength: 800_000, limit: 8000 });
    expect(limited.messages[0].content.length).toBeLessThanOrEqual(8000);
    expect(isMagicTeaPartyTotalOverflow(limited.totalChars)).toBe(false);
    expect(isMagicTeaPartyTotalOverflow(limited.totalChars + 1)).toBe(true);
  });

  it('保留原 UTF-16 头尾预算，仅在代理对切点后退一个单元', () => {
    const text = `${'a'.repeat(5565)}😀${'中'.repeat(4000)}尾`;
    const clipped = clipMagicTeaPartyMessageContent(text, 8000);
    expect(clipped.text.startsWith(`${'a'.repeat(5565)}\n\n`)).toBe(true);
    expect(/[\uD800-\uDFFF]/u.test(clipped.text)).toBe(false);
    expect(clipped.text).toContain('已省略中段 1617 字');
    expect(clipped.text.endsWith(`${'中'.repeat(2385)}尾`)).toBe(true);
    expect(clipped.originalLength).toBe(9568);
    expect(clipped.omittedLength).toBe(1617);
    expect(clipMagicTeaPartyMessageContent('😀', 2)).toEqual({ text: '😀', clipped: false, originalLength: 2, keptLength: 2, omittedLength: 0 });
  });

  it('过滤已替代、notice、失败 assistant，保留原 user 与空正文规则', () => {
    const messages: MagicTeaPartyMessage[] = [
      message('user', 'user', '继续'),
      { ...message('superseded', 'assistant', '旧版'), meta: { superseded: true } },
      { ...message('notice', 'assistant', '提示'), meta: { noticeSuppressed: true } },
      { ...message('blocked', 'assistant', '阻断'), status: 'blocked' },
      { ...message('error', 'assistant', '失败'), status: 'error' },
      message('system', 'system', '指令'),
      message('empty', 'assistant', ''),
      message('done', 'assistant', '递来热茶'),
    ];
    expect(buildMagicTeaPartyHistory(messages).map((item) => item.id)).toEqual(['user', 'empty', 'done']);
    expect(buildMagicTeaPartyHistory(messages, { includeEmptyContent: false, extraFilter: (item) => item.id !== 'done' })).toEqual([{ id: 'user', role: 'user', content: '继续' }]);
  });

  it('预算从后向前选择，超长中段不排除可容纳的更早消息', () => {
    const history = buildMagicTeaPartyHistory([message('first', 'user', '甲'), message('long', 'assistant', '中'.repeat(1000)), message('last', 'assistant', '乙')]);
    const budget = estimateMagicTeaPartyHistoryTokens([history[0], history[2]], { providerId: 'openai', userDisplayName: '旅人' });
    expect(trimMagicTeaPartyHistory(history, { maxMessages: 3, tokenBudget: budget, providerId: 'openai', userDisplayName: '旅人' }).map((item) => item.id)).toEqual(['first', 'last']);
    expect(trimMagicTeaPartyHistory(history, { maxMessages: 3, tokenBudget: 0, minKeep: 2 })).toEqual(history.slice(-2));
    expect(trimMagicTeaPartyHistory(history, { maxMessages: 1, tokenBudget: budget })).toEqual([history[2]]);
    const withInstruction = appendMagicTeaPartySystemInstruction(history, 'continue', 'continue-1');
    expect(withInstruction.at(-1)).toEqual({ id: 'continue-1', role: 'system', content: '【任务】请在不等待玩家新输入的情况下，继续推进下一小节剧情。' });
    expect(history).toHaveLength(3);
  });
});

describe('魔法茶会真实 Prompt 组合', () => {
  it('将卡片、世界书和历史保留在资料消息，稳定规则只出现一次', () => {
    const input = promptInput();
    const messages = buildMagicTeaPartyMainPromptMessages(input);
    expect(messages.systemPrompt).toContain('【设定忠实性与公正推演】');
    expect(messages.systemPrompt).toContain('确实不可调和时以主情景为准');
    expect(messages.systemPrompt).toContain('不得代替该角色发言或做决定');
    for (const text of ['守望街区的人', '灯火不会熄灭', '我推开门。', '旧桥重逢', '两人在旧桥相识', '巡夜人']) {
      expect(messages.prompt).toContain(text);
      expect(messages.systemPrompt).not.toContain(text);
    }
    expect(messages.systemPrompt.split('【内容边界】')).toHaveLength(2);
    expect(buildMagicTeaPartyMainPrompt(input)).toBe(`${messages.systemPrompt}\n\n${messages.prompt}`);
    const choices = buildMagicTeaPartyChoicesPromptMessages(input);
    expect(choices.systemPrompt).toContain('当前为选项阶段');
    expect(choices.systemPrompt).not.toContain('当前为叙事阶段');
    expect(choices.systemPrompt).toContain('- summary：off');
    expect(choices.systemPrompt).toContain('- updates：off');
    expect(choices.systemPrompt).not.toContain('【更新草案】');
    expect(choices.systemPrompt).toContain('仅生成“下一步玩家可选行动”');
    expect(choices.prompt).not.toContain('请基于以上信息继续剧情。');
    expect(choices.prompt).toContain('我推开门。');
  });

  it('摘要和更新只记录已发生的变化，合并输出也保留相同事实边界', () => {
    const input = promptInput();
    const prompts = [
      buildMagicTeaPartyUpdatePrompt({ ...input, writeArenaHistory: true, writeCurrentState: true }),
      buildMagicTeaPartySummarizePrompt({ messages: input.messages }),
      buildMagicTeaPartyMainPrompt({ ...input, session: { ...input.session, settings: {
        ...input.session.settings, outputPlan: { choices: 'on', summary: 'on', updates: 'on' },
        enableSummary: true, writeArenaHistory: true, writeCurrentState: true,
      } } }),
    ];
    for (const prompt of prompts) {
      expect(prompt).toContain('【事实记录边界】');
      expect(prompt).toContain('不把猜测或修辞当成事实');
      expect(prompt).toContain('弱点、代价或永久能力');
      expect(prompt).toContain('不能用情景中尚未实现的要求替代事件证据');
    }
  });

  it('摘要与更新的资料不进入system，旧字符串视图与分层消息保持一致', () => {
    const input = promptInput();
    const updateInput = { ...input, summary: input.session.summary, writeArenaHistory: true, writeCurrentState: true };
    const update = buildMagicTeaPartyUpdatePromptMessages(updateInput);
    const summaryInput = { messages: input.messages, userDisplayName: '旅人' };
    const summary = buildMagicTeaPartySummarizePromptMessages(summaryInput);
    expect(buildMagicTeaPartyUpdatePrompt(updateInput)).toBe(`${update.systemPrompt}\n\n${update.prompt}`);
    expect(buildMagicTeaPartySummarizePrompt(summaryInput)).toBe(`${summary.systemPrompt}\n\n${summary.prompt}`);
    for (const split of [update, summary]) {
      expect(split.systemPrompt).toContain('【事实记录边界】');
      expect(split.systemPrompt).not.toContain('我推开门。');
      expect(split.prompt).toContain('我推开门。');
    }
    for (const text of ['守望街区的人', '湿透的斗篷', '雨夜茶馆', '两人在旧桥相识']) {
      expect(update.systemPrompt).not.toContain(text);
      expect(update.prompt).toContain(text);
    }
  });

  it('组合非空角色、问卷、历战、状态、影子草案、情景、世界书及历史', () => {
    const prompt = buildMagicTeaPartyMainPrompt(promptInput());
    for (const text of ['雨夜茶馆', '闭店前', '灯火不会熄灭', '留意细小的动作', '守望街区的人', 'Q: 为何守望？', 'A: 为了朋友。', '旧桥重逢', '开始信任旅人', '湿透的斗篷', '持灯 (boolean): 是', '已换上干衣', '约定同行', '两人在旧桥相识', '旅人: 我推开门。', 'assistant: 巡夜人递来热茶。', '玩家正在扮演角色：巡夜人', '一共 4 条']) {
      expect(prompt).toContain(text);
    }
    for (const text of ['role-signature', 'scenario-signature', 'scenario-meta', '"isPreset"']) expect(prompt).not.toContain(text);
    expect(buildRoleProfileText(role)).not.toContain('旧桥重逢');
    expect(buildRoleProfileText(role)).not.toContain('湿透的斗篷');
  });

  it('预设保留 Arena 风格、世界书和默认情景', () => {
    const preset = getMagicTeaPartyPreset(' arena-daily ');
    expect(preset?.defaultSettings).toEqual({ outputFormat: 'jsonl', enableChoices: true, choiceCount: 4 });
    expect(preset?.systemPrompt).toContain('温暖');
    expect(preset?.defaultScenario.content.length).toBeGreaterThan(0);
    expect(buildWorldbookText(preset?.worldbook)).toContain('【世界书】');
    expect(getMagicTeaPartyPreset('unknown')).toBeNull();
  });

  it('角色历战仍先选相关参与者再按 id 降序，空字段不产生正文', () => {
    const historyRole = {
      ...role,
      card: { ...role.card, arena_history: { entries: [
        { id: 3, title: '较新无关事件', participants: ['别人'], winner: '不适用', impact: '留守', metadata: {} },
        { id: 1, title: '较早重逢', participants: ['旅人'], winner: '不适用', impact: '相识', metadata: {} },
        { id: 2, title: '最近重逢', participants: ['旅人'], winner: '不适用', impact: '信任', metadata: {} },
      ] } },
    };
    const prompt = buildRoleProfileText(historyRole, { readArenaHistory: true, historyReadLimit: 2, otherParticipantNames: ['旅人'] });
    expect(prompt.indexOf('最近重逢')).toBeLessThan(prompt.indexOf('较早重逢'));
    expect(prompt).not.toContain('较新无关事件');
    expect(buildWorldbookText(null)).toBe('');
    expect(buildMagicTeaPartyJsonlPreview('')).toBe('');
  });

  it('保留 Prompt 内独立的历史及摘要截断', () => {
    const input = promptInput();
    input.session.summary = `${'摘'.repeat(10_000)}摘要尾`;
    input.messages = [message('u', 'user', `${'用'.repeat(8000)}用户尾`), message('a', 'assistant', `${'助'.repeat(12_000)}助手尾`), message('s', 'system', `${'系'.repeat(4000)}系统尾`)];
    const prompt = buildMagicTeaPartyMainPrompt(input);
    for (const [label, text, count] of [['旅人', '用', 8000], ['assistant', '助', 12_000], ['system', '系', 4000]] as const) {
      expect(prompt).toContain(`${label}: ${text.repeat(count)}...[已截断]`);
    }
    expect(prompt).toContain(`${'摘'.repeat(10_000)}...[已截断]`);
    for (const text of ['摘要尾', '用户尾', '助手尾', '系统尾']) expect(prompt).not.toContain(text);
  });

  it('choices、updates、summary 和 title 仍使用完整原阶段规则', () => {
    const input = promptInput();
    expect(buildMagicTeaPartyChoicesPrompt({ ...input, choiceCount: 99 })).toContain('items 默认 16 条');
    expect(buildMagicTeaPartyChoicesPrompt({ ...input, choiceCount: 0 })).toContain('items 默认 2 条');
    const updates = buildMagicTeaPartyUpdatePrompt({ ...input, summary: input.session.summary, lastChoices: [{ id: 'c1', text: '接过热茶' }], userDisplayName: '旅人', writeArenaHistory: true, writeCurrentState: true });
    for (const text of ['【角色列表】', 'roleId=r1', '湿透的斗篷', '【最近选项列表】', '- c1: 接过热茶', '【会话摘要】', '两人在旧桥相识', '旅人: 我推开门。', '请严格输出 JSON。']) expect(updates).toContain(text);
    expect(buildMagicTeaPartySummarizePrompt({ messages: input.messages, userDisplayName: '旅人' })).toContain('禁忌/边界：...');
    const title = buildMagicTeaPartySummarizePrompt({ messages: input.messages, mode: 'title' });
    expect(title).toContain('仅输出 1 行纯文本标题');
    expect(title).not.toContain('世界状态：...');
  });
});

describe('魔法茶会共享 JSONL 与预览', () => {
  const body = '{"type":"narration","text":"灯火😀"}';
  const dialogue = '{"type":"dialogue","speakerId":"r1","speakerName":"巡夜人","text":"请进"}';
  const choices = '{"type":"choices","items":["坐下",{"id":"leave","label":"离开"}]}';
  const notice = '{"type":"notice","level":"warning","code":"tea","message":"茶水很烫"}';
  const summary = '{"type":"summary","text":"初次来访","sections":{"世界状态":"雨夜"}}';
  const updates = '{"type":"updates","drafts":[{"character":"巡夜人","current_state_summary":"忙碌","meta":{"sessionId":"old"}}],"meta":{"sessionId":"tea"}}';
  const input = [body, dialogue, choices, notice, summary, updates].join('\n');

  it('任意 UTF-16 chunk 边界及尾行 flush 与整段解析一致', () => {
    const state = createMagicTeaPartyJsonlStreamState();
    for (let index = 0; index < input.length; index += 1) ingestMagicTeaPartyJsonlChunk(state, input.slice(index, index + 1));
    expect(state.updates).toBeNull();
    flushMagicTeaPartyJsonlStream(state);
    expect(state).toMatchObject(parseMagicTeaPartyJsonl(input));
    expect(state.buffer).toBe('');
    expect(state.choices).toEqual([{ id: 'c1', text: '坐下' }, { id: 'leave', text: '离开' }]);
    expect(state.summary).toEqual({ text: '初次来访', sections: { 世界状态: '雨夜' } });
    expect(state.updates).toEqual([{ characterName: '巡夜人', currentStateSummary: '忙碌', meta: { sessionId: 'tea' } }]);
    expect(state.updatesMeta).toEqual({ sessionId: 'tea' });
    expect(state.notices).toEqual([{ type: 'notice', level: 'warning', code: 'tea', message: '茶水很烫' }]);
  });

  it('保留 JSON 修复、choices 别名、notice 拼写兼容与非 JSON 正文', () => {
    const parsed = parseMagicTeaPartyJsonl("{type:'narration',text:'灯火'}\n{\"type\":\"options\",\"items\":{\"stay\":\"留下\"}}\nmotice level=warning message=小心台阶\n普通正文");
    expect(parsed.segments).toEqual([{ type: 'narration', text: '灯火' }, { type: 'choices', items: [{ id: 'stay', text: '留下' }] }, { type: 'narration', text: '普通正文' }]);
    expect(parsed.notices[0]).toMatchObject({ level: 'warning', message: '小心台阶' });
    expect(parseMagicTeaPartyJsonl('summary text=损坏摘要').notices[0]).toMatchObject({ code: 'jsonl_side_channel_parse_error', meta: { stage: 'summary' } });
    expect(mapMagicTeaPartyUpdateDraftCompat({ name: ' 巡夜人 ', current_state_summary: ' 忙碌 ', hasWinner: false })).toEqual({ characterName: '巡夜人', currentStateSummary: '忙碌', hasWinner: false });
  });

  it('侧信道抽取保留正文原行，预览显示正文与 choices', () => {
    const extracted = extractMagicTeaPartySideChannelsFromJsonl(input);
    expect(extracted.cleanedText).toBe([body, dialogue, choices].join('\n'));
    expect(extracted.summary?.text).toBe('初次来访');
    expect(extracted.updates?.[0].currentStateSummary).toBe('忙碌');
    expect(extracted.notices).toHaveLength(1);
    expect(buildMagicTeaPartyJsonlPreview(input)).toBe('灯火😀\n巡夜人: 请进\n- 坐下\n- 离开');
    expect(extractMagicTeaPartyNoticesFromJsonl(`${body}\n${notice}`)).toEqual({ cleanedText: body, notices: extracted.notices });
  });

  it('流预览 notice 只发新增部分，回退快照重置 JSONL 状态', () => {
    const seen: MagicTeaPartyStreamPreviewUpdate[] = [];
    const preview = createMagicTeaPartyStreamPreview({ outputFormat: 'jsonl', onUpdate: (update) => seen.push(update) });
    preview.applySafeText(`${body}\n${notice}\n`, 'streaming');
    expect(seen.at(-1)).toMatchObject({ content: '灯火😀', notices: [{ message: '茶水很烫' }], status: 'streaming', includeJsonl: true });
    preview.applySafeText(`${body}\n${notice}\n${dialogue}\n`, 'done');
    expect(seen.at(-1)?.notices).toEqual([]);
    preview.applySafeText(`${dialogue}\n${notice}\n`, 'done');
    expect(seen.at(-1)?.segments).toEqual([{ type: 'dialogue', speakerId: 'r1', speakerName: '巡夜人', text: '请进' }]);
    expect(seen.at(-1)?.notices).toHaveLength(1);
  });

  it('Markdown notice 原文保留，流预览同样去重新增通知', () => {
    const markdown = `灯火\n\n\`\`\`mtp_notice\n${notice}\n\`\`\``;
    const bundle = extractMagicTeaPartyNoticesFromMarkdown(markdown);
    expect(bundle.cleanedText).toBe(markdown);
    expect(bundle.notices[0]?.message).toBe('茶水很烫');
    const seen: MagicTeaPartyStreamPreviewUpdate[] = [];
    const preview = createMagicTeaPartyStreamPreview({ outputFormat: 'markdown', onUpdate: (update) => seen.push(update) });
    preview.applySafeText(markdown);
    preview.applySafeText(`${markdown}\n巡夜人请你坐下。`, 'done');
    expect(seen[0].notices).toHaveLength(1);
    expect(seen[1]).toMatchObject({ includeJsonl: false, notices: [], status: 'done' });
    preview.applySafeText(`另一段\n${notice}\n`);
    expect(seen[2].notices).toHaveLength(1);
  });
});

describe('Tea shared positional history and Unicode cuts', () => {
  // This is the former Web algorithm, kept as an independent golden rather than delegating to the selector.
  const formerTrim = (history: ReturnType<typeof buildMagicTeaPartyHistory>, maxMessages: number, tokenBudget: number, minKeep = 1) => {
    const count = Number.isFinite(maxMessages) ? Math.max(1, Math.floor(maxMessages)) : history.length;
    const minimum = Number.isFinite(minKeep) ? Math.max(1, Math.floor(minKeep)) : 1;
    const tail = history.slice(-count); const budget = Number.isFinite(tokenBudget) ? Math.max(0, Math.floor(tokenBudget)) : 0;
    if (budget <= 0 || tail.length <= minimum) return tail.slice(-minimum);
    const result: typeof tail = []; let used = 0;
    for (let i = tail.length - 1; i >= 0; --i) {
      const row = tail[i]; const cost = estimateMagicTeaPartyTokens(`${row.role === 'user' ? '旅人' : row.role}: ${row.content}`, 'openai');
      if (result.length < minimum || used + cost <= budget) { result.push(row); used += cost; }
    }
    return result.reverse();
  };
  it('matches former Web positions, greedy skipped gaps, minKeep and clip ordering exactly', () => {
    const history = buildMagicTeaPartyHistory([message('same', 'user', 'a'.repeat(15000)), message('same', 'assistant', 'b'),
      message('z', 'user', '长'.repeat(17000)), message('q', 'assistant', 'emoji😀'), message('end', 'user', 'end')]);
    for (const maxMessages of [1, 2, 3, 6, Infinity, NaN]) for (const tokenBudget of [0, 1, 4, 100, 90000, Infinity]) for (const minKeep of [1, 2, 5]) {
      const actual = trimMagicTeaPartyHistory(history, { maxMessages, tokenBudget, minKeep, providerId: 'openai', userDisplayName: '旅人' });
      const expected = formerTrim(history, maxMessages, tokenBudget, minKeep);
      expect(actual).toEqual(expected);
      expect(applyMagicTeaPartyMessageLimits(actual, 8000)).toEqual(applyMagicTeaPartyMessageLimits(expected, 8000));
    }
  });
  it('keeps UTF16 budgets while backing away from paired boundaries, without repairing existing lone units', () => {
    const source = '😀'.repeat(16000);
    const result = clipMagicTeaPartyMessageContent(source, 8000);
    expect(/[\uD800-\uDFFF]/u.test(result.text)).toBe(false);
    expect(result.text.length).toBeLessThanOrEqual(8000);
    expect(source.length).toBe(32000);
    expect(clipMagicTeaPartyMessageContent('a\ud800b', 8000).text).toBe('a\ud800b');
    expect(clipMagicTeaPartyMessageContent('中文', 8000).text).toBe('中文');
  });
  it('keeps card current/history and summary prompt boundaries as complete pairs', () => {
    const input = promptInput();
    input.session.summary = `${'s'.repeat(9999)}😀tail`;
    input.roles[0] = { ...input.roles[0], card: { ...input.roles[0].card, current_state: { summary: `${'a'.repeat(3999)}😀tail` }, arena_history: { entries: [{ impact: `${'x'.repeat(7999)}😀tail`, title: 'boundary' }] } } };
    const prompt = buildMagicTeaPartyMainPrompt(input);
    expect(/[\uD800-\uDFFF]/u.test(prompt)).toBe(false);
    expect(input.session.summary).toContain('😀tail');
  });
});
