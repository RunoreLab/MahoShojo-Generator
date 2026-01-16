import type {
  MagicTavernMessage,
  MagicTavernOutputSegment,
  MagicTavernRole,
  MagicTavernScenario,
  MagicTavernSession,
  MagicTavernTachieAsset,
} from '@/lib/magic-tavern/types';

export type MagicTavernSessionExport = {
  schema: 'magic-tavern.session.v1';
  exportedAt: string;
  appVersion?: string;
  session: Omit<MagicTavernSession, 'roles' | 'scenario' | 'auxScenarios'>;
  roles: MagicTavernRole[];
  scenario: MagicTavernScenario | null;
  auxScenarios: MagicTavernScenario[];
  messages: MagicTavernMessage[];
  tachieAssets: MagicTavernTachieAsset[];
};

export type MagicTavernArchiveExport = {
  schema: 'magic-tavern.archive.v1';
  exportedAt: string;
  appVersion?: string;
  sessions: MagicTavernSessionExport[];
};

type ParseJsonlResult = {
  messages: MagicTavernMessage[];
  warnings: string[];
};

const readString = (value: unknown): string => (typeof value === 'string' ? value : '').trim();

const isNumberLike = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const parseTimestamp = (value: unknown, fallback: number): number => {
  if (isNumberLike(value)) {
    return value > 1e12 ? value : value * 1000;
  }
  const raw = readString(value);
  if (!raw) return fallback;
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) {
    return numeric > 1e12 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeSpeakerName = (payload: Record<string, unknown>): string => {
  return (
    readString(payload.name) ||
    readString(payload.character) ||
    readString(payload.character_name) ||
    readString(payload.speaker)
  );
};

const buildPlainTextFromSegments = (
  segments: MagicTavernOutputSegment[] | undefined,
  roleNameLookup?: (roleId: string) => string
): string => {
  if (!Array.isArray(segments) || segments.length === 0) return '';
  const lines: string[] = [];
  for (const seg of segments) {
    if (!seg) continue;
    if (seg.type === 'narration') {
      const text = readString(seg.text);
      if (text) lines.push(text);
      continue;
    }
    if (seg.type === 'dialogue') {
      const speakerName = readString(seg.speakerName) || (roleNameLookup ? roleNameLookup(seg.speakerId) : seg.speakerId);
      const text = readString(seg.text);
      if (!text) continue;
      lines.push(speakerName ? `${speakerName}: ${text}` : text);
      continue;
    }
    if (seg.type === 'choices') {
      const items = seg.items?.map((item) => readString(item.text)).filter(Boolean) ?? [];
      if (items.length > 0) lines.push(`选项：${items.join(' / ')}`);
    }
  }
  return lines.join('\n').trim();
};

export const buildMagicTavernSessionExport = (params: {
  session: MagicTavernSession;
  messages: MagicTavernMessage[];
  tachieAssets?: MagicTavernTachieAsset[];
  appVersion?: string;
  exportedAt?: string;
}): MagicTavernSessionExport => {
  const { roles, scenario, auxScenarios, ...sessionCore } = params.session;
  return {
    schema: 'magic-tavern.session.v1',
    exportedAt: params.exportedAt ?? new Date().toISOString(),
    appVersion: params.appVersion,
    session: sessionCore,
    roles: Array.isArray(roles) ? roles : [],
    scenario: scenario ?? null,
    auxScenarios: Array.isArray(auxScenarios) ? auxScenarios : [],
    messages: Array.isArray(params.messages) ? params.messages : [],
    tachieAssets: Array.isArray(params.tachieAssets) ? params.tachieAssets : [],
  };
};

export const parseSillyTavernJsonl = (params: {
  text: string;
  sessionId: string;
  createId: () => string;
  userDisplayName?: string;
  now?: number;
}): ParseJsonlResult => {
  const lines = params.text.split(/\r?\n/);
  const warnings: string[] = [];
  const messages: MagicTavernMessage[] = [];
  const now = typeof params.now === 'number' ? params.now : Date.now();

  lines.forEach((rawLine, index) => {
    const trimmed = rawLine.trim();
    if (!trimmed) return;

    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      warnings.push(`第 ${index + 1} 行 JSON 解析失败，已跳过。`);
      return;
    }

    const content =
      readString(parsed.mes) ||
      readString(parsed.content) ||
      readString(parsed.text);
    if (!content) {
      warnings.push(`第 ${index + 1} 行缺少内容字段，已跳过。`);
      return;
    }

    const isUser =
      parsed.is_user === true ||
      parsed.is_user === 'true' ||
      parsed.is_user === 1;
    const speakerName = normalizeSpeakerName(parsed);
    const createdAt = parseTimestamp(parsed.send_date ?? parsed.created_at ?? parsed.timestamp, now + index);
    const resolvedSpeakerName = speakerName || (isUser ? params.userDisplayName || '' : '');

    const extra = (parsed.extra && typeof parsed.extra === 'object' ? (parsed.extra as Record<string, unknown>) : null) ?? null;
    const mtExtra =
      extra && typeof extra.magic_tavern === 'object' && extra.magic_tavern !== null
        ? (extra.magic_tavern as Record<string, unknown>)
        : null;
    const extraSpeakerId = mtExtra && typeof mtExtra.speakerId === 'string' ? mtExtra.speakerId : undefined;
    const extraSegments = mtExtra && Array.isArray(mtExtra.segments) ? (mtExtra.segments as MagicTavernOutputSegment[]) : undefined;
    const extraChoices = mtExtra && Array.isArray(mtExtra.choices) ? (mtExtra.choices as { id: string; text: string }[]) : undefined;
    const extraTachieId = mtExtra && typeof mtExtra.tachieId === 'string' ? mtExtra.tachieId : undefined;
    const extraRevisionOf = mtExtra && typeof mtExtra.revisionOf === 'string' ? mtExtra.revisionOf : undefined;

    messages.push({
      id: params.createId(),
      sessionId: params.sessionId,
      role: isUser ? 'user' : 'assistant',
      content,
      createdAt,
      status: 'done',
      ...(extraSpeakerId ? { speakerId: extraSpeakerId } : {}),
      ...(extraSegments ? { segments: extraSegments } : {}),
      ...(extraChoices ? { choices: extraChoices } : {}),
      ...(extraTachieId ? { tachieId: extraTachieId } : {}),
      ...(extraRevisionOf ? { revisionOf: extraRevisionOf } : {}),
      meta: {
        ...(resolvedSpeakerName ? { speakerName: resolvedSpeakerName } : {}),
        source: {
          rawLine,
        },
      },
    });
  });

  return { messages, warnings };
};

export const stringifySillyTavernJsonl = (params: {
  messages: MagicTavernMessage[];
  userDisplayName: string;
  playerRoleName?: string;
  roleNameLookup?: (roleId: string) => string;
}): string => {
  const lines: string[] = [];
  const lookup = params.roleNameLookup;

  for (const message of params.messages) {
    if (!message || message.role === 'system') continue;
    const isUser = message.role === 'user';
    const metaSpeaker =
      message.meta && typeof message.meta === 'object' && typeof (message.meta as any).speakerName === 'string'
        ? readString((message.meta as any).speakerName)
        : '';
    const speakerName = isUser
      ? params.playerRoleName || params.userDisplayName || '用户'
      : metaSpeaker || (message.speakerId && lookup ? lookup(message.speakerId) : '') || 'Narrator';
    const segmentText = buildPlainTextFromSegments(message.segments, lookup);
    const content = segmentText || readString(message.content);
    if (!content) continue;

    const payload: Record<string, unknown> = {
      name: speakerName,
      is_user: isUser,
      mes: content,
      send_date: new Date(message.createdAt || Date.now()).toISOString(),
      extra: {
        magic_tavern: {
          speakerId: message.speakerId,
          segments: message.segments ?? null,
          choices: message.choices ?? null,
          tachieId: message.tachieId ?? null,
          revisionOf: message.revisionOf ?? null,
        },
      },
    };
    lines.push(JSON.stringify(payload));
  }

  return lines.join('\n');
};
