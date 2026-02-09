import { describe, expect, test } from 'bun:test';

import {
  buildModelScopeErrorPayload,
  extractModelScopeOutputImages,
  extractModelScopeTaskId,
  extractModelScopeTaskStatus,
  normalizeModelScopeToken,
  parseModelScopeJsonSafe,
} from '@/lib/tachie/modelscope/error';

describe('modelscope error helpers', () => {
  test('normalize token strips bearer prefix', () => {
    expect(normalizeModelScopeToken('Bearer abc123')).toBe('abc123');
    expect(normalizeModelScopeToken('  bearer   xyz789  ')).toBe('xyz789');
    expect(normalizeModelScopeToken('token_only')).toBe('token_only');
  });

  test('parse upstream auth payload and build details', () => {
    const upstream = parseModelScopeJsonSafe(
      '{"errors":{"message":"Authentication failed, please make sure that a valid ModelScope token is supplied."},"request_id":"abc-request-id"}',
    );
    const payload = buildModelScopeErrorPayload({ status: 401, payload: upstream });

    expect(payload.error).toBe('ModelScope 鉴权失败：Token 无效、已过期，或格式不正确（HTTP 401）');
    expect(payload.message).toBe('Authentication failed, please make sure that a valid ModelScope token is supplied.');
    expect(payload.details).toContain('request id: abc-request-id');
  });

  test('extract task fields from nested payload', () => {
    const upstream = parseModelScopeJsonSafe(
      '{"data":{"task_id":"task-123","task_status":"running","output_images":["https://a.png","https://a.png","https://b.png"]}}',
    );

    expect(extractModelScopeTaskId(upstream)).toBe('task-123');
    expect(extractModelScopeTaskStatus(upstream)).toBe('RUNNING');
    expect(extractModelScopeOutputImages(upstream)).toEqual(['https://a.png', 'https://b.png']);
  });
});
