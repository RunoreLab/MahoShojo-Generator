import { describe, expect, test } from 'bun:test';

import {
  buildLibLibErrorPayload,
  extractLibLibCode,
  extractLibLibMessage,
  inferLibLibHttpStatus,
  parseLibLibJsonSafe,
} from '@/lib/tachie/liblib/error';

describe('liblib error helpers', () => {
  test('parse auth error payload', () => {
    const upstream = parseLibLibJsonSafe('{"code":401,"data":null,"msg":"签名验证失败"}');
    expect(extractLibLibCode(upstream)).toBe(401);
    expect(extractLibLibMessage(upstream)).toBe('签名验证失败');
    expect(inferLibLibHttpStatus(extractLibLibCode(upstream), 400)).toBe(401);
  });

  test('build error payload includes details', () => {
    const upstream = parseLibLibJsonSafe('{"code":401,"data":null,"msg":"签名验证失败"}');
    const payload = buildLibLibErrorPayload({ status: 401, payload: upstream, requestIdHeader: 'liblib-req-1' });
    expect(payload.error).toBe('LibLib 鉴权失败：Access Key / Secret Key 不匹配，或签名已失效（HTTP 401）');
    expect(payload.message).toBe('签名验证失败');
    expect(payload.details).toContain('code: 401');
    expect(payload.details).toContain('request id: liblib-req-1');
  });
});
