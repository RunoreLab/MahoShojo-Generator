import { describe, expect, it } from 'bun:test';
import { z } from 'zod/v3';
import {
  buildStructuredJsonInstructionFromZodSchema,
  parseStructuredJsonWithSchema,
} from '@/lib/ai/utils/structured-json';

describe('structured-json', () => {
  it('parses direct JSON', () => {
    const schema = z.object({ a: z.number() });
    const result = parseStructuredJsonWithSchema('{"a":1}', schema);
    expect(result.data).toEqual({ a: 1 });
  });

  it('extracts JSON from surrounding text', () => {
    const schema = z.object({ a: z.number() });
    const text = `好的，以下是结果：\n{"a": 1}\n谢谢`;
    const result = parseStructuredJsonWithSchema(text, schema);
    expect(result.data).toEqual({ a: 1 });
  });

  it('parses object body without outer braces', () => {
    const schema = z.object({ a: z.number(), b: z.string() });
    const text = '"a": 1,\n"b": "ok"';
    const result = parseStructuredJsonWithSchema(text, schema);
    expect(result.data).toEqual({ a: 1, b: 'ok' });
  });

  it('repairs common JSON issues (code fence + trailing comma)', () => {
    const schema = z.object({ a: z.number() });
    const text = '```json\n{"a": 1,}\n```';
    const result = parseStructuredJsonWithSchema(text, schema);
    expect(result.data).toEqual({ a: 1 });
    expect(result.telemetry.usedJsonRepair).toBe(true);
  });

  it('normalizes Chinese quotes and Python-ish literals', () => {
    const schema = z.object({ ok: z.boolean(), reason: z.string().nullable() });
    const text = '{\n  “ok”: True,\n  “reason”: None\n}';
    const result = parseStructuredJsonWithSchema(text, schema);
    expect(result.data).toEqual({ ok: true, reason: null });
  });

  it('repairs truncated root JSON tail after partially closed nested objects', () => {
    const schema = z.object({
      codename: z.string(),
      analysis: z.object({ background: z.string() }),
    });
    const text =
      '```json\n' +
      '{"codename":"雪绒","magicConstruct":{},"wonderlandRule":{},"blooming":{},"analysis":{"background":"千日红在竞技场';
    const result = parseStructuredJsonWithSchema(text, schema);
    expect(result.data.codename).toBe('雪绒');
    expect(result.data.analysis.background).toContain('千日红');
    expect(result.telemetry.usedJsonRepair).toBe(true);
  });

  it('chooses the first candidate that passes schema validation', () => {
    const schema = z.object({ a: z.number() });
    const text = '{"wrong": 1}\n{"a": 2}';
    const result = parseStructuredJsonWithSchema(text, schema);
    expect(result.data).toEqual({ a: 2 });
  });

  it('unwraps common wrappers when the root does not match schema', () => {
    const schema = z.object({ a: z.number() });
    const text = '{"data": {"a": 1}}';
    const result = parseStructuredJsonWithSchema(text, schema);
    expect(result.data).toEqual({ a: 1 });
    expect(result.telemetry.unwrapAttempt.attempted).toBe(true);
    expect(result.telemetry.unwrapAttempt.succeeded).toBe(true);
  });

  it('unwraps unknown single-key wrappers', () => {
    const schema = z.object({ a: z.number() });
    const text = '{"mouhuang": {"a": 1}}';
    const result = parseStructuredJsonWithSchema(text, schema);
    expect(result.data).toEqual({ a: 1 });
    expect(result.telemetry.unwrapAttempt.attempted).toBe(true);
    expect(result.telemetry.unwrapAttempt.succeeded).toBe(true);
  });

  it('unwraps unknown wrappers even when extra keys exist', () => {
    const schema = z.object({ a: z.number() });
    const text = '{"note": "x", "mouhuang": {"a": 1}}';
    const result = parseStructuredJsonWithSchema(text, schema);
    expect(result.data).toEqual({ a: 1 });
    expect(result.telemetry.unwrapAttempt.attempted).toBe(true);
    expect(result.telemetry.unwrapAttempt.succeeded).toBe(true);
  });

  it('normalizes snake_case keys to match schema', () => {
    const schema = z.object({ magicConstruct: z.object({ powerLevel: z.string() }) });
    const text = '{"magic_construct": {"power_level": "S"}}';
    const result = parseStructuredJsonWithSchema(text, schema);
    expect(result.data).toEqual({ magicConstruct: { powerLevel: 'S' } });
    expect(result.telemetry.keyNormalization.attempted).toBe(true);
    expect(result.telemetry.keyNormalization.succeeded).toBe(true);
  });

  it('canonicalizes common key variants (codeName -> codename)', () => {
    const schema = z.object({ codename: z.string() });
    const text = '{"codeName": "X"}';
    const result = parseStructuredJsonWithSchema(text, schema);
    expect(result.data).toEqual({ codename: 'X' });
    expect(result.telemetry.keyNormalization.attempted).toBe(true);
    expect(result.telemetry.keyNormalization.succeeded).toBe(true);
  });

  it('builds a compact schema guide with optional markers', () => {
    const schema = z.object({
      a: z.string(),
      b: z.number().optional(),
      c: z.object({ d: z.boolean().optional() }),
    });
    const guide = buildStructuredJsonInstructionFromZodSchema(schema);
    expect(guide).toContain('a: string');
    expect(guide).toContain('b?: number');
    expect(guide).toContain('d?: boolean');
  });
});
