import { describe, expect, it } from 'vitest';

import {
  battleReportModeLabel,
  extractHtmlDocumentTitle,
  extractMetaHeadlineFromContent,
  resolveBattleReportDisplayTitle,
  resolveWebDisplayTitle,
} from '@/lib/arena/battle-report-display-title';

const NOW = new Date(2026, 8, 22, 8, 39);
const html = (inner: string): string => `<!doctype html><html><head>${inner}</head><body><p>正文</p></body></html>`;

describe('extractHtmlDocumentTitle', () => {
  it('只解析静态 title，并解码基础实体', () => {
    expect(extractHtmlDocumentTitle(html('<title>雨夜车站 &amp; 决战</title>'))).toBe('雨夜车站 & 决战');
  });

  it('忽略 script/style/注释中的伪造 title', () => {
    const document = html(`
      <script>const demo = "<title>假标题</title>";</script>
      <style>/* <title>样式假标题</title> */</style>
      <!-- <title>注释假标题</title> -->
      <title>真实标题</title>
    `);
    expect(extractHtmlDocumentTitle(document)).toBe('真实标题');
  });

  it('空 title 或缺失 title 返回 null', () => {
    expect(extractHtmlDocumentTitle(html('<title>   </title>'))).toBeNull();
    expect(extractHtmlDocumentTitle(html('<meta charset="utf-8">'))).toBeNull();
    expect(extractHtmlDocumentTitle(null)).toBeNull();
  });
});

describe('extractMetaHeadlineFromContent', () => {
  it('从最后一个机器元数据注释读取 report.headline', () => {
    const content = [
      html('<title>页面标题</title>'),
      '<!-- MAHOSHOJO_ARENA_META {"version":1,"report":{"headline":"旧标题","winner":"甲"}} -->',
      '<!-- MAHOSHOJO_ARENA_META {"version":1,"report":{"headline":"权威标题","winner":"乙"}} -->',
    ].join('\n');
    expect(extractMetaHeadlineFromContent(content)).toBe('权威标题');
  });

  it('无效 JSON 或缺失 headline 返回 null', () => {
    expect(extractMetaHeadlineFromContent('<!-- MAHOSHOJO_ARENA_META {broken -->')).toBeNull();
    expect(extractMetaHeadlineFromContent('<!-- MAHOSHOJO_ARENA_META {"version":1} -->')).toBeNull();
    expect(extractMetaHeadlineFromContent('')).toBeNull();
  });
});

describe('resolveWebDisplayTitle', () => {
  it('meta headline 优先于 HTML title（冲突时不自动纠正）', () => {
    const content = [
      html('<title>页面标题</title>'),
      '<!-- MAHOSHOJO_ARENA_META {"version":1,"report":{"headline":"机器标题","winner":"甲"}} -->',
    ].join('\n');
    expect(resolveWebDisplayTitle({ html: content })).toBe('机器标题');
    expect(resolveWebDisplayTitle({ headline: '显式标题', html: content })).toBe('显式标题');
  });

  it('缺失 meta 时回退到静态 title', () => {
    expect(resolveWebDisplayTitle({ html: html('<title>月下决战</title>') })).toBe('月下决战');
  });

  it('script 伪造标题不会成为显示标题', () => {
    const content = html('<script>const demo = "<title>假标题</title>";</script>');
    expect(resolveWebDisplayTitle({ html: content, contextLabel: '雨夜车站', now: NOW }))
      .toBe('雨夜车站 · Web战报');
  });

  it('title 为空时用上下文，完全无上下文时用时间戳兜底', () => {
    expect(resolveWebDisplayTitle({ html: html(''), contextLabel: '雨夜车站' })).toBe('雨夜车站 · Web战报');
    expect(resolveWebDisplayTitle({ html: html(''), now: NOW })).toBe('Web战报_2026-09-22_0839');
  });

  it('保留 Unicode 标题字符', () => {
    expect(resolveWebDisplayTitle({ html: html('<title>夜の決戦 · 第二章</title>') })).toBe('夜の決戦 · 第二章');
  });
});

describe('resolveBattleReportDisplayTitle', () => {
  it('headline 始终优先', () => {
    expect(resolveBattleReportDisplayTitle({
      headline: '数据库标题',
      content: html('<title>页面标题</title>'),
      contextLabel: '雨夜车站',
      mode: 'scenario',
    })).toBe('数据库标题');
  });

  it('Web 内容只走 meta/title，不从正文 Markdown 猜标题', () => {
    const webContent = [
      '<html><script>const text = `\n# 假标题\n`;</script>',
      '<title>真实页面标题</title>',
      '</html>',
    ].join('\n');
    expect(resolveBattleReportDisplayTitle({ content: webContent, mode: 'classic' })).toBe('真实页面标题');

    const webWithoutTitle = '<html><body><p># 也不是标题</p></body></html>';
    expect(resolveBattleReportDisplayTitle({ content: webWithoutTitle, contextLabel: '雨夜车站' }))
      .toBe('雨夜车站 · Web战报');
  });

  it('Markdown 内容取严格一级标题', () => {
    expect(resolveBattleReportDisplayTitle({
      content: '# 雾中重生\n\n正文\n<!-- MAHOSHOJO_ARENA_META {"version":1} -->',
      mode: 'classic',
    })).toBe('雾中重生');
  });

  it('无标题无内容时回退到上下文，再回退到时间戳', () => {
    expect(resolveBattleReportDisplayTitle({ contextLabel: '雨夜车站', mode: 'scenario' }))
      .toBe('雨夜车站 · 情景战报');
    expect(resolveBattleReportDisplayTitle({ mode: 'classic' })).toBe('经典战报');
    expect(resolveBattleReportDisplayTitle({ now: NOW })).toBe('战报_2026-09-22_0839');
  });

  it('content 为空或被屏蔽时仅用上下文，不读取内容', () => {
    expect(resolveBattleReportDisplayTitle({
      headline: null,
      content: null,
      contextLabel: null,
      mode: 'daily',
    })).toBe('日常战报');
  });
});

describe('battleReportModeLabel', () => {
  it('映射已知模式，未知模式返回 null', () => {
    expect(battleReportModeLabel('classic')).toBe('经典');
    expect(battleReportModeLabel('kizuna')).toBe('羁绊');
    expect(battleReportModeLabel('daily')).toBe('日常');
    expect(battleReportModeLabel('scenario')).toBe('情景');
    expect(battleReportModeLabel('unknown')).toBeNull();
    expect(battleReportModeLabel(null)).toBeNull();
  });
});
