import { describe, expect, test } from 'vitest';

import {
  encodeGenerationSseEvent,
  parseGenerationSseBlock,
  resolveResumeCursor,
} from '../src/arena-generation/sse';

describe('Arena resumable SSE contract', () => {
  test('encodes a stable cursor and parses multiline data', () => {
    const encoded = new TextDecoder().decode(encodeGenerationSseEvent({
      id: '1724570000000-0',
      type: 'markdown',
      data: { chunk: '第一行\n第二行' },
    }));

    expect(encoded).toContain('id: 1724570000000-0\n');
    expect(encoded).toContain('event: markdown\n');
    expect(parseGenerationSseBlock(encoded.trimEnd())).toEqual({
      id: '1724570000000-0',
      event: 'markdown',
      data: JSON.stringify({ chunk: '第一行\n第二行' }),
    });
  });

  test('heartbeat comments never produce a replay event', () => {
    expect(parseGenerationSseBlock(': keepalive\n')).toBeNull();
  });

  test('rejects ambiguous Last-Event-ID and after cursors', () => {
    const request = new Request(
      'https://example.test/api/arena/generations/generation-1/stream?after=2-0',
      { headers: { 'Last-Event-ID': '1-0' } },
    );

    expect(() => resolveResumeCursor(request)).toThrowError('RESUME_CURSOR_CONFLICT');
  });

  test('accepts one matching or single resume cursor', () => {
    expect(resolveResumeCursor(new Request(
      'https://example.test/api/arena/generations/generation-1/stream?after=2-0',
    ))).toBe('2-0');
    expect(resolveResumeCursor(new Request(
      'https://example.test/api/arena/generations/generation-1/stream?after=2-0',
      { headers: { 'Last-Event-ID': '2-0' } },
    ))).toBe('2-0');
  });
});

