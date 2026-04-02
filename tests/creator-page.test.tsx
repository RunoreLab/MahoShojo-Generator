import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { BuildRulePanel } from '@/components/creator/BuildRulePanel';
import { BuildRulePicker } from '@/components/creator/BuildRulePicker';
import { BuildSummaryPanel } from '@/components/creator/BuildSummaryPanel';
import { FreeformBriefPanel } from '@/components/creator/FreeformBriefPanel';
import { TemplateSelector } from '@/components/creator/TemplateSelector';
import { CREATOR_PAGE_COPY } from '@/lib/creator/page-copy';
import { evaluateBuildRuleState } from '@/lib/creator/build-rule-runtime';
import { loadBuildRulePresetById, loadBuildRulePresetIndex } from '@/lib/creator/build-rules';
import { isCreatorTemplateSupportedInGenerationMode } from '@/lib/creator/templates';

test('TemplateSelector 显示 5 个模板并标出流式边界', () => {
  const html = renderToStaticMarkup(
    <TemplateSelector value="general" onChange={() => {}} />
  );

  expect(html).toContain('魔法少女（结构化）');
  expect(html).toContain('残兽（结构化）');
  expect(html).toContain('通用角色卡（Markdown）');
  expect(html).toContain('情景（结构化）');
  expect(html).toContain('通用情景卡（Markdown）');
  expect(html).toContain('支持流式');
});

test('FreeformBriefPanel 渲染自由补充说明输入区', () => {
  const html = renderToStaticMarkup(
    <FreeformBriefPanel value="" onChange={() => {}} />
  );

  expect(html).toContain('自由补充说明');
  expect(html).toContain('创作要求');
});

test('BuildRulePicker 展示可选规则与主规则入口', () => {
  const html = renderToStaticMarkup(
    <BuildRulePicker
      presets={loadBuildRulePresetIndex()}
      selectedRuleIds={['arena-trpg-lite']}
      primaryRuleId="arena-trpg-lite"
      onToggleRule={() => {}}
      onSelectPrimaryRule={() => {}}
    />
  );

  expect(html).toContain('魔法少女竞技场 TRPG 简化角色卡');
  expect(html).toContain('主规则');
});

test('BuildRulePanel 渲染力量层级、属性与基础能力专长', () => {
  const preset = loadBuildRulePresetById('arena-trpg-lite');
  const html = renderToStaticMarkup(
    <BuildRulePanel
      preset={preset}
      inputs={{
        powerLevel: 'seed',
        coreAttributes: {
          STR: 40,
          CON: 40,
          AGI: 40,
          MAG: 40,
          WILL: 40,
          PER: 40,
          CHM: 40,
        },
        specialties: [],
      }}
      onChange={() => {}}
    />
  );

  expect(html).toContain('力量层级');
  expect(html).toContain('核心属性');
  expect(html).toContain('基础能力专长');
  expect(html).toContain('魔弹');
});

test('BuildSummaryPanel 展示属性预算、专长预算与派生值', () => {
  const runtimeResult = evaluateBuildRuleState({
    ruleId: 'arena-trpg-lite',
    inputs: {
      powerLevel: 'seed',
      coreAttributes: {
        STR: 40,
        CON: 40,
        AGI: 40,
        MAG: 40,
        WILL: 40,
        PER: 40,
        CHM: 40,
      },
      specialties: ['magic-bullet'],
    },
  });

  const html = renderToStaticMarkup(
    <BuildSummaryPanel runtimeResult={runtimeResult} />
  );

  expect(html).toContain('HP');
  expect(html).toContain('Radiance');
  expect(html).toContain('属性点');
  expect(html).toContain('专长点');
});

test('general-scenario 模板允许流式创作模式', () => {
  expect(isCreatorTemplateSupportedInGenerationMode('stream', 'general-scenario')).toBe(true);
});

test('creator 页文案不再沿用旧 details 问卷措辞', () => {
  expect(CREATOR_PAGE_COPY.headTitle).toBe('创作工房');
  expect(CREATOR_PAGE_COPY.heroTitle).toContain('从问卷、规则与补充说明生成角色或情景');
  expect(CREATOR_PAGE_COPY.headTitle).not.toContain('奇妙妖精大调查');
  expect(CREATOR_PAGE_COPY.heroTitle).not.toContain('魔法少女道路上的潜力和表现');
  expect(CREATOR_PAGE_COPY.heroBody).not.toContain('《下班，然后变成魔法少女》');
});
