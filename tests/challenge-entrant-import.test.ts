import { describe, expect, test } from 'bun:test';

describe('challenge entrant import', () => {
  test('会清掉 BattleDataModal transport meta 并保留来源信息', async () => {
    const { createChallengeEntrantFromSelection } = await import('@/lib/challenge/entrant-import');

    const result = createChallengeEntrantFromSelection({
      codename: '雾灯',
      _cardId: 'card-1',
      _cardName: '雾灯',
      _cardDescription: '中距离压制',
      _isPublic: 1,
      _author: 'tester',
    });

    expect(result.card).toEqual({ codename: '雾灯' });
    expect(result.sourceMeta).toEqual({
      dataCardId: 'card-1',
      dataCardName: '雾灯',
      dataCardAuthor: 'tester',
      isPublic: true,
    });
    expect(result.sourceMode).toBe('database');
    expect(result.editorText).toContain('雾灯');
  });

  test('随机匹配会调用 /api/random-public-card?type=character 并复用公开数据卡映射', async () => {
    const { fetchRandomCharacterCard } = await import('@/lib/challenge/entrant-import');

    let requestedUrl = '';
    const result = await fetchRandomCharacterCard(async (input) => {
      requestedUrl = typeof input === 'string' ? input : input.toString();
      return new Response(
        JSON.stringify({
          success: true,
          card: {
            id: 'public-card-1',
            name: '夜纱',
            description: '诱导与诡计',
            username: 'arena-user',
            is_public: 1,
            data: JSON.stringify({
              codename: '夜纱',
            }),
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });

    expect(requestedUrl).toContain('/api/random-public-card?type=character');
    expect(result.sourceMode).toBe('random');
    expect(result.sourceMeta).toEqual({
      dataCardId: 'public-card-1',
      dataCardName: '夜纱',
      dataCardAuthor: 'arena-user',
      isPublic: true,
    });
    expect(result.card).toEqual({ codename: '夜纱' });
    expect(result.editorText).toContain('夜纱');
  });

  test('数组输入会被拒绝，因为 challenge 当前只支持单卡', async () => {
    const { parseSingleCharacterCardFromText } = await import('@/lib/challenge/entrant-import');

    await expect(parseSingleCharacterCardFromText('[{"codename":"A"},{"codename":"B"}]')).rejects.toThrow(
      'challenge 当前只支持单卡入场'
    );
  });

  test('多对象拼接和 JSONL 输入都会按多卡报错', async () => {
    const { parseSingleCharacterCardFromText } = await import('@/lib/challenge/entrant-import');

    await expect(parseSingleCharacterCardFromText('{"codename":"A"}{"codename":"B"}')).rejects.toThrow(
      'challenge 当前只支持单卡入场'
    );
    await expect(parseSingleCharacterCardFromText('{"codename":"A"}\n{"codename":"B"}')).rejects.toThrow(
      'challenge 当前只支持单卡入场'
    );
  });

  test('stringifyCharacterCardForEditor 会输出稳定、可读的 JSON', async () => {
    const { stringifyCharacterCardForEditor } = await import('@/lib/challenge/entrant-import');

    expect(
      stringifyCharacterCardForEditor({
        codename: '雾灯',
        analysis: {
          coreTraits: ['冷静', '谨慎'],
        },
      })
    ).toBe('{\n  "codename": "雾灯",\n  "analysis": {\n    "coreTraits": [\n      "冷静",\n      "谨慎"\n    ]\n  }\n}');
  });
});
