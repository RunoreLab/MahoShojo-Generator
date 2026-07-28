import { describe, expect, it } from 'vitest';
import { classifyOutcome, classifySuccess } from '@/lib/ai/availability/classify-outcome';

describe('classify-outcome', () => {
  describe('classifySuccess', () => {
    it('返回 success outcome', () => {
      expect(classifySuccess()).toEqual({ outcome: 'success' });
    });
  });

  describe('classifyOutcome - 无错误', () => {
    it('无错误时返回 success', () => {
      expect(classifyOutcome(true)).toEqual({ outcome: 'success' });
      expect(classifyOutcome(false)).toEqual({ outcome: 'success' });
    });
  });

  describe('系统渠道 (isSystemChannel=true)', () => {
    it('余额不足 → failure/billing', () => {
      const error = new Error('insufficient quota');
      expect(classifyOutcome(true, error)).toEqual({ outcome: 'failure', errorClass: 'billing' });
    });

    it('quota exceeded → failure/billing', () => {
      const error = new Error('quota exceeded for this model');
      expect(classifyOutcome(true, error)).toEqual({ outcome: 'failure', errorClass: 'billing' });
    });

    it('401 → failure/auth', () => {
      const error = Object.assign(new Error('Unauthorized'), { statusCode: 401 });
      expect(classifyOutcome(true, error)).toEqual({ outcome: 'failure', errorClass: 'auth' });
    });

    it('403 → failure/auth', () => {
      const error = Object.assign(new Error('Forbidden'), { statusCode: 403 });
      expect(classifyOutcome(true, error)).toEqual({ outcome: 'failure', errorClass: 'auth' });
    });

    it('invalid API key → failure/auth', () => {
      const error = new Error('invalid api key provided');
      expect(classifyOutcome(true, error)).toEqual({ outcome: 'failure', errorClass: 'auth' });
    });

    it('429 → failure/rate_limit', () => {
      const error = Object.assign(new Error('Too many requests'), { statusCode: 429 });
      expect(classifyOutcome(true, error)).toEqual({ outcome: 'failure', errorClass: 'rate_limit' });
    });

    it('timeout → failure/timeout', () => {
      const error = Object.assign(new Error('Request timed out'), { name: 'StreamReadTimeoutError' });
      expect(classifyOutcome(true, error)).toEqual({ outcome: 'failure', errorClass: 'timeout' });
    });

    it('网络错误 → failure/network', () => {
      const error = new Error('failed to fetch');
      expect(classifyOutcome(true, error)).toEqual({ outcome: 'failure', errorClass: 'network' });
    });

    it('500 → failure/server_error', () => {
      const error = Object.assign(new Error('Internal Server Error'), { statusCode: 500 });
      expect(classifyOutcome(true, error)).toEqual({ outcome: 'failure', errorClass: 'server_error' });
    });

    it('502 → failure/server_error', () => {
      const error = Object.assign(new Error('Bad Gateway'), { statusCode: 502 });
      expect(classifyOutcome(true, error)).toEqual({ outcome: 'failure', errorClass: 'server_error' });
    });

    it('模型不存在 → failure/model_not_found', () => {
      const error = new Error('model not found: xyz');
      expect(classifyOutcome(true, error)).toEqual({ outcome: 'failure', errorClass: 'model_not_found' });
    });

    it('AI_APICallError → failure/api_call_error', () => {
      const error = Object.assign(new Error('API call failed'), { name: 'AI_APICallError' });
      expect(classifyOutcome(true, error)).toEqual({ outcome: 'failure', errorClass: 'api_call_error' });
    });

    it('503 模型暂时不可用（属性 statusCode）→ failure/server_error', () => {
      const error = Object.assign(
        new Error('状态码=503，当前模型[鹿鹿10]gemini-3.1-pro-preview暂时不可用'),
        { name: 'AI_APICallError', statusCode: 503 },
      );
      expect(classifyOutcome(true, error)).toEqual({ outcome: 'failure', errorClass: 'server_error' });
    });

    it('enhance 后仅消息含 HTTP 503 → failure/server_error', () => {
      // 模拟 enhanceErrorWithUpstreamMessage 曾丢失 statusCode 的形态
      const error = new Error(
        'AI_APICallError: 状态码=503，当前模型[鹿鹿10]gemini-3.1-pro-preview暂时不可用（HTTP 503）',
      );
      expect(classifyOutcome(true, error)).toEqual({ outcome: 'failure', errorClass: 'server_error' });
    });

    it('turnstile 限流 → excluded/local_rate_limit', () => {
      const error = new Error('turnstile verification failed');
      expect(classifyOutcome(true, error)).toEqual({ outcome: 'excluded', errorClass: 'local_rate_limit' });
    });

    it('冷却 → excluded/local_rate_limit', () => {
      const error = new Error('冷却中，请稍后重试');
      expect(classifyOutcome(true, error)).toEqual({ outcome: 'excluded', errorClass: 'local_rate_limit' });
    });

    it('用户取消 → excluded/user_cancel', () => {
      const error = Object.assign(new Error('Aborted'), { name: 'AbortError' });
      expect(classifyOutcome(true, error)).toEqual({ outcome: 'excluded', errorClass: 'user_cancel' });
    });

    it('JSON 解析失败 → excluded/local_parse', () => {
      const error = new Error('json parse error in response');
      expect(classifyOutcome(true, error)).toEqual({ outcome: 'excluded', errorClass: 'local_parse' });
    });

    it('校验失败 → excluded/local_validation', () => {
      const error = new Error('schema validation failed');
      expect(classifyOutcome(true, error)).toEqual({ outcome: 'excluded', errorClass: 'local_validation' });
    });

    it('未知错误 → failure/unknown (系统渠道兜底)', () => {
      const error = new Error('something weird happened');
      expect(classifyOutcome(true, error)).toEqual({ outcome: 'failure', errorClass: 'unknown' });
    });
  });

  describe('自定义渠道 (isSystemChannel=false)', () => {
    it('超时 → failure/timeout', () => {
      const error = Object.assign(new Error('timeout'), { name: 'StreamReadTimeoutError' });
      expect(classifyOutcome(false, error)).toEqual({ outcome: 'failure', errorClass: 'timeout' });
    });

    it('网络错误 → failure/network', () => {
      const error = new Error('ECONNRESET');
      expect(classifyOutcome(false, error)).toEqual({ outcome: 'failure', errorClass: 'network' });
    });

    it('500 → failure/server_error', () => {
      const error = Object.assign(new Error('Server Error'), { statusCode: 500 });
      expect(classifyOutcome(false, error)).toEqual({ outcome: 'failure', errorClass: 'server_error' });
    });

    it('模型不支持 → failure/model_not_found', () => {
      const error = new Error('model is not supported');
      expect(classifyOutcome(false, error)).toEqual({ outcome: 'failure', errorClass: 'model_not_found' });
    });

    it('429 无个人配额关键词 → failure/rate_limit', () => {
      const error = Object.assign(new Error('rate limit exceeded'), { statusCode: 429 });
      expect(classifyOutcome(false, error)).toEqual({ outcome: 'failure', errorClass: 'rate_limit' });
    });

    it('429 含 quota 关键词 → excluded/billing (个人额度)', () => {
      const error = Object.assign(new Error('quota exceeded for your key'), { statusCode: 429 });
      expect(classifyOutcome(false, error)).toEqual({ outcome: 'excluded', errorClass: 'billing' });
    });

    it('401 → excluded/auth (个人 Key)', () => {
      const error = Object.assign(new Error('Unauthorized'), { statusCode: 401 });
      expect(classifyOutcome(false, error)).toEqual({ outcome: 'excluded', errorClass: 'auth' });
    });

    it('403 → excluded/auth', () => {
      const error = Object.assign(new Error('Forbidden'), { statusCode: 403 });
      expect(classifyOutcome(false, error)).toEqual({ outcome: 'excluded', errorClass: 'auth' });
    });

    it('余额不足 → excluded/billing', () => {
      const error = new Error('insufficient credits');
      expect(classifyOutcome(false, error)).toEqual({ outcome: 'excluded', errorClass: 'billing' });
    });

    it('用户取消 → excluded/user_cancel', () => {
      const error = Object.assign(new Error('Cancelled'), { name: 'AbortError' });
      expect(classifyOutcome(false, error)).toEqual({ outcome: 'excluded', errorClass: 'user_cancel' });
    });

    it('未知错误 → excluded/unknown (自定义渠道兜底)', () => {
      const error = new Error('something unexpected');
      expect(classifyOutcome(false, error)).toEqual({ outcome: 'excluded', errorClass: 'unknown' });
    });

    // --- 真实用户报告回归：鹿鹿 503 被误 ignored ---

    it('503 模型暂时不可用（原始 AI_APICallError）→ failure/server_error', () => {
      const error = Object.assign(
        new Error('状态码=503，当前模型[鹿鹿10]gemini-3.1-pro-preview暂时不可用，建议先查看模型当前的可用率'),
        { name: 'AI_APICallError', statusCode: 503 },
      );
      expect(classifyOutcome(false, error)).toEqual({ outcome: 'failure', errorClass: 'server_error' });
    });

    it('enhance 后丢失 statusCode/name，仅消息含 状态码=503 → failure/server_error', () => {
      // 修复前：自定义渠道会落到 excluded/unknown，导致 24h 仍显示 100%
      const error = new Error(
        'AI_APICallError: 状态码=503，当前模型[鹿鹿10]gemini-3.1-pro-preview暂时不可用，建议先查看模型当前的可用率。可以参考站内排行榜挑选热门可用模型（HTTP 503）',
      );
      expect(classifyOutcome(false, error)).toEqual({ outcome: 'failure', errorClass: 'server_error' });
    });

    it('enhance 后通过 originalError 回退 statusCode → failure/server_error', () => {
      const original = Object.assign(
        new Error('状态码=503，当前模型暂时不可用'),
        { name: 'AI_APICallError', statusCode: 503 },
      );
      const enhanced = new Error('AI_APICallError: 状态码=503，当前模型暂时不可用（HTTP 503）');
      (enhanced as any).originalError = original;
      expect(classifyOutcome(false, enhanced)).toEqual({ outcome: 'failure', errorClass: 'server_error' });
    });

    it('无 status 但中文「暂时不可用」→ failure/upstream_unavailable', () => {
      const error = new Error('当前模型 gemini-3.1-pro-preview 暂时不可用，请稍后再试');
      expect(classifyOutcome(false, error)).toEqual({ outcome: 'failure', errorClass: 'upstream_unavailable' });
    });

    it('消息前缀 AIAPICallError（无下划线）+ 503 → failure/server_error', () => {
      const error = new Error('失败:AIAPICallError:状态码=503，当前模型暂时不可用');
      expect(classifyOutcome(false, error)).toEqual({ outcome: 'failure', errorClass: 'server_error' });
    });

    it('AI_APICallError 名称（无明确 status）→ failure/api_call_error', () => {
      const error = Object.assign(new Error('upstream rejected the request'), { name: 'AI_APICallError' });
      expect(classifyOutcome(false, error)).toEqual({ outcome: 'failure', errorClass: 'api_call_error' });
    });
  });
});
