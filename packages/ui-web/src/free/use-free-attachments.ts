import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  acceptAttachmentsWithinBudget,
  formatFreeAttachmentOverflowError,
  formatFreeAttachmentReadError,
  readFreeAttachmentFiles,
  type AttachmentReadResult,
  type FreeAttachmentState,
} from './attachments';

/**
 * /free 附件会话（D5.1-P3 上移）：读取/合并/清空/移除的 UI 会话责任，
 * Web 与 Desktop 同一套语义——
 *  - 附件不写入草稿，由本 hook 自治；
 *  - 清单显式改动（清空/移除）与组件卸载都会失效在途读取，迟到结果
 *    不得复活用户已显式放弃的内容；
 *  - 合并前按真实清单复核总量预算（读取按开始时快照计费）；
 *  - input[type=file] 的 value 复位由 hook 统一管理。
 *
 * `readFiles` 为测试 seam：页面在需要替身时显式注入同名实现。
 */
export interface UseFreeAttachmentsResult {
  items: FreeAttachmentState[];
  isReading: boolean;
  error: string | null;
  inputRef: RefObject<HTMLInputElement | null>;
  totalChars: number;
  totalBytes: number;
  addFiles: (files: ArrayLike<File> | null | undefined) => Promise<void>;
  remove: (id: string) => void;
  clear: () => void;
}

export const useFreeAttachments = (
  readFiles: (files: ArrayLike<File>, existing: readonly FreeAttachmentState[]) => Promise<AttachmentReadResult>
    = readFreeAttachmentFiles,
): UseFreeAttachmentsResult => {
  const [items, setItems] = useState<FreeAttachmentState[]>([]);
  const [isReading, setIsReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const epochRef = useRef(0);
  // 已提交清单的同步镜像：合并时以它为准（setState 提交可能有渲染延迟）。
  const itemsRef = useRef<FreeAttachmentState[]>([]);
  const readFilesRef = useRef(readFiles);
  useEffect(() => { readFilesRef.current = readFiles; }, [readFiles]);

  const commit = useCallback((next: FreeAttachmentState[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  const resetInput = useCallback(() => {
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  useEffect(() => () => { epochRef.current += 1; }, []);

  const addFiles = useCallback(async (files: ArrayLike<File> | null | undefined) => {
    if (!files || files.length === 0) return;
    // 新一轮读取失效旧读取：同一时刻只有最新一批读取允许落地。
    const epoch = ++epochRef.current;
    setIsReading(true);
    setError(null);
    try {
      const { added, skipped } = await readFilesRef.current(files, itemsRef.current);
      // 读取期间清单被改动（清空/移除/另一次读取/卸载）：迟到结果一律丢弃。
      if (epoch !== epochRef.current) return;
      // 合并前复核总量预算：读取按开始时的快照计费，此间余量可能已变。
      const { accepted, dropped } = acceptAttachmentsWithinBudget(itemsRef.current, added);
      commit([...itemsRef.current, ...accepted]);
      const ignored = skipped + dropped;
      if (ignored > 0) setError(formatFreeAttachmentOverflowError(ignored));
    } catch (readError) {
      if (epoch !== epochRef.current) return;
      setError(formatFreeAttachmentReadError(readError instanceof Error ? readError.message : '读取失败'));
    } finally {
      if (epoch === epochRef.current) setIsReading(false);
      resetInput();
    }
  }, [commit, resetInput]);

  const remove = useCallback((id: string) => {
    epochRef.current += 1;
    commit(itemsRef.current.filter((entry) => entry.id !== id));
  }, [commit]);

  const clear = useCallback(() => {
    epochRef.current += 1;
    commit([]);
    setError(null);
    setIsReading(false);
    resetInput();
  }, [commit, resetInput]);

  const totalChars = useMemo(
    () => items.reduce((sum, item) => sum + item.content.length, 0),
    [items],
  );
  const totalBytes = useMemo(
    () => items.reduce((sum, item) => sum + item.includedBytes, 0),
    [items],
  );

  return {
    items,
    isReading,
    error,
    inputRef,
    totalChars,
    totalBytes,
    addFiles,
    remove,
    clear,
  };
};
