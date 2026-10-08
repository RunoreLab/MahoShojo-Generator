// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FREE_GENERATION_ATTACHMENT_LIMITS } from '@mahoshojo/ai-core/reference-attachments';
import {
  useFreeAttachments,
  type AttachmentReadResult,
  type FreeAttachmentState,
  type UseFreeAttachmentsResult,
} from '../src/free';

/**
 * `useFreeAttachments` 的会话语义：读取合并、代际失效、清空/移除、
 * 预算复核与 input 复位，由 ui-web 统一承担（Web/Desktop 同一份）。
 */

const file = (name: string, content: string, type = 'text/plain'): File =>
  new File([content], name, { type });

const mkAttachment = (id: string, content = 'abc'): FreeAttachmentState => ({
  id, name: `${id}.txt`, type: 'text/plain',
  size: content.length, includedBytes: content.length, content,
});

type ReadFiles = (
  files: ArrayLike<File>,
  existing: readonly FreeAttachmentState[],
) => Promise<AttachmentReadResult>;

let root: Root;
let container: HTMLDivElement;
let ctl: UseFreeAttachmentsResult;
let readFiles: ReturnType<typeof vi.fn<ReadFiles>>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  readFiles = vi.fn<ReadFiles>();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const Probe = () => {
  ctl = useFreeAttachments(readFiles);
  return <input ref={ctl.inputRef} type="file" />;
};
const mount = async () => { await act(async () => root.render(<Probe />)); };

describe('useFreeAttachments', () => {
  it('读取结果合并入清单并复位 input；isReading 只在读取期间为真', async () => {
    let resolveRead: (value: AttachmentReadResult) => void = () => undefined;
    readFiles.mockImplementation(() => new Promise<AttachmentReadResult>((resolve) => { resolveRead = resolve; }));
    await mount();
    const input = ctl.inputRef.current!;
    expect(input).toBeTruthy();

    let pending: Promise<void> | null = null;
    await act(async () => { pending = ctl.addFiles([file('pick.txt', 'x')]); });
    expect(ctl.isReading).toBe(true);
    await act(async () => { resolveRead({ added: [mkAttachment('a')], skipped: 0 }); await pending; });
    expect(ctl.isReading).toBe(false);
    expect(ctl.items.map((item) => item.name)).toEqual(['a.txt']);
    expect(ctl.totalChars).toBe(3);
    expect(ctl.totalBytes).toBe(3);
    expect(input.value).toBe('');
    expect(readFiles).toHaveBeenCalledTimes(1);
  });

  it('读取中清空：迟到结果按代际丢弃，不复活已放弃的清单', async () => {
    let resolveLate: (value: AttachmentReadResult) => void = () => undefined;
    const late = new Promise<AttachmentReadResult>((resolve) => { resolveLate = resolve; });
    readFiles
      .mockImplementationOnce(async () => ({ added: [mkAttachment('a')], skipped: 0 }))
      .mockImplementationOnce(() => late);
    await mount();
    await act(async () => { await ctl.addFiles([file('p1.txt', 'x')]); });
    expect(ctl.items).toHaveLength(1);

    await act(async () => { void ctl.addFiles([file('p2.txt', 'y')]); });
    await act(() => { ctl.clear(); });
    expect(ctl.items).toHaveLength(0);
    expect(ctl.isReading).toBe(false);
    await act(async () => { resolveLate({ added: [mkAttachment('late')], skipped: 0 }); await late; });
    expect(ctl.items).toHaveLength(0);
  });

  it('读取中移除单个附件：迟到结果同样被丢弃', async () => {
    let resolveLate: (value: AttachmentReadResult) => void = () => undefined;
    const late = new Promise<AttachmentReadResult>((resolve) => { resolveLate = resolve; });
    readFiles
      .mockImplementationOnce(async () => ({ added: [mkAttachment('a')], skipped: 0 }))
      .mockImplementationOnce(() => late);
    await mount();
    await act(async () => { await ctl.addFiles([file('p1.txt', 'x')]); });
    await act(async () => { void ctl.addFiles([file('p2.txt', 'y')]); });
    await act(() => { ctl.remove('a'); });
    await act(async () => { resolveLate({ added: [mkAttachment('late')], skipped: 0 }); await late; });
    expect(ctl.items).toHaveLength(0);
  });

  it('合并前复核真实余量：放不下的候选如实丢弃并提示', async () => {
    readFiles
      .mockImplementationOnce(async () => ({
        added: [mkAttachment('big', 'x'.repeat(FREE_GENERATION_ATTACHMENT_LIMITS.maxCharsTotal))],
        skipped: 0,
      }))
      .mockImplementationOnce(async () => ({ added: [mkAttachment('c1', 'a'), mkAttachment('c2', 'b')], skipped: 0 }));
    await mount();
    await act(async () => { await ctl.addFiles([file('big.txt', 'x')]); });
    await act(async () => { await ctl.addFiles([file('p.txt', 'y')]); });
    expect(ctl.items.map((item) => item.name)).toEqual(['big.txt']);
    expect(ctl.error).toContain('附件总量超过限制');
    expect(ctl.error).toContain('已忽略 2 个文件');
  });

  it('两次重叠读取：过期批次的结果与忽略计数都不落地（双 Deferred 钉测，G2-r1-r1）', async () => {
    // 两批读取同时在途：新一批开始即作废旧批（epoch 失效）。旧批即便自带
    // skipped 计数也不得显示——提示只可能属于真正落地的那一批。
    const deferreds: { resolve: (value: AttachmentReadResult) => void }[] = [];
    readFiles.mockImplementation(
      () => new Promise<AttachmentReadResult>((resolve) => { deferreds.push({ resolve }); }),
    );
    await mount();
    let first: Promise<void> | null = null;
    let second: Promise<void> | null = null;
    await act(async () => { first = ctl.addFiles([file('a.txt', 'a')]); });
    await act(async () => { second = ctl.addFiles([file('b.txt', 'b')]); });
    expect(readFiles).toHaveBeenCalledTimes(2);

    // 旧批先回：整批按代际丢弃，既不入清单也不显示它的 skipped 计数；
    // isReading 由仍在途的新批保持。
    await act(async () => { deferreds[0]!.resolve({ added: [mkAttachment('old')], skipped: 3 }); await first; });
    expect(ctl.items).toHaveLength(0);
    expect(ctl.error).toBeNull();
    expect(ctl.isReading).toBe(true);

    // 新批落地：合并自己的结果，忽略计数只反映这一批。
    await act(async () => { deferreds[1]!.resolve({ added: [mkAttachment('new')], skipped: 1 }); await second; });
    expect(ctl.items.map((item) => item.name)).toEqual(['new.txt']);
    expect(ctl.error).toContain('已忽略 1 个文件');
    expect(ctl.isReading).toBe(false);
  });

  it('读取失败如实报错且不清空既有清单', async () => {
    readFiles
      .mockImplementationOnce(async () => ({ added: [mkAttachment('a')], skipped: 0 }))
      .mockImplementationOnce(async () => { throw new Error('磁盘拒绝'); });
    await mount();
    await act(async () => { await ctl.addFiles([file('p1.txt', 'x')]); });
    await act(async () => { await ctl.addFiles([file('p2.txt', 'y')]); });
    expect(ctl.error).toBe('⚠️ 附件读取失败：磁盘拒绝');
    expect(ctl.items.map((item) => item.name)).toEqual(['a.txt']);
  });
});
