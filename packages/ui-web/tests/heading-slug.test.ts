import { describe, expect, it } from 'vitest';

import {
  createHeadingSlugger,
  decodeFragmentId,
  slugifyHeading,
} from '../src/markdown/heading-slug';

/**
 * heading slug 是「百科锚点可用」的地基。
 *
 * 旧实现在内联链接正则里用 `[A-Za-z0-9-_]+` 匹配 fragment，结果是所有中文标题的锚点都被判死
 * （`D3.0-5`）。因此这里钉住的是「中文标题可用」和「同名标题不冲突」这两条验收口径，而不是某一段
 * 正则的字面形式。
 */
describe('slugifyHeading', () => {
  it('keeps CJK characters so Chinese headings are linkable', () => {
    expect(slugifyHeading('角色生成')).toBe('角色生成');
    expect(slugifyHeading('对战与计分')).toBe('对战与计分');
  });

  it('keeps ASCII words and folds punctuation and spaces into single dashes', () => {
    expect(slugifyHeading('Getting Started')).toBe('getting-started');
    expect(slugifyHeading('AI_APICallError（上游 AI 接口调用失败）')).toBe('ai_apicallerror上游-ai-接口调用失败');
    expect(slugifyHeading('a  --  b')).toBe('a-b');
    expect(slugifyHeading('  padded  ')).toBe('padded');
  });

  it('never produces an empty id', () => {
    // 空 id 会让页面里第一个元素变成 fragment 目标，比一个稳定占位糟糕得多。
    expect(slugifyHeading('!!!')).toBe('section');
    expect(slugifyHeading('')).toBe('section');
  });
});

describe('createHeadingSlugger', () => {
  it('suffixes duplicate headings instead of colliding', () => {
    const slug = createHeadingSlugger();
    expect(slug('常见问题')).toBe('常见问题');
    expect(slug('常见问题')).toBe('常见问题-1');
    expect(slug('常见问题')).toBe('常见问题-2');
    expect(slug('其他')).toBe('其他');
  });

  it('treats near-identical headings as distinct', () => {
    // 标点差异折叠后可能撞上；消解必须发生在折叠之后，否则会给出两个不同的 id 指向同一节。
    const slug = createHeadingSlugger();
    expect(slug('Setup:')).toBe('setup');
    expect(slug('Setup')).toBe('setup-1');
  });

  it('does not share state between articles', () => {
    expect(createHeadingSlugger()('概述')).toBe('概述');
    expect(createHeadingSlugger()('概述')).toBe('概述');
  });
});

describe('decodeFragmentId', () => {
  it('decodes percent-encoded CJK fragments', () => {
    expect(decodeFragmentId('#%E8%A7%92%E8%89%B2%E7%94%9F%E6%88%90')).toBe('角色生成');
    expect(decodeFragmentId('%E8%A7%92%E8%89%B2%E7%94%9F%E6%88%90')).toBe('角色生成');
  });

  it('passes plain ASCII fragments through unchanged', () => {
    expect(decodeFragmentId('#getting-started')).toBe('getting-started');
    expect(decodeFragmentId('getting-started')).toBe('getting-started');
  });

  it('returns the raw value for a malformed escape instead of throwing', () => {
    // 抛错会变成白屏；一个指不到节点的链接只是"没跳过去"。
    expect(decodeFragmentId('#%')).toBe('%');
    expect(decodeFragmentId('#%E0%A4%A')).toBe('%E0%A4%A');
  });

  it('treats an empty fragment as no target', () => {
    expect(decodeFragmentId('')).toBe('');
    expect(decodeFragmentId('#')).toBe('');
  });
});