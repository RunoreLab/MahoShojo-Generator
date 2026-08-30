import { GENERAL_CHARACTER_TEMPLATE_ID, type GeneralCharacterData } from '@/lib/schemas';

interface WantuDataCardDomain {
  kind: string;
  status: string;
  value: unknown;
}

interface WantuDataCardSkill {
  id?: string;
  kind?: string;
  index?: number;
  name?: string;
  description?: string;
  activationLine?: string;
}

interface WantuDataCardVoiceline {
  id?: string;
  kind?: string;
  index?: number;
  text?: string;
}

interface WantuDataCardVoicelineData {
  lines?: WantuDataCardVoiceline[];
  casts?: unknown[];
}

interface WantuDataCardNarrowed {
  format: string;
  card: {
    name?: string;
    domains?: Record<string, WantuDataCardDomain>;
    [key: string]: unknown;
  };
  assets?: unknown[];
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isWantuDataCard(input: unknown): input is WantuDataCardNarrowed {
  if (!isRecord(input)) return false;
  if (input.format !== 'wantu-data-card') return false;
  return isRecord(input.card);
}

function readDomainMarkdown(domains: Record<string, WantuDataCardDomain> | undefined, key: string): string {
  if (!domains) return '';
  const domain = domains[key];
  if (!domain || typeof domain.value !== 'string') return '';
  return domain.value.trim();
}

function formatSkillsAsMarkdown(skills: WantuDataCardSkill[]): string {
  if (skills.length === 0) return '';
  const kindLabels: Record<string, string> = {
    normal: '普通技能',
    skill: '战技',
    ultimate: '终结技',
    passive: '被动技能',
  };

  return skills
    .filter((s) => s.name)
    .map((skill) => {
      const label = kindLabels[skill.kind ?? ''] ?? '技能';
      const parts = [`**${label}：${skill.name}**`];
      if (skill.description) parts.push(skill.description);
      if (skill.activationLine) parts.push(`> 台词：${skill.activationLine}`);
      return parts.join('\n');
    })
    .join('\n\n');
}

function formatVoicelinesAsMarkdown(data: WantuDataCardVoicelineData): string {
  const lines = data.lines;
  if (!Array.isArray(lines) || lines.length === 0) return '';

  return lines
    .filter((l) => l.text)
    .map((line) => {
      const kindLabels: Record<string, string> = {
        obtain: '获取',
        duplicate: '重复获取',
        'home-display': '看板',
        'greeting-morning': '早安',
        'greeting-noon': '午安',
        'greeting-evening': '晚安',
        dialogue: '对话',
        idle: '闲置',
        'level-up': '升级',
        'exclusive-equipment': '专属装备',
        'join-team': '入队',
        'appoint-leader': '任命队长',
        selected: '选中',
        attack: '攻击',
        hit: '受击',
        kill: '击杀',
        'ally-defeated': '队友战败',
        'perfect-victory': '完美胜利',
        victory: '胜利',
        defeat: '战败',
        'character-birthday': '角色生日',
        'user-birthday': '玩家生日',
        'new-year': '新年',
      };
      const label = kindLabels[line.kind ?? ''] ?? line.kind ?? '语音';
      return `> **${label}**：${line.text}`;
    })
    .join('\n');
}

export function convertWantuDataCardToGeneralCharacter(input: unknown): GeneralCharacterData | null {
  if (!isWantuDataCard(input)) return null;
  const card = input.card!;
  const domains = card.domains;

  const name = typeof card.name === 'string' ? card.name.trim() : '';
  if (!name) return null;

  const sections: string[] = [];

  const contentMd = readDomainMarkdown(domains, 'content');
  if (contentMd) sections.push(contentMd);

  const appearanceMd = readDomainMarkdown(domains, 'appearance');
  if (appearanceMd) sections.push(appearanceMd);

  const skillsDomain = domains?.skills;
  if (skillsDomain && Array.isArray(skillsDomain.value)) {
    const skillsMd = formatSkillsAsMarkdown(skillsDomain.value as WantuDataCardSkill[]);
    if (skillsMd) sections.push(skillsMd);
  }

  const voicelinesDomain = domains?.voicelines;
  if (voicelinesDomain && isRecord(voicelinesDomain.value)) {
    const voicelinesMd = formatVoicelinesAsMarkdown(voicelinesDomain.value as WantuDataCardVoicelineData);
    if (voicelinesMd) sections.push(voicelinesMd);
  }

  const content = sections.join('\n\n---\n\n');
  if (!content) return null;

  return {
    templateId: GENERAL_CHARACTER_TEMPLATE_ID,
    name,
    content,
  } as GeneralCharacterData;
}

export function convertWantuDataCardToArenaMaterialPayload(
  input: unknown
): { name: string; content: Record<string, unknown> } | null {
  if (!isWantuDataCard(input)) return null;
  const card = input.card!;
  const domains = card.domains;

  const name = typeof card.name === 'string' ? card.name.trim() : '';
  if (!name) return null;

  const content: Record<string, unknown> = {};
  const domainsRecord = (domains ?? {}) as Record<string, WantuDataCardDomain>;

  for (const key of Object.keys(domainsRecord)) {
    const domain = domainsRecord[key];
    if (domain.kind === 'stream-markdown' && typeof domain.value === 'string') {
      content[key] = domain.value;
    } else if (domain.kind === 'structured-json') {
      content[key] = domain.value;
    } else if (domain.kind === 'image' && isRecord(domain.value)) {
      content[key] = { assetId: domain.value.assetId, fileName: domain.value.fileName };
    }
  }

  if (input.assets && Array.isArray(input.assets)) {
    content._assetCount = input.assets.length;
  }

  return { name, content };
}
