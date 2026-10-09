export type QuestionnaireLogoPreset = {
  id: string;
  label: string;
  url: string;
  kind: QuestionnaireKind | 'common';
};

import type { QuestionnaireKind } from './questionnaire-definition';

export const DEFAULT_QUESTIONNAIRE_LOGO_BY_KIND: Record<QuestionnaireKind, string> = {
  'magical-girl': '/questionnaire-logo.svg',
  'canshou': '/beast-logo.svg',
};

export const QUESTIONNAIRE_LOGO_PRESETS: QuestionnaireLogoPreset[] = [
  {
    id: 'magical-girl-default',
    label: '魔法少女预设问卷（默认）',
    url: '/questionnaire-logo.svg',
    kind: 'magical-girl',
  },
  {
    id: 'magical-girl-title',
    label: '魔法少女问卷标题',
    url: '/questionnaire-title.svg',
    kind: 'magical-girl',
  },
  {
    id: 'canshou-default',
    label: '残兽预设问卷',
    url: '/beast-logo.svg',
    kind: 'canshou',
  },
  {
    id: 'canshou-title',
    label: '残兽问卷标题',
    url: '/beast-title.svg',
    kind: 'canshou',
  },
  {
    id: 'project-logo',
    label: '项目 Logo',
    url: '/logo.svg',
    kind: 'common',
  },
  {
    id: 'project-logo-white',
    label: '项目 Logo（白色）',
    url: '/logo-white.svg',
    kind: 'common',
  },
];

