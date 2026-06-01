import type { CanshouData, MagicalGirlData } from '@/lib/schemas';

type LabelMap = Record<string, string>;

const MAGICAL_APPEARANCE_LABELS: LabelMap = {
  outfit: '服装',
  accessories: '配饰',
  colorScheme: '色彩',
  overallLook: '整体印象',
};

const MAGICAL_CONSTRUCT_LABELS: LabelMap = {
  name: '名称',
  form: '形态',
  basicAbilities: '基础能力',
  description: '描述',
};

const WONDERLAND_RULE_LABELS: LabelMap = {
  name: '名称',
  description: '描述',
  tendency: '倾向',
  activation: '发动方式',
};

const BLOOMING_LABELS: LabelMap = {
  name: '名称',
  evolvedAbilities: '进化能力',
  evolvedForm: '进化形态',
  evolvedOutfit: '进化服装',
  powerLevel: '力量层级',
};

const ANALYSIS_LABELS: LabelMap = {
  personalityAnalysis: '性格分析',
  abilityReasoning: '能力推演',
  coreTraits: '核心特质',
  predictionBasis: '预测依据',
  background: '背景',
};

const BACKGROUND_LABELS: LabelMap = {
  belief: '信念',
  bonds: '羁绊',
};

const CANSHOU_LABELS: LabelMap = {
  appearance: '外观',
  materialAndSkin: '材质与表皮',
  featuresAndAppendages: '特征与附肢',
  coreConcept: '核心概念',
  coreEmotion: '核心情绪',
  evolutionStage: '进化阶段',
  attackMethod: '攻击方式',
  specialAbility: '特殊能力',
  origin: '起源',
  birthEnvironment: '诞生环境',
  researcherNotes: '研究员注记',
};

export function renderMagicalGirlCardMarkdown(data: MagicalGirlData): string {
  const title = textOrFallback(data.codename, '未命名魔法少女');
  const sections = [
    renderSection('外观', data.appearance, MAGICAL_APPEARANCE_LABELS),
    renderSection('魔法构装', data.magicConstruct, MAGICAL_CONSTRUCT_LABELS),
    renderSection('仙境规则', data.wonderlandRule, WONDERLAND_RULE_LABELS),
    renderSection('Blooming', data.blooming, BLOOMING_LABELS),
    renderAnalysisSection(data.analysis),
  ].filter(Boolean);

  return [`# ${title}`, ...sections].join('\n\n').trim();
}

export function renderCanshouCardMarkdown(data: CanshouData): string {
  const title = textOrFallback(data.name, '未命名残兽');
  const sections = Object.entries(CANSHOU_LABELS)
    .map(([key, label]) => renderSection(label, (data as Record<string, unknown>)[key]))
    .filter(Boolean);

  return [`# ${title}`, ...sections].join('\n\n').trim();
}

function renderAnalysisSection(value: MagicalGirlData['analysis']): string {
  if (!isRecord(value)) return '';
  const mainLines = renderRecordLines(value, ANALYSIS_LABELS, ['background']);
  const background = isRecord(value.background)
    ? renderRecordLines(value.background, BACKGROUND_LABELS)
    : [];
  const lines = [...mainLines];
  if (background.length > 0) {
    lines.push('- 背景：');
    lines.push(...background.map(line => `  ${line}`));
  }
  return lines.length > 0 ? `## 分析\n${lines.join('\n')}` : '';
}

function renderSection(title: string, value: unknown, labels: LabelMap = {}): string {
  if (!isPresent(value)) return '';
  if (!isRecord(value)) {
    const body = renderValue(value);
    return body ? `## ${title}\n${body}` : '';
  }
  const lines = renderRecordLines(value, labels);
  return lines.length > 0 ? `## ${title}\n${lines.join('\n')}` : '';
}

function renderRecordLines(
  record: Record<string, unknown>,
  labels: LabelMap,
  excludedKeys: string[] = []
): string[] {
  const excluded = new Set(excludedKeys);
  return Object.entries(record).flatMap(([key, value]) => {
    if (excluded.has(key) || !isPresent(value)) return [];
    const label = labels[key] ?? key;
    if (Array.isArray(value)) {
      const items = value.map(item => renderValue(item)).filter(Boolean);
      if (items.length === 0) return [];
      return [`- ${label}：`, ...items.map(item => `  - ${item}`)];
    }
    if (isRecord(value)) {
      const nested = renderRecordLines(value, {});
      if (nested.length === 0) return [];
      return [`- ${label}：`, ...nested.map(line => `  ${line}`)];
    }
    const rendered = renderValue(value);
    return rendered ? [`- ${label}：${rendered}`] : [];
  });
}

function renderValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map(item => renderValue(item)).filter(Boolean).join('、');
  }
  if (isRecord(value)) {
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return '';
}

function textOrFallback(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
