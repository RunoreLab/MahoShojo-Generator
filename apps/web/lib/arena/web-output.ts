import { stripAllStreamMetaComments } from './stream-meta';

export type ArenaWebOutputNormalization = {
  document: string | null;
  prelude: string;
  epilogue: string;
};

const HTML_DOCTYPE_PATTERN = /<!doctype\s+html\b/i;
const HTML_OPEN_TAG_PATTERN = /<html(?:\s|>)/i;
const HTML_CLOSE_TAG_PATTERN = /^<\/html\s*>/i;
const HTML_TEXT_CONTAINER_OPEN_TAG_PATTERN = /^<(script|style|title|textarea)\b[^>]*>/i;
const FENCE_BEFORE_DOCUMENT_PATTERN = /(?:^|\n)[ \t]*```(?:html)?[ \t]*\n[ \t]*$/i;
const FENCE_AFTER_DOCUMENT_PATTERN = /^\s*```[ \t]*(?:\r?\n|$)/;

const trimDocumentBoundaryFence = (text: string, pattern: RegExp): string => text.replace(pattern, '').trim();

const findDocumentEnd = (text: string, start: number): number => {
  let cursor = start;
  while (cursor < text.length) {
    const nextTag = text.indexOf('<', cursor);
    if (nextTag < 0) break;

    if (text.startsWith('<!--', nextTag)) {
      const commentEnd = text.indexOf('-->', nextTag + 4);
      if (commentEnd < 0) return -1;
      cursor = commentEnd + 3;
      continue;
    }

    const closeMatch = HTML_CLOSE_TAG_PATTERN.exec(text.slice(nextTag));
    if (closeMatch) return nextTag + closeMatch[0].length;

    const textContainerOpenMatch = HTML_TEXT_CONTAINER_OPEN_TAG_PATTERN.exec(text.slice(nextTag));
    if (textContainerOpenMatch) {
      const textContainerEndPattern = new RegExp(`</${textContainerOpenMatch[1]}\\s*>`, 'i');
      const textContainerEndMatch = textContainerEndPattern.exec(text.slice(nextTag + textContainerOpenMatch[0].length));
      if (!textContainerEndMatch) return -1;
      cursor = nextTag + textContainerOpenMatch[0].length + textContainerEndMatch.index + textContainerEndMatch[0].length;
      continue;
    }

    cursor = nextTag + 1;
  }

  return -1;
};

/**
 * 把模型传输文本拆成可执行 HTML 与不会进入 iframe 的附言。
 *
 * 这里只做 framing，不解析、重写或清洗 HTML；sandbox 仍然是执行边界。
 */
export function normalizeArenaWebOutput(raw: string): ArenaWebOutputNormalization {
  const withoutMeta = stripAllStreamMetaComments(typeof raw === 'string' ? raw : '').replace(/\r\n?/g, '\n');
  if (!withoutMeta.trim()) {
    return { document: null, prelude: '', epilogue: '' };
  }

  const doctypeMatch = HTML_DOCTYPE_PATTERN.exec(withoutMeta);
  const htmlMatch = HTML_OPEN_TAG_PATTERN.exec(withoutMeta);
  const documentStart = doctypeMatch?.index ?? htmlMatch?.index ?? -1;

  if (documentStart < 0) {
    return { document: null, prelude: withoutMeta.trim(), epilogue: '' };
  }

  const documentEnd = findDocumentEnd(withoutMeta, documentStart);
  if (documentEnd < 0) {
    return { document: null, prelude: withoutMeta.trim(), epilogue: '' };
  }

  const document = withoutMeta.slice(documentStart, documentEnd).trim();
  const prelude = trimDocumentBoundaryFence(
    withoutMeta.slice(0, documentStart),
    FENCE_BEFORE_DOCUMENT_PATTERN,
  );
  const epilogue = trimDocumentBoundaryFence(
    withoutMeta.slice(documentEnd),
    FENCE_AFTER_DOCUMENT_PATTERN,
  );

  return { document, prelude, epilogue };
}
