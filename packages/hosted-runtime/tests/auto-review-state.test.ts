import { MAX_DATA_CARD_BYTES } from '@mahoshojo/domain/data-card-size';
import {
  AUTO_REVIEW_STATE_MAX,
  buildAutoReviewState,
  extractAutoReviewContent,
  type AutoReviewState,
  type ReviewTarget,
} from '@mahoshojo/hosted-runtime/auto-review';
import { describe, expect, it, vi } from 'vitest';

const target: ReviewTarget = {
  id: 'card-1',
  name: '测试卡',
  description: '测试简介',
  type: 'character',
  data: '{}',
};

const completeCoverage = { truncated: false, parseError: false };
const incompleteCoverage = { truncated: true, parseError: false };
const header = '数据卡名称: 测试卡\n数据卡简介: 测试简介\n数据卡类型: character\n---- 卡内容 ----\n';

describe('自动审核输入提取', () => {
  it('完整保留长字段、数组尾部、深层内容和自定义键', () => {
    const data = JSON.stringify({
      bio: '星'.repeat(300) + '长字段尾部',
      lines: Array.from({ length: 55 }, (_, index) => '夜'.repeat(260) + `第${index}项尾部`),
      nested: Array.from({ length: 10 }).reduce<unknown>((child) => ({ custom: [child] }), '深层字段尾部'),
      manyFields: Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`field${index}`, `字段${index}尾部`])),
      _author: '自定义作者字段',
      system: '自定义系统字段',
      ['__proto__']: '自定义原型同名字段',
    });
    const name = '名'.repeat(300) + '名称尾部';
    const description = '简'.repeat(300) + '简介尾部';
    const card = { ...target, name, description, data };

    expect(data.length).toBeGreaterThan(12_000);
    expect(extractAutoReviewContent(card)).toEqual({ text: data, coverage: completeCoverage });
    expect(buildAutoReviewState(card)).toEqual({
      text: `数据卡名称: ${name}\n数据卡简介: ${description}\n数据卡类型: character\n---- 卡内容 ----\n${data}`,
      coverage: completeCoverage,
    });
  });

  it('展开 JSON 中的 Unicode 转义并保留实际的反斜杠和换行内容', () => {
    const data = String.raw`{"\u89D2\u8272":"\u6D4B\u8BD5 \uD83C\uDF19 末尾","literal":"\\u6D4B\n\"实际文本尾部\""}`;
    const result = extractAutoReviewContent({ ...target, data });

    expect(result.coverage).toEqual(completeCoverage);
    expect(result.text).toContain('"角色":"测试 🌙 末尾"');
    expect(JSON.parse(result.text)).toEqual({ 角色: '测试 🌙 末尾', literal: '\\u6D4B\n"实际文本尾部"' });
  });

  it('保留恰好达到上传上限的正文', () => {
    expect(AUTO_REVIEW_STATE_MAX).toBe(MAX_DATA_CARD_BYTES);
    const data = '"' + 'x'.repeat(MAX_DATA_CARD_BYTES - 2) + '"';

    expect(extractAutoReviewContent({ ...target, data })).toEqual({ text: data, coverage: completeCoverage });
  });

  it('正文的 UTF-8 字节数超过上传上限时不输出部分正文', () => {
    const data = JSON.stringify({ content: '文'.repeat(Math.ceil(MAX_DATA_CARD_BYTES / 3)) });
    const card = { ...target, data };

    expect(data.length).toBeLessThan(MAX_DATA_CARD_BYTES);
    expect(extractAutoReviewContent(card)).toEqual({ text: '', coverage: incompleteCoverage });
    expect(buildAutoReviewState(card)).toEqual({ text: header, coverage: incompleteCoverage });
  });

  it.each(['', '{"content":'])('非法 JSON 报告解析错误（%j）', (data) => {
    const card = { ...target, data };
    const coverage = { truncated: true, parseError: true };

    expect(extractAutoReviewContent(card)).toEqual({ text: '', coverage });
    expect(buildAutoReviewState(card)).toEqual({ text: header, coverage });
  });

  it('序列化深层正文抛错时保留元数据并标记覆盖不完整', () => {
    const data = '['.repeat(12_000) + '"深层正文"' + ']'.repeat(12_000);
    const stringify = vi.spyOn(JSON, 'stringify').mockImplementationOnce(() => {
      throw new RangeError('Maximum call stack size exceeded');
    });

    let result: AutoReviewState;
    try {
      result = buildAutoReviewState({ ...target, data });
    } finally {
      stringify.mockRestore();
    }

    expect(result).toEqual({ text: header, coverage: incompleteCoverage });
  });
});
