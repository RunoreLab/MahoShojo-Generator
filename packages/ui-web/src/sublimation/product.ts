import { SUBLIMATION_TEMPLATE_LABELS, type SublimationCharacterTemplate } from '@mahoshojo/domain/sublimation';

export type SupportedTargetTemplate = SublimationCharacterTemplate;

export const TARGET_TEMPLATE_OPTIONS: SupportedTargetTemplate[] = ['magical-girl', 'canshou', 'general'];

export const TARGET_TEMPLATE_LABELS: Record<SupportedTargetTemplate, string> = {
    'magical-girl': SUBLIMATION_TEMPLATE_LABELS['magical-girl'],
    'canshou': SUBLIMATION_TEMPLATE_LABELS['canshou'],
    'general': SUBLIMATION_TEMPLATE_LABELS['general'],
};

// [新增] 定义可配置的字段及其显示名称
export const PRESERVABLE_FIELDS_CONFIG: Record<SupportedTargetTemplate, { id: string; label: string }[]> = {
    'magical-girl': [
        { id: 'appearance', label: '外观' },
        { id: 'magicConstruct', label: '魔装' },
        { id: 'wonderlandRule', label: '奇境' },
        { id: 'blooming', label: '繁开' },
        { id: 'analysis', label: '分析' },
        { id: 'userAnswers', label: '问卷答案' },
    ],
    'canshou': [
        { id: 'appearance', label: '外貌形态' },
        { id: 'coreConcept', label: '核心概念' },
        { id: 'coreEmotion', label: '核心情感' },
        { id: 'materialAndSkin', label: '材质表皮' },
        { id: 'featuresAndAppendages', label: '特征附属' },
        { id: 'attackMethod', label: '攻击方式' },
        { id: 'specialAbility', label: '特殊能力' },
        { id: 'origin', label: '起源' },
        { id: 'birthEnvironment', label: '诞生环境' },
        { id: 'researcherNotes', label: '研究员笔记' },
        { id: 'userAnswers', label: '问卷答案' },
    ],
    'general': [
        { id: 'name', label: '角色名称' },
        { id: 'content', label: '完整设定（content）' }
    ]
};

export const FIELD_PRESET_CONFIG: Record<SupportedTargetTemplate, { default: string[]; personality: string[] }> = {
    'magical-girl': {
        default: ['wonderlandRule', 'blooming'],
        personality: ['appearance', 'magicConstruct', 'wonderlandRule', 'blooming']
    },
    'canshou': {
        default: [],
        personality: ['appearance', 'materialAndSkin', 'featuresAndAppendages', 'attackMethod', 'specialAbility']
    },
    'general': {
        default: [],
        personality: ['name']
    }
};

export const getDefaultPreserveFields = (target: SupportedTargetTemplate) => [...FIELD_PRESET_CONFIG[target].default];
export const getPersonalityPreset = (target: SupportedTargetTemplate) => [...FIELD_PRESET_CONFIG[target].personality];
