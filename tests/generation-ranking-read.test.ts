import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  buildPublicGenerationRankingSnapshot,
  getGenerationRankingCacheControl,
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

  test('GET handler 不得导入或调用排位结算', () => {
    const source = readFileSync(
      join(process.cwd(), 'app/api/arena/generation-ranking/handler.ts'),
      'utf8',
    );

    expect(source).not.toContain('settleArenaRatingsForGeneration');
  });
});
