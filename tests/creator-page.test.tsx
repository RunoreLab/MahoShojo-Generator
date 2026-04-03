import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { BuildRulePanel } from '@/components/creator/BuildRulePanel';
import { BuildRulePicker } from '@/components/creator/BuildRulePicker';
import { BuildSummaryPanel } from '@/components/creator/BuildSummaryPanel';
import { CreatorAdvancedSidebarPanel } from '@/components/creator/CreatorAdvancedSidebarPanel';
import { FreeformBriefPanel } from '@/components/creator/FreeformBriefPanel';
import { CreatorMainStage } from '@/components/creator/CreatorMainStage';
import { CreatorSidebar } from '@/components/creator/CreatorSidebar';
import { CreatorWorkbenchLayout } from '@/components/creator/CreatorWorkbenchLayout';
import { TemplateSelector } from '@/components/creator/TemplateSelector';
import { CREATOR_PAGE_COPY } from '@/lib/creator/page-copy';
import { evaluateBuildRuleState } from '@/lib/creator/build-rule-runtime';
import { createDefaultBuildRuleInputs, loadBuildRulePresetById, loadBuildRulePresetIndex } from '@/lib/creator/build-rules';
import {
  DEFAULT_CREATOR_GENERATION_MODE,
  getDefaultCreatorTemplateForGenerationMode,
  isCreatorTemplateSupportedInGenerationMode,
  normalizeCreatorTemplateForGenerationMode,
} from '@/lib/creator/templates';

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
  expect(html).not.toContain('md:grid-cols-2');
  expect(html).toContain('data-creator-surface="panel"');
  expect(html).toContain('data-creator-surface="subpanel"');
});

test('FreeformBriefPanel 渲染自由补充说明输入区', () => {
  const html = renderToStaticMarkup(
    <FreeformBriefPanel value="" onChange={() => {}} />
  );

  expect(html).toContain('自由补充说明');
  expect(html).toContain('创作要求');
  expect(html).toContain('data-creator-surface="panel"');
  expect(html).toContain('data-creator-control="textarea"');
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
  expect(html).toContain('data-creator-surface="panel"');
  expect(html).toContain('data-creator-surface="subpanel"');
});

test('BuildRulePicker 展示 arena / dnd / coc 三套规则', () => {
  const html = renderToStaticMarkup(
    <BuildRulePicker
      presets={loadBuildRulePresetIndex()}
      selectedRuleIds={['dnd-5e-lite']}
      primaryRuleId="dnd-5e-lite"
      onToggleRule={() => {}}
      onSelectPrimaryRule={() => {}}
    />
  );

  expect(html).toContain('魔法少女竞技场 TRPG 简化角色卡');
  expect(html).toContain('DND 5e 经典角色卡');
  expect(html).toContain('CoC 7e 经典调查员卡');
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
  expect(html).toContain('data-creator-surface="panel"');
  expect(html).toContain('data-creator-surface="subpanel"');
  expect(html).toContain('data-creator-control="field"');
});

test('BuildRulePanel 能渲染 stat-array 与 number-group', () => {
  const preset = loadBuildRulePresetById('dnd-5e-lite');
  const html = renderToStaticMarkup(
    <BuildRulePanel
      preset={preset}
      inputs={createDefaultBuildRuleInputs('dnd-5e-lite')}
      onChange={() => {}}
    />
  );

  expect(html).toContain('力量');
  expect(html).toContain('护甲等级');
  expect(html).toContain('data-creator-control="field"');
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
  expect(html).toContain('data-creator-surface="panel"');
  expect(html).toContain('data-creator-surface="subpanel"');
});

test('BuildSummaryPanel 能展示 DND 的熟练加值与施法类型摘要', () => {
  const runtimeResult = evaluateBuildRuleState({
    ruleId: 'dnd-5e-lite',
    inputs: {
      level: '5',
      class: 'wizard',
      lineage: 'high-elf',
      abilityScores: {
        STR: 8,
        DEX: 14,
        CON: 14,
        INT: 18,
        WIS: 12,
        CHA: 10,
      },
      combatProfile: {
        armorClass: 15,
        hitPoints: 32,
        speed: 30,
        passivePerception: 11,
      },
    },
  });

  const html = renderToStaticMarkup(
    <BuildSummaryPanel runtimeResult={runtimeResult} />
  );

  expect(html).toContain('熟练加值');
  expect(html).toContain('完整施法');
});

test('BuildRulePanel 在专长预算不足时禁用超预算的未选专长', () => {
  const preset = loadBuildRulePresetById('arena-trpg-lite');
  const inputs = {
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
    specialties: ['magic-bullet', 'mana-impact', 'body-enhancement', 'hover'],
  };
  const runtimeResult = evaluateBuildRuleState({
    ruleId: 'arena-trpg-lite',
    inputs,
  });

  const html = renderToStaticMarkup(
    <BuildRulePanel
      preset={preset}
      inputs={inputs}
      runtimeResult={runtimeResult}
      onChange={() => {}}
    />
  );

  expect(html).toContain('data-specialty-id="magic-shield"');
  expect(html).toContain('data-specialty-budget-state="insufficient"');
  expect(html).toContain('点数不足');
});

test('BuildRulePanel 在属性超预算时于属性区立即显示错误提示', () => {
  const preset = loadBuildRulePresetById('arena-trpg-lite');
  const inputs = {
    powerLevel: 'seed',
    coreAttributes: {
      STR: 80,
      CON: 80,
      AGI: 80,
      MAG: 80,
      WILL: 80,
      PER: 80,
      CHM: 80,
    },
    specialties: [],
  };
  const runtimeResult = evaluateBuildRuleState({
    ruleId: 'arena-trpg-lite',
    inputs,
  });

  const html = renderToStaticMarkup(
    <BuildRulePanel
      preset={preset}
      inputs={inputs}
      runtimeResult={runtimeResult}
      onChange={() => {}}
    />
  );

  expect(html).toContain('data-core-attributes-budget-state="over-budget"');
  expect(html).toContain('属性点超出预算');
  expect(html).toContain('已超出 280 点上限');
});

test('CreatorAdvancedSidebarPanel 使用统一的工作台子卡片外观', () => {
  const html = renderToStaticMarkup(
    <CreatorAdvancedSidebarPanel
      tokenEstimateText="一段示例输入"
      selectedLanguage="zh-CN"
      languages={[
        { code: 'zh-CN', name: '简体中文' },
        { code: 'en', name: 'English' },
      ]}
      showLanguageSection
      onToggleLanguageSection={() => {}}
      onChangeLanguage={() => {}}
      generationMode="stream"
      submitting={false}
      onChangeGenerationMode={() => {}}
      generationHint="提示：这里显示生成方式说明。"
      onConfigChange={() => {}}
      providerCooldownMode="system"
      isCooldown={false}
      otherRemainingTime={0}
      showBulkFillSection
      onToggleBulkFillSection={() => {}}
      bulkAnswers=""
      onChangeBulkAnswers={() => {}}
      onBulkFill={() => {}}
      onClearDraft={() => {}}
    />
  );

  expect(html).toContain('data-creator-advanced-card="language"');
  expect(html).toContain('data-creator-advanced-card="generation-mode"');
  expect(html).toContain('data-creator-advanced-card="provider"');
  expect(html).toContain('data-creator-advanced-card="bulk-fill"');
  expect(html).toContain('data-creator-surface="subpanel"');
});

test('general-scenario 模板允许流式创作模式', () => {
  expect(isCreatorTemplateSupportedInGenerationMode('stream', 'general-scenario')).toBe(true);
});

test('creator 默认模板与生成模式组合始终受支持', () => {
  const nonStreamDefault = getDefaultCreatorTemplateForGenerationMode('non-stream');
  const streamDefault = getDefaultCreatorTemplateForGenerationMode('stream');

  expect(DEFAULT_CREATOR_GENERATION_MODE).toBe('stream');
  expect(nonStreamDefault).toBe('magical-girl');
  expect(streamDefault).toBe('general');
  expect(streamDefault).not.toBe(nonStreamDefault);
  expect(isCreatorTemplateSupportedInGenerationMode('non-stream', nonStreamDefault)).toBe(true);
  expect(isCreatorTemplateSupportedInGenerationMode('stream', streamDefault)).toBe(true);
  expect(normalizeCreatorTemplateForGenerationMode('stream', 'magical-girl')).toBe('general');
  expect(normalizeCreatorTemplateForGenerationMode('non-stream', 'general')).toBe('magical-girl');
});

test('creator workbench 组合同时暴露左栏与主区标题', () => {
  const html = renderToStaticMarkup(
    <CreatorWorkbenchLayout
      layoutMode="desktop"
      sidebar={
        <CreatorSidebar
          layoutMode="desktop"
          stage="intro"
          overview={<div>概况内容</div>}
          configuration={<div>配置内容</div>}
          buildRules={<div>规则内容</div>}
          advanced={<div>高级内容</div>}
        />
      }
      main={(
        <CreatorMainStage
          stage="intro"
          title={CREATOR_PAGE_COPY.headTitle}
          topContent={<div>问卷与作答</div>}
          content={<div>开始创作</div>}
        />
      )}
    />
  );

  expect(html).toContain(CREATOR_PAGE_COPY.headTitle);
  expect(html).toContain('创作概况');
  expect(html).toContain('车卡规则');
  expect(html).toContain('问卷与作答');
  expect(html).toContain('开始创作');
});
