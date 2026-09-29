/**
 * Deterministic recovery of a generated target file from a sloppy model response.
 *
 * Providers routinely wrap JSON targets in packaging the host never asked for:
 * a Markdown fence, or the target path echoed as a heading. Strict `JSON.parse`
 * rejects all of it and the generation fails even though the payload itself is
 * correct.
 *
 * This module is deliberately conservative. It only removes *wrapping*:
 *
 *   - it never rewrites values, adds fields, reorders keys, or repairs content;
 *   - it never guesses structure (an object stays an object — the package schema,
 *     not this module, decides what the top level should be);
 *   - it is idempotent and byte-identical on already-valid input.
 *
 * Content decisions belong to the package author (schema + example), not to a
 * silent host-side fixer. See ADR-web-package-target-shape-and-normalization-v1.
 */

export type WebPackageJsonTargetIssue =
  | 'code-fence'
  | 'leading-path-line'
  | 'leading-text'
  | 'unterminated';

export type WebPackageJsonNormalization = Readonly<{
  content: string;
  changed: boolean;
  issues: readonly WebPackageJsonTargetIssue[];
  /** First line of the recovered value, for error diagnostics. Never the full payload. */
  preview: string;
}>;

const PREVIEW_LIMIT = 200;

/** ```json … ``` or ~~~ … ~~~ wrapping the whole response. */
const FENCE = /^(?:`{3,}|~{3,})[ \t]*[A-Za-z0-9_+.-]*[ \t]*\r?\n([\s\S]*?)(?:\r?\n)?(?:`{3,}|~{3,})[ \t]*$/u;

/** A bare path line the model echoes before the value, e.g. `static/events.json`. */
const LEADING_PATH_LINE = /^[^\s"'`[{<]{1,200}\.(?:json|jsonl|html?|md|txt|csv|xml|svg|css|m?js|webmanifest|vtt)\b[ \t]*[:：]?[ \t]*\r?\n/u;

/**
 * First balanced top-level JSON value, scanning string-aware so braces inside
 * string literals cannot end the value early.
 */
const extractFirstJsonValue = (text: string): string | null => {
  const start = text.search(/[[{]/u);
  if (start < 0) return null;
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{' || char === '[') stack.push(char);
    else if (char === '}' || char === ']') {
      stack.pop();
      if (stack.length === 0) return text.slice(start, index + 1);
    }
  }
  return null;
};

const parseJson = (text: string): unknown => JSON.parse(text) as unknown;

const recover = (raw: string): { content: string; issues: WebPackageJsonTargetIssue[] } => {
  const issues: WebPackageJsonTargetIssue[] = [];
  let text = raw.trim();

  // Fence and path line can arrive in either order (`path` then ```` ```json ````),
  // so the fence is re-checked after the path line is gone.
  const stripFence = (value: string): string => {
    const fenced = FENCE.exec(value);
    if (fenced?.[1] === undefined) return value;
    if (!issues.includes('code-fence')) issues.push('code-fence');
    return fenced[1].trim();
  };
  text = stripFence(text);
  const withPathLine = text.replace(LEADING_PATH_LINE, '').trim();
  if (withPathLine !== text) {
    text = withPathLine;
    issues.push('leading-path-line');
  }
  text = stripFence(text);

  try {
    parseJson(text);
    return { content: text, issues };
  } catch {
    // Fall through to extraction below.
  }

  const extracted = extractFirstJsonValue(text);
  if (extracted !== null) {
    try {
      parseJson(extracted);
      return { content: extracted, issues: [...issues, 'leading-text'] };
    } catch {
      // An unbalanced or truncated value is not recoverable here.
    }
  }

  issues.push('unterminated');
  return { content: text, issues };
};

/**
 * Recover the raw target file text from a provider response.
 *
 * Returns the input unchanged when it already parses, so the returned content is
 * what every downstream digest and byte budget must be computed from.
 */
export const normalizeJsonTargetContent = (raw: string): WebPackageJsonNormalization => {
  const trimmed = raw.trim();
  const { content, issues } = recover(trimmed);
  const firstLine = content.split('\n', 1)[0] ?? '';
  return Object.freeze({
    content,
    changed: content !== trimmed,
    issues: Object.freeze(issues),
    preview: firstLine.slice(0, PREVIEW_LIMIT),
  });
};
