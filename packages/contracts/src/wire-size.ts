import { z } from 'zod';

import { ArenaContractError } from './errors';

export type RawWireInput = string | Uint8Array | ArrayBuffer;

const rawWireBytes = (input: RawWireInput): Uint8Array => {
  if (typeof input === 'string') return new TextEncoder().encode(input);
  if (input instanceof Uint8Array) return input;
  return new Uint8Array(input);
};

/** Counts the bytes present on the wire, before JSON decoding or normalization. */
export const rawUtf8ByteLength = (input: RawWireInput): number => rawWireBytes(input).byteLength;

/** Decodes a raw JSON frame after the caller has applied its raw byte ceiling. */
export const decodeRawJson = (input: RawWireInput): unknown => {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(rawWireBytes(input));
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof ArenaContractError) throw error;
    throw new ArenaContractError('invalid-message', 'invalid JSON wire frame', undefined, error);
  }
};

export const utf8ByteLength = (value: string): number => new TextEncoder().encode(value).byteLength;

export const jsonUtf8ByteLength = (input: unknown): number => {
  try {
    const serialized = JSON.stringify(input);
    return typeof serialized === 'string' ? utf8ByteLength(serialized) : Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};

export const utf8ByteLimitedStringSchema = (maxBytes: number) =>
  z.string().superRefine((value, context) => {
    if (utf8ByteLength(value) > maxBytes) {
      context.addIssue({ code: 'too_big', maximum: maxBytes, origin: 'string', inclusive: true, message: `must not exceed ${maxBytes} UTF-8 bytes` });
    }
  });
