import { describe, expect, it } from 'vitest';

import { buildArenaGenerationPrompt } from '../src/arena-generation/prompt';

describe('Arena generation prompt', () => {
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
});
