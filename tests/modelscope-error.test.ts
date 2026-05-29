import { describe, expect, test } from 'vitest';

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

  test('recognizes alibaba account binding requirement', () => {
    const upstream = parseModelScopeJsonSafe(
      '{"errors":{"message":"Please bind your Alibaba Cloud account before use."},"request_id":"bind-request-id"}',
    );
    const payload = buildModelScopeErrorPayload({ status: 401, payload: upstream });

    expect(payload.error).toBe('ModelScope 鉴权失败：请先绑定阿里云账号后再使用（HTTP 401）');
    expect(payload.message).toBe('Please bind your Alibaba Cloud account before use.');
    expect(payload.details).toContain('request id: bind-request-id');
  });

  test('recognizes aliyun real-name verification requirement', () => {
    const upstream = parseModelScopeJsonSafe(
      '{"errors":{"message":"To use API-Inference,please make sure your associated Aliyun account is real name verified. You can do so at your account setting page https://www.modelscope.cn/my/accountsettings."},"request_id":"realname-request-id"}',
    );
    const payload = buildModelScopeErrorPayload({ status: 403, payload: upstream });

    expect(payload.error).toBe('ModelScope 权限不足：请先完成阿里云账号实名认证（HTTP 403）');
    expect(payload.message).toContain('associated Aliyun account is real name verified');
    expect(payload.details).toContain('request id: realname-request-id');
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
