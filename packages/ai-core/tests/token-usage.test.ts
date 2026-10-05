import { describe, expect, it } from 'vitest';
import { normalizeUsage, getVisibleOutputTokens } from '../src/token-usage';

describe('token usage presentation', () => {
  it('separates legacy inclusive completion tokens without changing the raw total', () => {
    const usage = normalizeUsage({ prompt_tokens: 13967, completion_tokens: 11568,
      completion_tokens_details: { reasoning_tokens: 8273 } });
    expect(getVisibleOutputTokens(usage)).toBe(3295);
    expect(usage?.completionTokens).toBe(11568);
  });
  it('prefers SDK v6 text detail and preserves native Google candidate counts', () => {
    expect(getVisibleOutputTokens(normalizeUsage({ outputTokens: 11568,
      outputTokenDetails: { textTokens: 3295, reasoningTokens: 8273 } }))).toBe(3295);
    const native = normalizeUsage({ candidatesTokenCount: 3295, thoughtsTokenCount: 8273 });
    expect(native).toMatchObject({ textTokens: 3295, reasoningTokens: 8273, completionTokens: 11568 });
    expect(getVisibleOutputTokens(native)).toBe(3295);
    expect(getVisibleOutputTokens({ completionTokens: 3295, reasoningTokens: 8273,
      completionTokensIncludesReasoning: false })).toBe(3295);
  });
  it('does not invent zero reasoning or clamp inconsistent usage into a plausible result', () => {
    expect(getVisibleOutputTokens({ completionTokens: 100 })).toBeUndefined();
    expect(getVisibleOutputTokens({ completionTokens: 100, reasoningTokens: 0 })).toBe(100);
    expect(getVisibleOutputTokens({ completionTokens: 100, reasoningTokens: 101 })).toBeUndefined();
    expect(getVisibleOutputTokens({ textTokens: -1 })).toBeUndefined();
  });
});
