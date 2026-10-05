import type { ComponentType, ReactNode } from 'react';

import type { ArenaHistory, CharacterCurrentState } from '@mahoshojo/domain/arena-types';

import type { MarkdownBlockProps } from '../markdown';
import type { SnapdomMediaAdapter } from '../client';

// ---------------------------------------------------------------------------
// 卡片宿主注入点
// ---------------------------------------------------------------------------

/**
 * 卡片内 Markdown 渲染组件。缺省使用共享 `MarkdownBlock`（站外媒体 DENY、
 * 普通 `<a>` 导航）；宿主注入自家包装（如 Web 的百科链接/白名单策略）即可。
 */
export type CharacterCardMarkdown = ComponentType<MarkdownBlockProps>;

/** 三张结果卡共用的宿主注入面。 */
export interface CharacterCardHostExtras {
  /** Markdown 渲染组件；缺省共享 `MarkdownBlock`。 */
  Markdown?: CharacterCardMarkdown;
  /** 「生成者」徽标等署名节点，渲染在截图导出的 logo 占位区。 */
  generatedByBadge?: ReactNode;
  /** 截图时的站外媒体内联策略；缺省 `DENY_SNAPDOM_MEDIA`（不发起站外请求）。 */
  captureMediaAdapter?: SnapdomMediaAdapter;
  /** 卡片顶部标题图地址；缺省 `/questionnaire-title.svg`。 */
  titleImageSrc?: string;
  /** 标题图 alt。 */
  titleImageAlt?: string;
  /** 截图导出时的二维码/Logo 图地址；缺省 `/logo-white-qrcode.svg`。 */
  qrCodeLogoSrc?: string;
  /** 顶部标题图的渲染方式；`svg` 用原生宽高属性，`fluid` 用 `w-72 mb-4` 类。 */
  titleImageVariant?: 'svg' | 'fluid';
}

export type CardImageSaveMode = 'auto' | 'modal' | 'download';

export interface CharacterCardCommonProps extends CharacterCardHostExtras {
  isStreaming?: boolean;
  onStopGeneration?: () => void;
  onSaveImage?: (imageUrl: string) => void;
  imageSaveMode?: CardImageSaveMode;
  saveButtonLabel?: string;
  portraitAsset?: CharacterCardPortraitAsset | null;
  /** 角色参数视图（由宿主经 buildCharacterParameterView 计算）；缺省不渲染参数区。 */
  parameterView?: CharacterParameterView | null;
}

// ---------------------------------------------------------------------------
// 立绘资产
// ---------------------------------------------------------------------------

export type CharacterCardPortraitSource = 'generated' | 'uploaded';

export interface CharacterCardPortraitAsset {
  imageUrl: string;
  source: CharacterCardPortraitSource;
  note?: string;
}

// ---------------------------------------------------------------------------
// 角色参数视图（由宿主侧 buildCharacterParameterView 产出）
// ---------------------------------------------------------------------------

export type CharacterParameterSourceKey = 'initial' | 'current';

export interface CharacterParameterEntry {
  key: string;
  label: string;
  value: string;
}

export interface CharacterParameterRuleSection {
  key: string;
  title: string;
  entries: CharacterParameterEntry[];
  note?: string;
}

export interface CharacterParameterRuleView {
  ruleId: string;
  title: string;
  version: string;
  sections: CharacterParameterRuleSection[];
  valid: boolean;
  statusLabel: string;
  issues: string[];
}

export interface CharacterParameterSourceView {
  key: CharacterParameterSourceKey;
  label: string;
  rules: CharacterParameterRuleView[];
}

export interface CharacterParameterView {
  activeSource: CharacterParameterSourceKey;
  sources: CharacterParameterSourceView[];
}

// ---------------------------------------------------------------------------
// 卡片数据形状
// ---------------------------------------------------------------------------

/** 魔法少女生成结果卡数据。 */
export interface MagicalGirlCardData {
  codename: string;
  appearance: {
    outfit: string;
    accessories: string;
    colorScheme: string;
    overallLook: string;
  };
  magicConstruct: {
    name: string;
    form: string | object;
    basicAbilities: Array<string | Record<string, unknown>> | string;
    description: string;
  };
  wonderlandRule: {
    name: string;
    description: string;
    tendency: string;
    activation: string;
  };
  blooming: {
    name: string | object;
    evolvedAbilities: string[] | string;
    evolvedForm: string;
    evolvedOutfit: string;
    powerLevel: string;
  };
  analysis: {
    personalityAnalysis: string;
    abilityReasoning: string;
    coreTraits: string[] | string;
    predictionBasis: string;
    background?: {
      belief: string;
      bonds: string;
    };
  };
  arena_history?: ArenaHistory;
  current_state?: CharacterCurrentState | null;
  creationInputs?: unknown;
  buildState?: unknown;
}

/** 残兽档案结果卡数据。 */
export interface CanshouDetails {
  name: string;
  coreConcept: string;
  coreEmotion: string;
  evolutionStage: string;
  appearance: string;
  materialAndSkin: string;
  featuresAndAppendages: string;
  attackMethod: string;
  specialAbility: string;
  origin: string;
  birthEnvironment: string;
  researcherNotes: string;
  arena_history?: ArenaHistory;
  current_state?: CharacterCurrentState | null;
  creationInputs?: unknown;
  buildState?: unknown;
}

/**
 * 通用角色结果卡数据（结构化 `GeneralCharacterData` 与裸 `{name, content}`
 * 形态的并集：名字与正文必填，其余字段宽松透传）。
 */
export interface GeneralCharacterCardData {
  name: string;
  content: string;
  arena_history?: ArenaHistory | null;
  current_state?: CharacterCurrentState | null;
  creationInputs?: unknown;
  buildState?: unknown;
  [key: string]: unknown;
}

/** 兼容别名：原 apps/web 的 `GeneralCharacterDetails`。 */
export type GeneralCharacterDetails = GeneralCharacterCardData;
