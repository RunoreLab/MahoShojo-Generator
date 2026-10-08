import {
  FREE_GENERATION_ATTACHMENT_LIMITS,
  type AITextAttachment,
} from '@mahoshojo/ai-core/reference-attachments';

/**
 * /free 附件读取（D5.1-G2）：与 Web `FreePage.handleAddAttachments` 同一预算
 * 语义——单文件/总量字节与字符截断、超预算即跳过并计数。UI 无关，可单测。
 */

export interface FreeAttachmentState extends AITextAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  includedBytes: number;
}

export interface AttachmentReadResult {
  added: FreeAttachmentState[];
  /** 因总量预算耗尽而完全未读取的文件数。 */
  skipped: number;
}

const newAttachmentId = (): string =>
  `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const readFreeAttachmentFiles = async (
  files: ArrayLike<File>,
  existing: readonly FreeAttachmentState[],
): Promise<AttachmentReadResult> => {
  const limits = FREE_GENERATION_ATTACHMENT_LIMITS;
  let remainingChars = Math.max(
    0,
    limits.maxCharsTotal - existing.reduce((sum, item) => sum + item.content.length, 0),
  );
  let remainingBytes = Math.max(
    0,
    limits.maxBytesTotal - existing.reduce((sum, item) => sum + item.includedBytes, 0),
  );

  const added: FreeAttachmentState[] = [];
  let skipped = 0;
  for (const file of Array.from(files)) {
    if (added.length + existing.length >= limits.maxCount
      || remainingChars <= 0 || remainingBytes <= 0) {
      skipped += 1;
      continue;
    }
    const sliceBytes = Math.min(file.size, limits.maxBytesPerFile, remainingBytes);
    if (sliceBytes <= 0) {
      skipped += 1;
      continue;
    }
    const blob = file.slice(0, sliceBytes);
    let text = await blob.text();
    let truncated = blob.size < file.size;
    if (text.length > limits.maxCharsPerFile) {
      text = text.slice(0, limits.maxCharsPerFile);
      truncated = true;
    }
    if (text.length > remainingChars) {
      text = text.slice(0, remainingChars);
      truncated = true;
    }
    remainingChars -= text.length;
    remainingBytes -= sliceBytes;
    added.push({
      id: newAttachmentId(),
      name: file.name || 'untitled',
      type: file.type || 'application/octet-stream',
      size: file.size,
      includedBytes: sliceBytes,
      content: text,
      ...(truncated ? { truncated: true } : {}),
    });
  }
  return { added, skipped };
};

/** 附件 → hosted/direct 请求体的公共投影（去掉 UI 附加字段）。 */
export const toPromptAttachments = (items: readonly FreeAttachmentState[]): AITextAttachment[] =>
  items.map((item) => ({
    name: item.name,
    type: item.type,
    size: item.size,
    content: item.content,
    ...(item.truncated ? { truncated: true } : {}),
  }));
