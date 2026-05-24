import { describe, expect, it } from 'bun:test';

import { parseAIProvidersFromEnv } from '@/lib/config';

describe('config ai provider parsing', () => {
  it('仅在显式 allowAnonymous 时保留匿名 OpenAI provider', () => {
    const providers = parseAIProvidersFromEnv({
      AI_PROVIDERS_CONFIG: JSON.stringify([
        {
          name: 'opencode_zen_free',
          apiKey: '',
          allowAnonymous: true,
          baseUrl: 'https://opencode.ai/zen/v1',
          model: 'big-pickle',
          type: 'openai',
        },
        {
          name: 'anonymous_google',
          apiKey: '',
          allowAnonymous: true,
          baseUrl: 'https://example.com/v1',
          model: 'gemini-2.5-flash',
          type: 'google',
        },
        {
          name: 'missing_key_openai',
          apiKey: '',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          type: 'openai',
        },
      ]),
    } as NodeJS.ProcessEnv);

    expect(providers).toHaveLength(1);
    expect(providers[0]).toEqual({
      name: 'opencode_zen_free',
      apiKey: '',
      allowAnonymous: true,
      baseUrl: 'https://opencode.ai/zen/v1',
      model: 'big-pickle',
      type: 'openai',
      retryCount: 1,
      skipProbability: 0,
    });
  });
});
