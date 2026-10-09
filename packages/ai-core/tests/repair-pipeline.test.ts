import { describe, expect, it } from 'vitest';
import { z } from 'zod/v3';
import { repairNormalizeValidate } from '../src/repair-pipeline';

const schema = z.object({ title: z.string(), values: z.array(z.number()) });
describe('shared legacy repair pipeline', () => {
  it('preserves loose JSON, wrapper, promotion and schema coercion semantics', async () => {
    expect(await repairNormalizeValidate({
      input: "```json\n{payload:{nested:{title:'雨城'},values:7,},}\n```",
      schema, coerce: { wrapSingleToArray: true },
    })).toEqual({ title: '雨城', values: [7] });
  });
  it('preserves text-wrapper unwrapping, explicit promotion and post-processing order', async () => {
    expect(await repairNormalizeValidate({
      input: { content: '{"article":{"heading":"雨城"},"values":[1]}' },
      schema, promoteRules: { 'article.heading': 'title' },
      postProcess: value => ({ ...value, title: `${value.title}续篇` }), as: 'string',
    })).toBe('{"title":"雨城续篇","values":[1]}');
  });
  it('keeps validation failures observable to callers', async () => {
    await expect(repairNormalizeValidate({ input: '{}', schema })).rejects.toThrow(
      'Schema validation failed: title: Required; values: Required',
    );
  });
});
