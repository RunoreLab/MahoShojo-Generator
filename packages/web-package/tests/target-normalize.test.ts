import { describe, expect, it } from 'vitest';
import { normalizeJsonTargetContent } from '../src/target-normalize';

const canonical = '[{"id":"e1","text":"早安"},{"id":"e2","text":"晚安"}]';

describe('JSON target normalization', () => {
  it('leaves an already-valid document byte-identical', () => {
    const result = normalizeJsonTargetContent(canonical);
    expect(result.content).toBe(canonical);
    expect(result.changed).toBe(false);
    expect(result.issues).toEqual([]);
  });

  it('is idempotent, including when the input carries surrounding whitespace', () => {
    const spaced = `\n\n  ${canonical}  \n`;
    const once = normalizeJsonTargetContent(spaced);
    expect(once.changed).toBe(false);
    expect(once.content).toBe(canonical);
    expect(normalizeJsonTargetContent(once.content).content).toBe(once.content);
  });

  it('recovers a fenced document and reports the fence', () => {
    for (const fence of ['```json', '```', '~~~json', '~~~']) {
      const result = normalizeJsonTargetContent(`${fence}\n${canonical}\n${fence[0]!.repeat(3)}`);
      expect(result.content).toBe(canonical);
      expect(result.changed).toBe(true);
      expect(result.issues).toContain('code-fence');
    }
  });

  it('recovers an echoed target path line', () => {
    const result = normalizeJsonTargetContent('static/events.json\n' + canonical);
    expect(result.content).toBe(canonical);
    expect(result.issues).toEqual(['leading-path-line']);
  });

  it('recovers a path line followed by a fence', () => {
    const result = normalizeJsonTargetContent('static/events.json\n```json\n' + canonical + '\n```');
    expect(result.content).toBe(canonical);
    expect(result.issues).toEqual(expect.arrayContaining(['code-fence', 'leading-path-line']));
  });

  it('extracts the first JSON value out of surrounding prose', () => {
    const result = normalizeJsonTargetContent('好的，这是你要的数据：\n' + canonical + '\n希望对你有帮助！');
    expect(result.content).toBe(canonical);
    expect(result.issues).toContain('leading-text');
  });

  it('does not confuse braces or brackets inside string values for structure', () => {
    const tricky = JSON.stringify([{ id: 'a]', text: '他说“{这里}”还有 \\" 引号' }]);
    const result = normalizeJsonTargetContent('前言\n' + tricky + '\n后记');
    expect(result.content).toBe(tricky);
    expect(JSON.parse(result.content)).toEqual(JSON.parse(tricky));
  });

  it('never guesses structure: an object is never promoted to an array', () => {
    const object = '{"title":"故事","content":"正文"}';
    const result = normalizeJsonTargetContent('```json\n' + object + '\n```');
    expect(result.content).toBe(object);
    expect(JSON.parse(result.content)).toEqual({ title: '故事', content: '正文' });
    expect(Array.isArray(JSON.parse(result.content))).toBe(false);
  });

  it('never rewrites values, keys or ordering', () => {
    const messy = '[ { "b" : 1 , "a" : [ 2 , 3 ] } ]';
    const result = normalizeJsonTargetContent(messy);
    expect(result.content).toBe(messy);
    expect(result.changed).toBe(false);
  });

  it('preserves non-ASCII content byte for byte', () => {
    const cjk = JSON.stringify([{ id: '雀权', text: '小璐说：“今天也想和你并肩。”' }], null, 2);
    const result = normalizeJsonTargetContent('```json\n' + cjk + '\n```');
    expect(result.content).toBe(cjk);
  });

  it('flags prose as unrecoverable instead of inventing a payload', () => {
    const result = normalizeJsonTargetContent('故事标题：《雨天的薄荷与焦糖》\n\n雨落在老式书店的玻璃橱窗上。');
    expect(result.issues).toEqual(['unterminated']);
    expect(JSON.parse.bind(JSON, result.content)).toThrow();
  });

  it('flags a truncated document as unrecoverable', () => {
    const result = normalizeJsonTargetContent('[{"id":"e1","text":"还没写完');
    expect(result.issues).toEqual(['unterminated']);
    expect(JSON.parse.bind(JSON, result.content)).toThrow();
  });

  it('exposes a bounded first-line preview for diagnostics', () => {
    const long = JSON.stringify([{ id: 'x'.repeat(500) }], null, 2);
    const result = normalizeJsonTargetContent(long);
    expect(result.preview.length).toBeLessThanOrEqual(200);
    expect(result.preview.startsWith('[')).toBe(true);
  });

  it('rejects a document whose only JSON is nested inside a longer unterminated one', () => {
    const result = normalizeJsonTargetContent('[{"id":"e1"},{"id":"e2"');
    expect(result.issues).toEqual(['unterminated']);
  });
});
