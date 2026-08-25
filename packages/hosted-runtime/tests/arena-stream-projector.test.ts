import { describe, expect, it } from 'vitest';

import { createArenaStreamProjector } from '../src/arena-generation/stream-projector';

describe('Arena stream projector', () => {
  it('跨 chunk 隐藏尾部 meta 并返回兼容 meta event', () => {
    const projector = createArenaStreamProjector({ expectsMeta: true });
    const markdown = [
      ...projector.push('正文内容\n<!-- MAHOSHOJO_ARE'),
      ...projector.push('NA_META {"version":1,"report":{"winner":"A"}} -->'),
      ...projector.finish().markdown,
    ].join('');
    const result = projector.result();

    expect(markdown).toBe('正文内容\n');
    expect(result.metaEvent).toEqual({
      type: 'meta',
      data: {
        parseOk: true,
        meta: { version: 1, report: { winner: 'A' } },
        raw: '<!-- MAHOSHOJO_ARENA_META {"version":1,"report":{"winner":"A"}} -->',
        rawTruncated: false,
      },
    });
  });

  it('未要求 meta 时不会吞掉普通 markdown', () => {
    const projector = createArenaStreamProjector({ expectsMeta: false });
    const chunks = [
      ...projector.push('A'.repeat(400)),
      ...projector.finish().markdown,
    ];

    expect(chunks.join('')).toBe('A'.repeat(400));
    expect(projector.result().metaEvent).toBeNull();
  });

  it('要求 meta 但收到 malformed JSON 时显式 meta_error 且不泄漏隐藏块', () => {
    const projector = createArenaStreamProjector({ expectsMeta: true });
    const chunks = [
      ...projector.push('正文<!-- MAHOSHOJO_ARENA_META {bad} -->'),
      ...projector.finish().markdown,
    ];

    expect(chunks.join('')).toBe('正文');
    expect(projector.result().metaEvent).toMatchObject({
      type: 'meta_error',
      data: { parseOk: false },
    });
  });
});
