export type BulkParseFormat = 'json' | 'qa' | 'paragraphs' | 'lines' | 'unknown';

export type BulkParseEntry = {
  index: number;
  value: string;
};

export type BulkParseOptions = {
  expectedCount?: number;
  orderedQuestionIds?: string[];
  orderedQuestionKeys?: string[];
};

export type BulkParseResult = {
  entries: BulkParseEntry[];
  format: BulkParseFormat;
  warnings: string[];
};

const normalizeNewlines = (input: string) => input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const coerceToString = (value: unknown) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const stripListPrefix = (line: string) => {
  let result = line.trim();
  result = result.replace(/^\s*(?:[-*•]+)\s+/, '');
  result = result.replace(/^\s*(?:\(?\s*)?(?:\d+|[一二三四五六七八九十]+)\s*(?:[.)、】【】、:：-])\s*/, '');
  result = result.replace(/^\s*(?:A|答|答案|回答)\s*(?:\d+)?\s*[:：]\s*/i, '');
  return result.trim();
};

const looksLikeQuestionLine = (line: string) =>
  /^\s*(?:Q|问|问题)\s*(?:\d+)?\s*[:：]/i.test(line.trim());

const matchAnswerLine = (line: string) => {
  const trimmed = line.trim();
  const startMatch = trimmed.match(/^(?:A|答|答案|回答)\s*(?:\d+)?\s*[:：]\s*(.*)$/i);
  if (startMatch) return { value: startMatch[1] ?? '', type: 'start' as const };

  const inlineMatch = line.match(/(?:^|\s)(?:A|答|答案|回答)\s*(?:\d+)?\s*[:：]\s*(.*)$/i);
  if (inlineMatch) return { value: inlineMatch[1] ?? '', type: 'inline' as const };

  return null;
};

const parseFromJson = (raw: string, options: BulkParseOptions): BulkParseResult | null => {
  try {
    const parsed = JSON.parse(raw) as unknown;

    if (Array.isArray(parsed)) {
      const entries = parsed.map((value, index) => {
        if (value && typeof value === 'object') {
          const record = value as Record<string, unknown>;
          const answer = coerceToString(record.answer ?? record.value ?? '').trim();
          return { index, value: answer };
        }
        return { index, value: coerceToString(value).trim() };
      });
      return { entries, format: 'json', warnings: [] };
    }

    if (isPlainObject(parsed)) {
      const directUserAnswers = parsed.userAnswers ?? parsed.answers ?? parsed.answerItems;
      if (Array.isArray(directUserAnswers)) {
        const entries = directUserAnswers.map((value, index) => {
          if (value && typeof value === 'object') {
            const record = value as Record<string, unknown>;
            const answer = coerceToString(record.answer ?? record.value ?? '').trim();
            return { index, value: answer };
          }
          return { index, value: coerceToString(value).trim() };
        });
        return { entries, format: 'json', warnings: [] };
      }

      const directAnswerMap = parsed.answersByKey;
      if (isPlainObject(directAnswerMap)) {
        const orderedKeys = options.orderedQuestionKeys ?? [];
        if (orderedKeys.length > 0) {
          const entries: BulkParseEntry[] = [];
          orderedKeys.forEach((key, index) => {
            if (Object.prototype.hasOwnProperty.call(directAnswerMap, key)) {
              const value = coerceToString((directAnswerMap as Record<string, unknown>)[key]).trim();
              if (value.length > 0 || (directAnswerMap as Record<string, unknown>)[key] === '') {
                entries.push({ index, value });
              }
            }
          });
          if (entries.length > 0) return { entries, format: 'json', warnings: [] };
        }
      }

      const orderedIds = options.orderedQuestionIds ?? [];
      if (orderedIds.length > 0) {
        const entries: BulkParseEntry[] = [];
        orderedIds.forEach((questionId, index) => {
          const candidates = [
            questionId,
            String(index),
            String(index + 1),
            `MG-${index + 1}`,
            `CS-${index + 1}`,
          ];
          for (const key of candidates) {
            if (Object.prototype.hasOwnProperty.call(parsed, key)) {
              const value = coerceToString(parsed[key]).trim();
              if (value.length > 0 || parsed[key] === '') {
                entries.push({ index, value });
              }
              return;
            }
          }
        });

        if (entries.length > 0) return { entries, format: 'json', warnings: [] };
      }

      const numericKeys = Object.keys(parsed)
        .filter(key => /^\d+$/.test(key))
        .map(key => Number(key))
        .sort((a, b) => a - b);

      if (numericKeys.length > 0) {
        const entries = numericKeys.map(key => ({ index: key, value: coerceToString(parsed[String(key)]).trim() }));
        if (entries.length > 0) return { entries, format: 'json', warnings: [] };
      }
    }
  } catch {
    return null;
  }
  return null;
};

const parseFromQaText = (raw: string): BulkParseResult | null => {
  if (!/(^|\n)\s*(?:A|答|答案|回答)\s*(?:\d+)?\s*[:：]/im.test(raw)) return null;

  const lines = normalizeNewlines(raw).split('\n');
  const entries: BulkParseEntry[] = [];
  let current: string[] | null = null;

  const flush = () => {
    if (!current) return;
    const joined = current.join('\n').replace(/\s+$/g, '').trim();
    entries.push({ index: entries.length, value: joined });
    current = null;
  };

  for (const line of lines) {
    const answerMatch = matchAnswerLine(line);
    if (answerMatch) {
      flush();
      current = [answerMatch.value];
      continue;
    }

    if (looksLikeQuestionLine(line)) {
      flush();
      continue;
    }

    if (current) current.push(line);
  }

  flush();
  if (entries.length === 0) return null;
  return { entries, format: 'qa', warnings: [] };
};

const parseFromParagraphs = (raw: string): BulkParseResult | null => {
  const normalized = normalizeNewlines(raw).trim();
  const paragraphs = normalized.split(/\n\s*\n+/).map(chunk => chunk.trim()).filter(Boolean);
  if (paragraphs.length < 2) return null;

  const entries: BulkParseEntry[] = [];
  for (const paragraph of paragraphs) {
    const lines = paragraph.split('\n');
    let candidate = paragraph;
    if (lines.length >= 2 && looksLikeQuestionLine(lines[0])) {
      candidate = lines.slice(1).join('\n').trim();
    }
    candidate = candidate.trim();
    if (candidate.length > 0) entries.push({ index: entries.length, value: candidate });
  }
  if (entries.length === 0) return null;
  return { entries, format: 'paragraphs', warnings: [] };
};

const parseFromLines = (raw: string): BulkParseResult | null => {
  const normalized = normalizeNewlines(raw);
  const lines = normalized.split('\n').map(line => line.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  const entries: BulkParseEntry[] = [];
  for (const line of lines) {
    const cleaned = stripListPrefix(line);
    if (cleaned.length > 0) entries.push({ index: entries.length, value: cleaned });
  }
  if (entries.length === 0) return null;
  return { entries, format: 'lines', warnings: [] };
};

export const parseBulkQuestionnaireAnswers = (rawInput: string, options: BulkParseOptions = {}): BulkParseResult => {
  const warnings: string[] = [];
  const trimmed = normalizeNewlines(rawInput ?? '').trim();
  if (!trimmed) return { entries: [], format: 'unknown', warnings: ['empty'] };

  const jsonResult = parseFromJson(trimmed, options);
  if (jsonResult) return jsonResult;

  const qaResult = parseFromQaText(trimmed);
  if (qaResult) return qaResult;

  const paragraphsResult = parseFromParagraphs(trimmed);
  if (paragraphsResult) return paragraphsResult;

  const linesResult = parseFromLines(trimmed);
  if (linesResult) return linesResult;

  warnings.push('unrecognized-format');
  return { entries: [], format: 'unknown', warnings };
};
