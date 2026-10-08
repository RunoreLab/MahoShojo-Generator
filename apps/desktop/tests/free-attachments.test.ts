import { describe, expect, it } from 'vitest';
import { FREE_GENERATION_ATTACHMENT_LIMITS } from '@mahoshojo/ai-core/reference-attachments';
import { readFreeAttachmentFiles, toPromptAttachments, type FreeAttachmentState } from '../src/features/free/attachments';

const file = (name: string, content: string, type = 'text/plain'): File =>
  new File([content], name, { type });

const limits = FREE_GENERATION_ATTACHMENT_LIMITS;

describe('free attachments reading (D5.1-G2)', () => {
  it('读取文本并保留元数据；空文件跳过预算', async () => {
    const { added, skipped } = await readFreeAttachmentFiles(
      [file('a.txt', 'alpha'), file('b.md', 'beta')],
      [],
    );
    expect(skipped).toBe(0);
    expect(added).toHaveLength(2);
    expect(added[0]).toMatchObject({ name: 'a.txt', type: 'text/plain', content: 'alpha', includedBytes: 5 });
    expect(added[0]!.truncated).toBeUndefined();
  });

  it('单文件字符上限截断并标记 truncated', async () => {
    const big = 'x'.repeat(limits.maxCharsPerFile + 100);
    const { added } = await readFreeAttachmentFiles([file('big.txt', big)], []);
    expect(added[0]!.content).toHaveLength(limits.maxCharsPerFile);
    expect(added[0]!.truncated).toBe(true);
  });

  it('总量字符预算跨文件与存量共享，耗尽后跳过剩余文件', async () => {
    const existing: FreeAttachmentState[] = [{
      id: 'e1', name: 'old.txt', type: 'text/plain', size: 10,
      includedBytes: limits.maxCharsTotal - 10, content: 'y'.repeat(limits.maxCharsTotal - 10),
    }];
    const { added, skipped } = await readFreeAttachmentFiles(
      [file('n1.txt', '0123456789ABCDEF'), file('n2.txt', 'z')],
      existing,
    );
    expect(added).toHaveLength(1);
    expect(added[0]!.content).toHaveLength(10);
    expect(added[0]!.truncated).toBe(true);
    expect(skipped).toBe(1);
  });

  it('投影到请求体只留 wire 字段', () => {
    const items = toPromptAttachments([{
      id: 'x', name: 'n', type: 'text/plain', size: 3, includedBytes: 3, content: 'abc', truncated: true,
    }]);
    expect(items).toEqual([{ name: 'n', type: 'text/plain', size: 3, content: 'abc', truncated: true }]);
    expect(items[0]).not.toHaveProperty('id');
    expect(items[0]).not.toHaveProperty('includedBytes');
  });
});
