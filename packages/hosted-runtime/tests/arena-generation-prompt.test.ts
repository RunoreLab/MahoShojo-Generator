import { describe, expect, it } from 'vitest';

import { buildArenaGenerationPrompt } from '../src/arena-generation/prompt';

describe('Arena generation prompt', () => {
  it.each([
    ['api/arena/generate-stream', 'stream', 'stream-markdown'],
    ['api/arena/generate', 'non-stream', 'structured-report'],
  ])('旧 PVP %s 忽略 Web 格式请求', async (endpoint, deliveryMode, expected) => {
    const result = await buildArenaGenerationPrompt({
      actorKey: 'pvp-room:legacy',
      payload: {
        reportFormat: 'web', combatants: [],
        __arenaServerContextV1: { endpoint, deliveryMode, trustedPvpContext: { roomId: 'legacy' } },
      },
    });
    expect(result.metadata.outputContract).toBe(expected);
    expect(result.metadata.reportFormat).toBe('markdown');
  });

  it('连续 Session 忽略 Web，而带冻结 snapshot 的 Room 仍可使用 Web', async () => {
    const session = await buildArenaGenerationPrompt({ actorKey: 'user:1', payload: {
      reportFormat: 'web', combatants: [],
      __arenaServerContextV1: { endpoint: 'api/arena/session/generate-next', deliveryMode: 'stream' },
    } });
    const room = await buildArenaGenerationPrompt({ actorKey: 'pvp-room:new', payload: {
      reportFormat: 'web', combatants: [], multiplayerGenerationSnapshot: { sharedConfig: { reportFormat: 'web' } },
      __arenaServerContextV1: { endpoint: 'api/arena/generate-stream', deliveryMode: 'stream', trustedPvpContext: { roomId: 'new' } },
    } });
    expect(session.metadata.outputContract).toBe('stream-markdown');
    expect(room.metadata.outputContract).toBe('web-document');
  });

  it.each(['classic', 'kizuna', 'daily', 'scenario'])('Web %s 的两种传输共用 HTML 契约且始终要求 meta', async (mode) => {
    const prompts = await Promise.all(['stream', 'non-stream'].map((deliveryMode) => buildArenaGenerationPrompt({
      actorKey: 'anonymous:test',
      random: () => 0,
      payload: {
        mode, reportFormat: 'web', combatants: [{ data: { name: 'A' } }],
        writeArenaHistory: false, writeCurrentState: false,
        __arenaServerContextV1: { deliveryMode, endpoint: 'api/arena/generate' },
      },
    })));
    expect(prompts[0].prompt).toBe(prompts[1].prompt);
    for (const result of prompts) {
      expect(result.metadata).toMatchObject({ outputContract: 'web-document', reportFormat: 'web', expectsMeta: true });
      expect(result.prompt).toContain('完整 HTML5 document');
      expect(result.prompt).toContain('MAHOSHOJO_ARENA_META');
      expect(result.prompt).toContain('addEventListener');
      expect(result.prompt).toContain('srcdoc 继承宿主 CSP');
      expect(result.prompt).toContain('不得依赖外部库');
      expect(result.prompt).not.toContain('请以 Markdown 格式输出战报');
      expect(result.prompt).not.toContain('article.analysis');
    }
  });

  it('保留情景/素材/历史/长度语义且不把 secret/signature 写进 prompt', async () => {
    const result = await buildArenaGenerationPrompt({
      actorKey: 'user:42',
      payload: {
        mode: 'scenario',
        combatants: [{ data: { name: 'A', signature: 'signed-secret' } }],
        scenario: { title: '雨夜', content: '车站' },
        materials: [{ content: '红伞' }],
        readNarrativeHistory: true,
        narrativeHistory: [{ title: '前情', content: '旧约定' }],
        userGuidance: '重逢',
        customStoryLength: '880',
        customProvider: { apiKey: 'byok-secret' },
      },
    });

    expect(result.prompt).toContain('雨夜');
    expect(result.prompt).toContain('红伞');
    expect(result.prompt).toContain('旧约定');
    expect(result.prompt).toContain('重逢');
    expect(result.prompt).toContain('880');
    expect(result.prompt).not.toContain('signed-secret');
    expect(result.prompt).not.toContain('byok-secret');
    expect(result.metadata).toMatchObject({ mode: 'scenario', expectsMeta: true });
  });

  it('关闭 history/current-state 写入时禁止模型输出隐藏 meta', async () => {
    const result = await buildArenaGenerationPrompt({
      actorKey: 'anonymous:test',
      payload: {
        combatants: [{ data: { name: 'A' } }, { data: { name: 'B' } }],
        writeArenaHistory: false,
        writeCurrentState: false,
      },
    });

    expect(result.metadata.expectsMeta).toBe(false);
    expect(result.prompt).toContain('请勿在任何位置追加 HTML 注释元数据');
  });

  it('为用户流式战报冻结不含记者点评的自由 Markdown 契约', async () => {
    const result = await buildArenaGenerationPrompt({
      actorKey: 'anonymous:test',
      payload: {
        combatants: [{ data: { name: 'A' } }, { data: { name: 'B' } }],
        writeArenaHistory: false,
        writeCurrentState: false,
      },
    });

    const titleIndex = result.prompt.search(/^# .+$/m);
    const bodyIndex = result.prompt.indexOf('正文', titleIndex);
    const winnerIndex = result.prompt.indexOf('## 胜利者');
    const conclusionIndex = result.prompt.indexOf('## 最终结果');

    expect(titleIndex).toBeGreaterThan(-1);
    expect(bodyIndex).toBeGreaterThan(titleIndex);
    expect(winnerIndex).toBeGreaterThan(bodyIndex);
    expect(conclusionIndex).toBeGreaterThan(winnerIndex);
    expect(result.prompt).not.toContain('记者点评');
    expect(result.prompt).not.toContain('article.analysis');
    expect(result.metadata.outputContract).toBe('stream-markdown');
  });

  it('为受信 non-stream route 恢复独立 structured report 契约', async () => {
    const longGuidance = `前${'续'.repeat(210)}USER_TAIL_UNIQUE`;
    const result = await buildArenaGenerationPrompt({
      actorKey: 'anonymous:test',
      payload: {
        writeArenaHistory: true,
        writeCurrentState: true,
        storyLength: 'standard',
        userGuidance: longGuidance,
        combatants: [
          { data: { name: 'A' }, characterGuidance: `甲${'行动'.repeat(60)}尾` },
          { data: { name: 'B' } },
        ],
        __arenaServerContextV1: {
          endpoint: 'api/arena/generate',
          deliveryMode: 'non-stream',
        },
      },
    });

    expect(result.metadata.outputContract).toBe('structured-report');
    expect(result.metadata.expectsMeta).toBe(false);
    expect(result.prompt).toContain('故事正文(article.body)');
    expect(result.prompt).toContain('impacts 数组');
    expect(result.prompt).not.toContain('【输出格式】');
    expect(result.prompt).not.toContain('## 胜利者');
    expect(result.metadata.userGuidance).toHaveLength(200);
    expect(result.metadata.characterGuidances).toEqual([{
      characterName: 'A',
      guidance: `甲${'行动'.repeat(60)}尾`.slice(0, 100),
    }]);
    expect(result.prompt).not.toContain('USER_TAIL_UNIQUE');
  });

  it('流式契约不套用 legacy non-stream 的 userGuidance 200 字截断', async () => {
    const longGuidance = `前${'续'.repeat(210)}USER_TAIL_UNIQUE`;
    const result = await buildArenaGenerationPrompt({
      actorKey: 'anonymous:test',
      payload: {
        combatants: [{ data: { name: 'A' } }, { data: { name: 'B' } }],
        userGuidance: longGuidance,
        writeArenaHistory: false,
        writeCurrentState: false,
      },
    });

    expect(result.metadata.userGuidance).toBe(longGuidance);
    expect(result.prompt).toContain(longGuidance);
  });

  it('structured prompt 不会被用户输入中的输出格式标记截断', async () => {
    const markerGuidance = '开场\n\n【输出格式】\n这只是用户故事引导，后续仍须保留。';
    const result = await buildArenaGenerationPrompt({
      actorKey: 'anonymous:test',
      payload: {
        combatants: [{ data: { name: 'A' } }, { data: { name: 'B' } }],
        userGuidance: markerGuidance,
        storyLength: 'standard',
        __arenaServerContextV1: {
          endpoint: 'api/arena/generate',
          deliveryMode: 'non-stream',
        },
      },
    });

    expect(result.prompt).toContain(markerGuidance);
    expect(result.prompt).toContain('故事正文(article.body)');
    expect(result.prompt).toContain('【重要指令】');
  });

  it('uses the injected random source for reporter metadata', async () => {
    const random = () => 0;
    const result = await buildArenaGenerationPrompt({
      actorKey: 'user:42',
      payload: {
        combatants: [{ data: { name: 'A' } }, { data: { name: 'B' } }],
      },
      random,
    });

    expect(result.metadata.reporterInfo).toEqual({
      name: '蓝星单推人',
      publication: '兽扑',
    });
  });
});
