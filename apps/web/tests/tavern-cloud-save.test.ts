import { describe, expect, it } from 'vitest';

import { getUtf8ByteLength, MAX_DATA_CARD_BYTES } from '@/lib/data-card-size';
import { buildTavernCloudSavePayload, estimateDataCardBytesAfterAuthorInjection } from '@/lib/tavern-card';

describe('tavern-cloud-save', () => {
  const author = { id: 42, username: 'tester' };

  it('能按服务端注入规则预估写入大小', () => {
    const base = { name: '测试角色', content: 'hello' };
    const bytes = estimateDataCardBytesAfterAuthorInjection(base, author);
    expect(bytes).not.toBeNull();
    const manual = getUtf8ByteLength(JSON.stringify({ ...base, _author: author.username, _authorId: author.id }));
    expect(bytes).toBe(manual);
  });

  it('保存到云端时会强制移除 _tavern.raw', () => {
    const input = {
      name: '测试角色',
      content: 'hi',
      _tavern: { raw: { foo: 'bar' }, meta: { name: '测试角色' } },
    };

    const result = buildTavernCloudSavePayload(input, author, 'standard');
    if ('error' in result) {
      throw new Error(result.error);
    }

    const out = result.data as any;
    expect(out?._tavern?.raw).toBeUndefined();
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('超限时能通过 light/minimal 降级到 300KB 内', () => {
    const big = '很长的文本。'.repeat(80_000);
    const input = {
      name: '超长角色',
      content: big,
      mesExample: big,
      description: big,
      scenario: big,
      _tavern: {
        raw: { payload: big },
        meta: {
          name: '超长角色',
          description: big,
          scenario: big,
          mesExample: big,
        },
      },
    };

    const standard = buildTavernCloudSavePayload(input, author, 'standard');
    if ('error' in standard) throw new Error(standard.error);
    expect(standard.overLimit).toBe(true);

    const light = buildTavernCloudSavePayload(input, author, 'light');
    if ('error' in light) throw new Error(light.error);
    expect(light.estimatedBytes).toBeLessThanOrEqual(MAX_DATA_CARD_BYTES);

    const minimal = buildTavernCloudSavePayload(input, author, 'minimal');
    if ('error' in minimal) throw new Error(minimal.error);
    expect(minimal.estimatedBytes).toBeLessThanOrEqual(MAX_DATA_CARD_BYTES);

    const lightOut = light.data as any;
    expect(typeof lightOut?.content).toBe('string');
    expect((lightOut.content as string).length).toBeLessThanOrEqual(20_000 + 16);

    const minimalOut = minimal.data as any;
    expect(minimalOut?.mesExample).toBe('');
    expect(minimalOut?._tavern?.meta?.description).toBeUndefined();
    expect(minimalOut?._tavern?.meta?.mesExample).toBeUndefined();
  });
});

