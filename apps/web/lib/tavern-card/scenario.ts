type ScenarioKind = 'general-scenario' | 'scenario';

export interface TavernScenarioFragment {
  kind: ScenarioKind;
  title: string;
  content: string;
  warnings: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
};

const safeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const truncateText = (value: string, maxChars: number): { text: string; truncated: boolean } => {
  const trimmed = value.trim();
  if (!maxChars || trimmed.length <= maxChars) return { text: trimmed, truncated: false };
  return { text: `${trimmed.slice(0, maxChars)}\n...[已截断]`, truncated: true };
};

const joinBlocks = (blocks: string[]): string => blocks.filter((item) => item.trim()).join('\n');

const formatGeneralScenario = (data: Record<string, unknown>): TavernScenarioFragment | null => {
  const templateId = safeString(data.templateId);
  if (templateId !== '通用情景') return null;
  const title = safeString(data.title) || safeString(data.name) || '未命名情景';
  const content = safeString(data.content);
  return {
    kind: 'general-scenario',
    title,
    content: joinBlocks([`【情景】${title}`, '', content]),
    warnings: [],
  };
};

const formatStructuredScenario = (data: Record<string, unknown>): TavernScenarioFragment | null => {
  const title = safeString(data.title);
  const elements = isRecord(data.elements) ? data.elements : null;
  if (!title || !elements) return null;

  const description = safeString(data.description);
  const scenarioType = safeString(data.scenario_type);

  const scene = isRecord(elements.scene) ? elements.scene : null;
  const time = safeString(scene?.time);
  const place = safeString(scene?.place);
  const features = safeString(scene?.features);

  const atmosphere = safeString(elements.atmosphere);
  const events = safeString(elements.events);

  const rolesRaw = Array.isArray(elements.roles) ? elements.roles : [];
  const roles = rolesRaw
    .map((role) => (isRecord(role) ? { name: safeString(role.name), description: safeString(role.description) } : null))
    .filter((role): role is { name: string; description: string } => Boolean(role && (role.name || role.description)))
    .slice(0, 12);

  const developmentRaw = Array.isArray(elements.development) ? elements.development : [];
  const development = developmentRaw
    .map((item) => safeString(item))
    .filter(Boolean)
    .slice(0, 12);

  const lines: string[] = [];
  lines.push(`【情景】${title}`);
  if (scenarioType) lines.push(`类型：${scenarioType}`);
  if (description) lines.push(description);

  const sceneParts = [
    time && `时间：${time}`,
    place && `地点：${place}`,
    features && `特征：${features}`,
  ].filter(Boolean);
  if (sceneParts.length > 0) {
    lines.push('');
    lines.push('【场景要素】');
    lines.push(sceneParts.join('\n'));
  }

  if (atmosphere || events) {
    lines.push('');
    lines.push('【叙事要点】');
    if (atmosphere) lines.push(`氛围：${atmosphere}`);
    if (events) lines.push(`核心事件：${events}`);
  }

  if (development.length > 0) {
    lines.push('');
    lines.push('【发展方向】');
    for (const item of development) lines.push(`- ${item}`);
  }

  if (roles.length > 0) {
    lines.push('');
    lines.push('【预设角色（可选）】');
    for (const role of roles) {
      const header = role.name ? `- ${role.name}` : '- NPC';
      lines.push(header);
      if (role.description) lines.push(`  ${role.description}`);
    }
  }

  return {
    kind: 'scenario',
    title,
    content: lines.join('\n'),
    warnings: [],
  };
};

export function buildTavernScenarioFragment(
  data: unknown,
  options?: { maxChars?: number }
): TavernScenarioFragment | null {
  if (!isRecord(data)) return null;

  const maxChars = options?.maxChars ?? 24_000;
  const warnings: string[] = [];

  const fragment = formatGeneralScenario(data) ?? formatStructuredScenario(data);
  if (!fragment) return null;

  const truncated = truncateText(fragment.content, maxChars);
  if (truncated.truncated) warnings.push(`情景「${fragment.title}」内容过长，已截断到 ${maxChars} 字符。`);

  return { ...fragment, content: truncated.text, warnings: [...fragment.warnings, ...warnings] };
}

