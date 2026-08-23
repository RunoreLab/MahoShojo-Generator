import { z } from 'zod/v3';

import {
  DEFAULT_STRUCTURED_JSON_LIMITS,
  StructuredJsonParseError,
  parseStructuredJsonWithSchema,
} from '../src/structured-json';

describe('structured JSON safety boundary', () => {
  it('rejects oversized model output before repair', () => {
    const schema = z.object({ text: z.string() });
    const raw = JSON.stringify({ text: 'x'.repeat(64) });

    expect(() => parseStructuredJsonWithSchema(raw, schema, {
      limits: { maxInputChars: 16 },
    })).toThrowError(StructuredJsonParseError);

    try {
      parseStructuredJsonWithSchema(raw, schema, { limits: { maxInputChars: 16 } });
    } catch (error) {
      expect((error as StructuredJsonParseError).code).toBe('input-too-large');
      expect((error as Error).message).not.toContain('xxxxxxxx');
    }
    expect(DEFAULT_STRUCTURED_JSON_LIMITS.maxInputChars).toBeGreaterThan(0);
  });

  it.each(['__proto__', 'prototype', 'constructor'])('rejects dangerous nested key %s', (dangerousKey) => {
    const schema = z.object({ payload: z.record(z.unknown()) });
    const raw = `{"payload":{"safe":1,"${dangerousKey}":{"polluted":true}}}`;

    try {
      parseStructuredJsonWithSchema(raw, schema);
      throw new Error('expected unsafe key rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(StructuredJsonParseError);
      expect((error as StructuredJsonParseError).code).toBe('unsafe-key');
      expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    }
  });

  it('rejects output beyond configured nesting and node limits', () => {
    const schema = z.unknown();
    expect(() => parseStructuredJsonWithSchema('{"a":{"b":{"c":1}}}', schema, {
      limits: { maxNestingDepth: 2 },
    })).toThrowError(StructuredJsonParseError);
    expect(() => parseStructuredJsonWithSchema('{"a":1,"b":2,"c":3}', schema, {
      limits: { maxNodes: 3 },
    })).toThrowError(StructuredJsonParseError);
  });
});
