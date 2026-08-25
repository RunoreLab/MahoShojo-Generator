import React from 'react';
import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import CanshouCard from '@/components/CanshouCard';
import GeneralCharacterCard from '@/components/GeneralCharacterCard';
import MagicalGirlCard from '@/components/MagicalGirlCard';

const creatorMetadata = {
  creationInputs: {
    buildRules: [
      {
        ruleId: 'dnd-5e-lite',
        version: '1.0.0',
        blockResults: {
          level: '3',
          class: 'wizard',
          lineage: 'high-elf',
          abilityScores: {
            STR: 8,
            DEX: 14,
            CON: 14,
            INT: 16,
            WIS: 12,
            CHA: 10,
          },
          combatProfile: {
            armorClass: 13,
            hitPoints: 18,
            speed: 30,
            passivePerception: 11,
          },
        },
        derived: {
          proficiencyBonus: 2,
        },
        validationSummary: {
          valid: true,
          issues: [],
          missingRequiredBlockKeys: [],
        },
      },
    ],
  },
  buildState: {
    primaryRuleId: 'dnd-5e-lite',
    rules: [
      {
        ruleId: 'dnd-5e-lite',
        version: '1.0.0',
        blockResults: {
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
        derived: {
          proficiencyBonus: 3,
          spellcastingKind: 'full',
        },
        validationSummary: {
          valid: true,
          issues: [],
          missingRequiredBlockKeys: [],
        },
      },
    ],
  },
};

test('MagicalGirlCard 在存在 creator 规则元数据时渲染角色参数区块', () => {
  const html = renderToStaticMarkup(
    <MagicalGirlCard
      magicalGirl={{
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
          basicAbilities: ['照明', '雾化'],
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
          evolvedAbilities: ['折光', '静默'],
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
        ...creatorMetadata,
      }}
      gradientStyle="linear-gradient(135deg, #111827 0%, #1f2937 100%)"
    />
  );

  expect(html).toContain('角色参数');
  expect(html).toContain('DND 5e 经典角色卡');
});

test('GeneralCharacterCard 仅有单来源时不渲染双切换控件', () => {
  const html = renderToStaticMarkup(
    <GeneralCharacterCard
      general={{
        name: '巡夜人',
        content: '守望街区的人。',
        creationInputs: creatorMetadata.creationInputs,
      }}
    />
  );

  expect(html).toContain('角色参数 · 初始');
  expect(html).not.toContain('data-character-parameter-toggle');
});

test('CanshouCard 预接入角色参数区块', () => {
  const html = renderToStaticMarkup(
    <CanshouCard
      canshou={{
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
        buildState: creatorMetadata.buildState,
      }}
    />
  );

  expect(html).toContain('角色参数');
  expect(html).toContain('DND 5e 经典角色卡');
});
