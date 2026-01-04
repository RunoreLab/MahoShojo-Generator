import { describe, expect, test } from 'bun:test';

import { getDecodedPathParamAfterSegment } from '@/lib/url';

describe('getDecodedPathParamAfterSegment', () => {
  test('能解析并 decode encodeURIComponent 过的 tag id（包含冒号）', () => {
    const id = getDecodedPathParamAfterSegment('http://localhost/api/admin/tags/risk%3Acode-kill', 'tags');
    expect(id).toBe('risk:code-kill');
  });

  test('未编码时保持原样', () => {
    const id = getDecodedPathParamAfterSegment('http://localhost/api/admin/tags/style:drama', 'tags');
    expect(id).toBe('style:drama');
  });

  test('找不到 segment 或缺少参数时返回 null', () => {
    expect(getDecodedPathParamAfterSegment('http://localhost/api/admin/tags', 'tags')).toBeNull();
    expect(getDecodedPathParamAfterSegment('http://localhost/api/admin/xxx/risk%3Acode-kill', 'tags')).toBeNull();
  });

  test('解码后包含斜杠时返回 null（避免 %2F 产生歧义）', () => {
    expect(getDecodedPathParamAfterSegment('http://localhost/api/admin/tags/a%2Fb', 'tags')).toBeNull();
  });

  test('非法百分号编码时返回 null', () => {
    expect(getDecodedPathParamAfterSegment('http://localhost/api/admin/tags/%E0%A4%A', 'tags')).toBeNull();
  });
});

