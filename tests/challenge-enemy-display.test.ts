import { beforeEach, describe, expect, test } from 'bun:test';

import '@/tests/helpers/fake-indexeddb';

import { __resetAiSessionDbForTest } from '@/lib/ai-session/storage';
import { AI_SESSION_DB_NAME } from '@/lib/ai-session/types';
import type { EnemySnapshotV1 } from '@/lib/challenge/types';
import {
  clearPublicCardMemoryCacheForTest,
  writePublicCardCacheFromSidecar,
} from '@/lib/public-card-cache/shared-loader';
import { GENERAL_CHARACTER_TEMPLATE_ID } from '@/lib/schemas/general-character';

const baseEnemySnapshot: EnemySnapshotV1 = {
  version: 1,
  sourceType: 'preset',
  sourceId: 'M02_white_rose.json',
  displayName: '雪绒',
  strengthTier: 'common',
  combatProfile: {
    powerLevel: 'leaf',
    derived: {
      HP: 90,
      Radiance: 50,
    },
  },
  tags: ['common', 'tempo'],
  promptSummary: '擅长高速游走与试探。',
};

describe('challenge enemy display', () => {
  beforeEach(async () => {
    clearPublicCardMemoryCacheForTest();
    await __resetAiSessionDbForTest();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(AI_SESSION_DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error('deleteDatabase failed'));
      request.onblocked = () => resolve();
    });
  });

  test('preset 原卡存在时返回结构化模板展示', async () => {
    const { resolveChallengeEnemyDisplay } = await import('@/lib/challenge/enemy-display');

    const result = await resolveChallengeEnemyDisplay({
      enemySnapshot: baseEnemySnapshot,
      fetchPublicCardById: async () => null,
    });

    expect(result.status).toBe('resolved');
    expect(result.template).toBe('magical-girl');
    expect(result.card).toBeTruthy();
    expect(result.sourceMeta.isFallback).toBe(false);
    expect(result.sourceMeta.sourceType).toBe('preset');
  });

  test('public-card 原卡存在时返回结构化模板展示', async () => {
    const { resolveChallengeEnemyDisplay } = await import('@/lib/challenge/enemy-display');

    const result = await resolveChallengeEnemyDisplay({
      enemySnapshot: {
        ...baseEnemySnapshot,
        sourceType: 'public-card',
        sourceId: 'card-public-1',
      },
      fetchPublicCardById: async () => ({
        id: 'card-public-1',
        data: JSON.stringify({
          templateId: GENERAL_CHARACTER_TEMPLATE_ID,
          name: '公开卡敌人',
          content: '这是一张公开通用角色卡。',
        }),
      }),
    });

    expect(result.status).toBe('resolved');
    expect(result.template).toBe('general');
    expect(result.sourceMeta.isFallback).toBe(false);
    expect((result.card as { name?: string } | null)?.name).toBe('公开卡敌人');
  });

  test('resolvedSourceCardLite 存在时会优先复用 sidecar，不再二次 fetch public card', async () => {
    const { resolveChallengeEnemyDisplay } = await import('@/lib/challenge/enemy-display');

    const result = await resolveChallengeEnemyDisplay({
      enemySnapshot: {
        ...baseEnemySnapshot,
        sourceType: 'public-card',
        sourceId: 'card-sidecar-1',
      },
      resolvedSourceCardLite: {
        id: 'card-sidecar-1',
        name: '侧载敌人',
        data: JSON.stringify({
          templateId: GENERAL_CHARACTER_TEMPLATE_ID,
          name: '侧载敌人',
          content: '这是一张通过 sidecar 直接复用的通用角色卡。',
        }),
        updatedAt: '2026-04-05T12:00:00.000Z',
      },
      fetchPublicCardById: async () => {
        throw new Error('should not fetch');
      },
    });

    expect(result.status).toBe('resolved');
    expect(result.template).toBe('general');
    expect(result.sourceMeta.isFallback).toBe(false);
    expect((result.card as { name?: string } | null)?.name).toBe('侧载敌人');
  });

  test('没有 resolvedSourceCardLite 但共享缓存已有卡时，会复用共享缓存而不是网络 fetch', async () => {
    const { fetchChallengePublicCardById } = await import('@/components/challenge/hooks/useChallengeController');
    const { resolveChallengeEnemyDisplay } = await import('@/lib/challenge/enemy-display');

    await writePublicCardCacheFromSidecar({
      id: 'card-shared-cache-1',
      name: '共享缓存敌人',
      data: JSON.stringify({
        templateId: GENERAL_CHARACTER_TEMPLATE_ID,
        name: '共享缓存敌人',
        content: '这是一张来自共享缓存的通用角色卡。',
      }),
      updatedAt: '2026-04-05T12:00:00.000Z',
    });
    clearPublicCardMemoryCacheForTest();

    let networkFetchCount = 0;
    const result = await resolveChallengeEnemyDisplay({
      enemySnapshot: {
        ...baseEnemySnapshot,
        sourceType: 'public-card',
        sourceId: 'card-shared-cache-1',
      },
      fetchPublicCardById: (id) =>
        fetchChallengePublicCardById(id, {
          fetcher: async () => {
            networkFetchCount += 1;
            return new Response(
              JSON.stringify({
                success: true,
                card: {
                  id: 'card-shared-cache-1',
                  name: '不应再命中的网络卡',
                  data: JSON.stringify({
                    templateId: GENERAL_CHARACTER_TEMPLATE_ID,
                    name: '不应再命中的网络卡',
                    content: '这条内容不应被读取。',
                  }),
                },
              }),
              {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              },
            );
          },
        }),
    });

    expect(result.status).toBe('resolved');
    expect(result.template).toBe('general');
    expect(result.sourceMeta.isFallback).toBe(false);
    expect((result.card as { name?: string } | null)?.name).toBe('共享缓存敌人');
    expect(networkFetchCount).toBe(0);
  });

  test('season-entity 补查成功时复用原卡模板', async () => {
    const { resolveChallengeEnemyDisplay } = await import('@/lib/challenge/enemy-display');

    const result = await resolveChallengeEnemyDisplay({
      enemySnapshot: {
        ...baseEnemySnapshot,
        sourceType: 'season-entity',
        sourceId: 'season:s1:card-1',
      },
      fetchPublicCardById: async (id) =>
        id === 'card-1'
          ? {
              id: 'card-1',
              data: JSON.stringify({
                templateId: GENERAL_CHARACTER_TEMPLATE_ID,
                name: '赛季公开卡敌人',
                content: '赛季实体成功回查公开卡。',
              }),
            }
          : null,
    });

    expect(result.status).toBe('resolved');
    expect(result.template).toBe('general');
    expect(result.sourceMeta.isFallback).toBe(false);
    expect((result.card as { name?: string } | null)?.name).toBe('赛季公开卡敌人');
  });

  test('season-entity 补查失败时回退为通用角色卡快照', async () => {
    const { resolveChallengeEnemyDisplay } = await import('@/lib/challenge/enemy-display');

    const result = await resolveChallengeEnemyDisplay({
      enemySnapshot: {
        ...baseEnemySnapshot,
        sourceType: 'season-entity',
        sourceId: 'season-card-missing',
      },
      fetchPublicCardById: async () => null,
    });

    expect(result.status).toBe('fallback');
    expect(result.template).toBe('general');
    expect(result.sourceMeta.isFallback).toBe(true);
    expect((result.card as { templateId?: string } | null)?.templateId).toBe(GENERAL_CHARACTER_TEMPLATE_ID);

    const content = (result.card as { content?: string } | null)?.content ?? '';
    expect(content).toContain('擅长高速游走与试探。');
    expect(content).toContain('common');
    expect(content).toContain('tempo');
    expect(content).toContain('powerLevel');
    expect(content).toContain('该卡为挑战快照，不代表完整原始数据卡');
  });

  test('未知模板时回退为通用角色卡快照', async () => {
    const { resolveChallengeEnemyDisplay } = await import('@/lib/challenge/enemy-display');

    const result = await resolveChallengeEnemyDisplay({
      enemySnapshot: {
        ...baseEnemySnapshot,
        sourceType: 'public-card',
        sourceId: 'card-unknown-template',
      },
      fetchPublicCardById: async () => ({
        id: 'card-unknown-template',
        data: JSON.stringify({
          title: '无法识别模板的对象',
          body: '这不是现有角色模板。',
        }),
      }),
    });

    expect(result.status).toBe('fallback');
    expect(result.template).toBe('general');
    expect(result.sourceMeta.isFallback).toBe(true);
    const content = (result.card as { content?: string } | null)?.content ?? '';
    expect(content).toContain('powerLevel');
    expect(content).toContain('该卡为挑战快照，不代表完整原始数据卡');
  });

  test('精简魔法少女卡会回退为通用角色卡快照，避免渲染期缺字段崩溃', async () => {
    const { resolveChallengeEnemyDisplay } = await import('@/lib/challenge/enemy-display');

    const result = await resolveChallengeEnemyDisplay({
      enemySnapshot: {
        ...baseEnemySnapshot,
        sourceType: 'public-card',
        sourceId: 'card-minimal-magical-girl',
      },
      fetchPublicCardById: async () => ({
        id: 'card-minimal-magical-girl',
        data: JSON.stringify({
          codename: '星辉',
        }),
      }),
    });

    expect(result.status).toBe('fallback');
    expect(result.template).toBe('general');
    expect(result.sourceMeta.isFallback).toBe(true);
  });
});
