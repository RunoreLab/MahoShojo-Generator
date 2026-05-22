import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import BattleReportCard, { type NewsReport } from '@/components/BattleReportCard';
import CanshouCard from '@/components/CanshouCard';
import GeneralCharacterCard from '@/components/GeneralCharacterCard';
import MagicalGirlCard from '@/components/MagicalGirlCard';
import StreamingBattleReportCard from '@/components/stream/StreamingBattleReportCard';

const noop = () => undefined;

const report: NewsReport = {
  headline: '破晓战报',
  reporterInfo: {
    name: '记者',
    publication: '魔法少女速报',
  },
  article: {
    body: '正文',
    analysis: '点评',
  },
  officialReport: {
    winner: '月咏',
    conclusion: '胜利',
  },
};

const magicalGirl = {
  codename: '雾灯',
  appearance: {
    outfit: '校服与斗篷',
    accessories: '银色挂坠',
    colorScheme: '靛蓝',
    overallLook: '冷清',
  },
  magicConstruct: {
    name: '雾灯杖',
    form: '法杖',
    basicAbilities: ['照明'],
    description: '能让视线折返。',
  },
  wonderlandRule: {
    name: '回声街',
    description: '每句话都会留下回音。',
    tendency: '迟滞',
    activation: '深夜',
  },
  blooming: {
    name: '夜巡',
    evolvedAbilities: ['折光'],
    evolvedForm: '薄雾',
    evolvedOutfit: '长披风',
    powerLevel: '高',
  },
  analysis: {
    personalityAnalysis: '克制',
    abilityReasoning: '倾向空间控制',
    coreTraits: ['冷静'],
    predictionBasis: '长期独处',
  },
};

const canshou = {
  name: '碎镜',
  coreConcept: '反照',
  coreEmotion: '嫉妒',
  evolutionStage: '蛹',
  appearance: '如破碎的镜面拼接而成',
  materialAndSkin: '玻璃与湿膜',
  featuresAndAppendages: '背部长出镜片',
  attackMethod: '折返光束',
  specialAbility: '反射认知',
  origin: '废弃商场',
  birthEnvironment: '长期无光',
  researcherNotes: '避免直视',
};

describe('输出卡片停止生成按钮', () => {
  test('流式战报卡片在生成中显示停止生成按钮', () => {
    const html = renderToStaticMarkup(
      <StreamingBattleReportCard content="# 破晓战报\n正文" isStreaming onStopGeneration={noop} />
    );

    expect(html).toContain('停止生成');
  });

  test('非流式战报卡片只有在生成中且存在中止回调时显示停止生成按钮', () => {
    const idleHtml = renderToStaticMarkup(<BattleReportCard report={report} />);
    const streamingHtml = renderToStaticMarkup(<BattleReportCard report={report} isStreaming onStopGeneration={noop} />);

    expect(idleHtml).not.toContain('停止生成');
    expect(streamingHtml).toContain('停止生成');
  });

  test('三种角色卡片在生成中显示停止生成按钮', () => {
    const magicalGirlHtml = renderToStaticMarkup(
      <MagicalGirlCard
        magicalGirl={magicalGirl}
        gradientStyle="linear-gradient(135deg, #111827 0%, #1f2937 100%)"
        isStreaming
        onStopGeneration={noop}
      />
    );
    const canshouHtml = renderToStaticMarkup(<CanshouCard canshou={canshou} isStreaming onStopGeneration={noop} />);
    const generalHtml = renderToStaticMarkup(
      <GeneralCharacterCard general={{ name: '巡夜人', content: '守望街区的人。' }} isStreaming onStopGeneration={noop} />
    );

    expect(magicalGirlHtml).toContain('停止生成');
    expect(canshouHtml).toContain('停止生成');
    expect(generalHtml).toContain('停止生成');
  });
});
