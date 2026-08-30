import { describe, expect, test } from 'vitest';

import { getUserIdFromActivityHeaders } from '@/lib/auth/activity-token';

describe('activity token authority', () => {
  test('请求携带伪造 token 时不得回退到客户端可伪造的 user-id header', async () => {
    const headers = new Headers({
      'x-mahoshojo-activity-token': 'forged-token',
      'x-mahoshojo-user-id': '382',
    });

    await expect(getUserIdFromActivityHeaders(headers)).resolves.toBeNull();
  });

  test('缺少可信 token 时裸 user-id header 不得建立用户身份', async () => {
    const headers = new Headers({
      'x-mahoshojo-user-id': '382',
    });

    await expect(getUserIdFromActivityHeaders(headers)).resolves.toBeNull();
  });
});
