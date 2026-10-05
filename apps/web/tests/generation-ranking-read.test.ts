import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  buildPublicGenerationRankingSnapshot,
  getGenerationRankingCacheControl,
  parseGenerationRankingResponse,
  requireGenerationRankingResponse,
} from '@/lib/arena/generation-ranking';

describe('generation ranking 纯读取边界', () => {
  test('公共 snapshot 只暴露状态与参战者数量', () => {
    const snapshot = buildPublicGenerationRankingSnapshot({
      status: 'completed',
      combatantCount: 2,
      userId: 42,
      ipAnonymized: 'secret-ip',
      userGuidancePreview: 'secret-guidance',
      extraJson: '{"secret":true}',
    });

    expect(snapshot).toEqual({ status: 'completed', combatantCount: 2 });
    expect(JSON.stringify(snapshot)).not.toContain('userId');
    expect(JSON.stringify(snapshot)).not.toContain('ipAnonymized');
    expect(JSON.stringify(snapshot)).not.toContain('userGuidancePreview');
    expect(JSON.stringify(snapshot)).not.toContain('extraJson');
  });

  test('按响应状态选择缓存策略', () => {
    expect(getGenerationRankingCacheControl({ success: true, state: 'pending' })).toBe('no-store');
    expect(getGenerationRankingCacheControl({ success: true, state: 'ready' })).toBe(
      'public, max-age=0, s-maxage=3600',
    );
    expect(getGenerationRankingCacheControl({ success: false })).toBe('public, max-age=0, s-maxage=60');
  });

  test('安全解析 ready ranking 且保留空 participants 数组', () => {
    const response = {
      success: true,
      generationId: 'generation-1234',
      state: 'ready',
      snapshot: { status: 'completed', combatantCount: 5 },
      participants: [],
    };

    expect(parseGenerationRankingResponse(response)).toEqual(response);
  });

  test('拒绝 Redis Lua 损坏的 participants 对象', () => {
    const corrupted = {
      success: true,
      generationId: 'generation-1234',
      state: 'ready',
      snapshot: { status: 'completed', combatantCount: 5 },
      participants: {},
    };

    expect(parseGenerationRankingResponse(corrupted)).toBeNull();
    expect(() => requireGenerationRankingResponse(corrupted))
      .toThrow('ARENA_GENERATION_RANKING_RESPONSE_INVALID');
  });

  test('所有响应分支都拒绝空白 generationId', () => {
    expect(parseGenerationRankingResponse({
      success: false,
      generationId: '   ',
      error: 'bad payload',
    })).toBeNull();
  });

  test('拒绝不满足 CombatantList 访问约定的 nested queues', () => {
    expect(parseGenerationRankingResponse({
      success: true,
      generationId: 'generation-1234',
      state: 'ready',
      snapshot: { status: 'completed', combatantCount: 2 },
      participants: [{
        displayName: '魔法少女 A',
        entityType: 'data_card',
        entityId: 'card-a',
        entityKey: 'data_card:card-a',
        dataCardId: 'card-a',
        presetId: null,
        techScore: 100,
        techLevel: 'A',
        queues: {
          strict: { eligible: true, eventStatus: 'applied' },
          free: { eligible: false, eventStatus: 'missing' },
        },
      }],
    })).toBeNull();
  });

  test('GET handler 不得导入或调用排位结算', () => {
    const source = readFileSync(
      join(process.cwd(), 'app/api/arena/generation-ranking/handler.ts'),
      'utf8',
    );

    expect(source).not.toContain('settleArenaRatingsForGeneration');
  });
});
