import { describe, expect, it } from 'vitest';
import { FREE_GENERATION_ATTACHMENT_LIMITS } from '@mahoshojo/ai-core/reference-attachments';
import {
  acceptAttachmentsWithinBudget,
  readFreeAttachmentFiles,
  toPromptAttachments,
  type FreeAttachmentState,
} from '../src/features/free/attachments';

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

describe('acceptAttachmentsWithinBudget 合并前预算复核（G2-r1）', () => {
  const attachment = (id: string, content: string, bytes = content.length): FreeAttachmentState => ({
    id, name: `${id}.txt`, type: 'text/plain', size: bytes, includedBytes: bytes, content,
  });

  it('存量余量充足时全部接纳', () => {
    const { accepted, dropped } = acceptAttachmentsWithinBudget(
      [attachment('e1', 'old')],
      [attachment('c1', 'a'), attachment('c2', 'b')],
    );
    expect(accepted.map((item) => item.id)).toEqual(['c1', 'c2']);
    expect(dropped).toBe(0);
  });

  it('读取完成后余量缩小：放不下的候选整体丢弃并计数', () => {
    // 读取按「空清单」假设完成；合并时清单已几乎占满——只剩 10 字符/字节余量。
    const existing: FreeAttachmentState[] = [{
      id: 'e1', name: 'old.txt', type: 'text/plain', size: limits.maxBytesTotal - 10,
      includedBytes: limits.maxBytesTotal - 10,
      content: 'y'.repeat(limits.maxCharsTotal - 10),
    }];
    const { accepted, dropped } = acceptAttachmentsWithinBudget(existing, [
      attachment('c1', '12345', 5),
      attachment('c2', 'x'.repeat(20), 20),
    ]);
    expect(accepted.map((item) => item.id)).toEqual(['c1']);
    expect(dropped).toBe(1);
  });

  it('数量上限耗尽时后续候选全部丢弃', () => {
    const existing = Array.from({ length: limits.maxCount }, (_, index) =>
      attachment(`e${index}`, 'x'));
    const { accepted, dropped } = acceptAttachmentsWithinBudget(existing, [
      attachment('c1', 'a'), attachment('c2', 'b'),
    ]);
    expect(accepted).toHaveLength(0);
    expect(dropped).toBe(2);
  });
});
