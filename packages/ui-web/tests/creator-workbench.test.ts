/**
 * `buildCreatorResultOverview` 原生性文案矩阵（G3-r1）：宿主传入
 * `signature` 事实后，概览区分「问卷原生许可」「通路签名能力」
 * 「已获官方签名」三层；未传入时维持按结果签名字段的既有语义（Web）。
 */
import { describe, expect, it } from 'vitest';

import {
  buildCreatorResultOverview,
  type CreatorResultSignatureFact,
  type CreatorWorkbenchSnapshot,
} from '../src/creator/workbench';

const snapshot = (over: Partial<CreatorWorkbenchSnapshot> = {}): CreatorWorkbenchSnapshot => ({
  generationMode: 'non-stream',
  template: 'magical-girl',
  templateLabel: '魔法少女（结构化）',
  primaryRuleLabel: '竞技场简化规则',
  questionCount: 3,
  nativeAllowed: true,
  overLimitCount: 0,
  streamFallbackLabel: '',
  ...over,
});

const signature = (over: Partial<CreatorResultSignatureFact> = {}): CreatorResultSignatureFact => ({
  capable: false,
  kind: 'unsigned',
  ...over,
});

describe('buildCreatorResultOverview signature-aware native hint (G3-r1)', () => {
  it('官方已签名的 hosted-json 结果记「具备原生性」', () => {
    const overview = buildCreatorResultOverview({
      isSubmitting: false,
      snapshot: snapshot(),
      result: { signature: 'sig' },
      signature: signature({ capable: true, kind: 'official-signed' }),
    });
    expect(overview.nativeHint).toBe('当前展示结果具备原生性');
  });

  it('含签名字段但本机未验证（草稿恢复等）如实记「未验证」，不冒充已签', () => {
    const overview = buildCreatorResultOverview({
      isSubmitting: false,
      snapshot: snapshot(),
      result: { signature: 'sig' },
      signature: signature({ capable: true, kind: 'signature-unverified' }),
    });
    expect(overview.nativeHint).toBe('结果含签名字段但本机未验证，按非原生处理');
  });

  it('可签名通路未带回签名记「签名失败已降级」（hosted-json 缺签名）', () => {
    const overview = buildCreatorResultOverview({
      isSubmitting: false,
      snapshot: snapshot(),
      result: {},
      signature: signature({ capable: true, kind: 'unsigned' }),
    });
    expect(overview.nativeHint).toBe('原生性签名失败，当前展示结果已降级为非原生');
  });

  it('不签名通路的无签名结果如实记「不支持官方签名」而非「签名失败」', () => {
    for (const result of [{}, null]) {
      const overview = buildCreatorResultOverview({
        isSubmitting: false,
        snapshot: snapshot(),
        result,
        signature: signature({ capable: false, kind: 'unsigned' }),
      });
      expect(overview.nativeHint).toBe('当前执行通路不支持官方签名，结果为非原生');
    }
  });

  it('不签名通路在生成中如实预告「结果将为非原生」', () => {
    const overview = buildCreatorResultOverview({
      isSubmitting: true,
      snapshot: snapshot(),
      result: null,
      signature: signature({ capable: false, kind: 'unsigned' }),
    });
    expect(overview.stageLabel).toBe('创作进行中');
    expect(overview.nativeHint).toBe('当前提交满足原生条件，但本通路不支持官方签名，结果将为非原生');
  });

  it('可签名通路在生成中维持「完成签名后将具备原生性」', () => {
    const overview = buildCreatorResultOverview({
      isSubmitting: true,
      snapshot: snapshot(),
      result: null,
      signature: signature({ capable: true, kind: 'unsigned' }),
    });
    expect(overview.nativeHint).toBe('当前提交满足原生条件，完成签名后将具备原生性');
  });

  it('问卷未获原生许可时签名事实不改变「非原生」结论', () => {
    const overview = buildCreatorResultOverview({
      isSubmitting: false,
      snapshot: snapshot({ nativeAllowed: false, overLimitCount: 2 }),
      result: { signature: 'sig' },
      signature: signature({ capable: true, kind: 'official-signed' }),
    });
    expect(overview.nativeHint).toBe('本次提交有 2 条答案超过字数上限，将生成非原生结果');
  });

  it('未传 signature 事实时维持按结果签名字段的既有语义（Web）', () => {
    expect(buildCreatorResultOverview({
      isSubmitting: false,
      snapshot: snapshot(),
      result: { signature: 'sig' },
    }).nativeHint).toBe('当前展示结果具备原生性');
    expect(buildCreatorResultOverview({
      isSubmitting: false,
      snapshot: snapshot(),
      result: {},
    }).nativeHint).toBe('原生性签名失败，当前展示结果已降级为非原生');
    expect(buildCreatorResultOverview({
      isSubmitting: true,
      snapshot: snapshot(),
      result: null,
    }).nativeHint).toBe('当前提交满足原生条件，完成签名后将具备原生性');
  });
});
