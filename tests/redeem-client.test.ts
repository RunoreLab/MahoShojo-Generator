import { describe, expect, mock, test } from 'bun:test';

import { buildRedeemCodeRequestInit, submitRedeemCode } from '@/lib/client/redeem-code';

describe('redeem client request compatibility', () => {
  test('缺少 legacy bearer 时仍应使用会话 cookie 发起兑换请求', async () => {
    const fetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('/api/redeem-code');
      expect(init?.method).toBe('POST');
      expect(init?.credentials).toBe('include');

      const headers = new Headers(init?.headers);
      expect(headers.get('Content-Type')).toBe('application/json');
      expect(headers.get('Authorization')).toBeNull();
      expect(init?.body).toBe(JSON.stringify({ code: 'A3F8-E9C2-1D4B' }));

      return new Response(JSON.stringify({ success: true, slotCount: 3 }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    });

    const { data } = await submitRedeemCode({
      code: '  A3F8-E9C2-1D4B  ',
      authHeader: null,
      fetchImpl: fetchMock as typeof fetch,
    });

    expect(data.success).toBeTrue();
    expect(data.slotCount).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('存在兼容 bearer 时仍应透传 Authorization 头', () => {
    const init = buildRedeemCodeRequestInit('ABCD-EFGH-IJKL', 'Bearer legacy-auth-key');
    const headers = new Headers(init.headers);

    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(headers.get('Authorization')).toBe('Bearer legacy-auth-key');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ code: 'ABCD-EFGH-IJKL' }));
  });
});
