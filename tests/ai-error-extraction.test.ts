import { describe, expect, it } from 'bun:test';

import { enhanceErrorWithUpstreamMessage } from '@/lib/ai/utils/error-extraction';

describe('ai error extraction', () => {
  it('能够从 responseBody(JSON) 提取上游错误信息', () => {
    const error = {
      name: 'AI_APICallError',
      message: 'Provider returned error',
      statusCode: 500,
      responseBody: JSON.stringify({ error: { message: 'Unsupported response_format' } }),
    };

    const enhanced = enhanceErrorWithUpstreamMessage(error);
    expect(enhanced.message).toContain('AI_APICallError:');
    expect(enhanced.message).toContain('Unsupported response_format');
    expect(enhanced.message).toContain('HTTP 500');
  });

  it('能够从 data 提取上游错误信息（兼容部分 provider 形态）', () => {
    const error = {
      name: 'AI_APICallError',
      message: 'Provider returned error',
      statusCode: 400,
      data: { error: { message: 'The model does not exist' } },
    };

    const enhanced = enhanceErrorWithUpstreamMessage(error);
    expect(enhanced.message).toContain('AI_APICallError:');
    expect(enhanced.message).toContain('The model does not exist');
    expect(enhanced.message).toContain('HTTP 400');
  });
});

