import type { TavernCharacterBook } from '@/lib/tavern-card';
import type {
  MagicTeaPartyMessage,
  MagicTeaPartyRole,
  MagicTeaPartyScenario,
  MagicTeaPartySession,
  MagicTeaPartyUpdateDraft,
} from '@/lib/magic-tea-party/types';
import { inferTemplate } from '@/lib/data-card-converter';
import { filterAndFormatHistory, formatCurrentStateForPrompt } from '@/lib/arena/logic';

// 取消卡片内容截断上限；如需恢复可参考以下阈值：
// const MAX_FIELD_CHARS = 2_000;
// const MAX_LIST_ITEMS = 12;
// const MAX_CARD_TEXT_CHARS = 12_000;
// const MAX_PROTOCOL_APPENDIX_CHARS = 4_000;

const toRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

const readString = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const truncateText = (text: string, maxChars: number): string => {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars))}...[已截断]`;
};

const safeStringField = (value: unknown): string => readString(value);

const stripRoleMetaFields = (card: Record<string, unknown>): Record<string, unknown> => {
  const cloned = { ...card };
  delete cloned.signature;
  if ('isPreset' in cloned) delete (cloned as any).isPreset;
  return cloned;
};

const stripScenarioMetaFields = (card: Record<string, unknown>): Record<string, unknown> => {
  const cloned = { ...card };
  delete cloned.signature;
  delete (cloned as any).metadata;
  return cloned;
};

export const buildWorldbookText = (worldbook: TavernCharacterBook | null | undefined): string => {
  if (!worldbook) return '';
  const entries = Array.isArray(worldbook.entries) ? worldbook.entries : [];
  const lines: string[] = [];
  lines.push(`【世界书】${worldbook.name || '未命名世界书'}`.trim());
  for (const entry of entries) {
    if (!entry) continue;
    const comment = readString((entry as any).comment);
    const content = readString((entry as any).content);
    if (!content) continue;
    lines.push(`- ${comment || '条目'}`.trim());
    lines.push(content);
  }
  return lines.join('\n');
};

export const buildRoleProfileText = (
  role: MagicTeaPartyRole,
  options?: {
    readArenaHistory?: boolean;
    readCurrentState?: boolean;
    historyReadLimit?: number | null;
    otherParticipantNames?: string[];
    isPureStory?: boolean;
    includeProtocolAppendix?: boolean;
    protocolShadow?: Pick<MagicTeaPartyUpdateDraft, 'impact' | 'currentStateSummary'>;
  }
): string => {
  const card = toRecord(role.card);
  const template = role.template ?? inferTemplate(card);
  const lines: string[] = [];
  const readArenaHistory = Boolean(options?.readArenaHistory);
  const readCurrentState = Boolean(options?.readCurrentState);
  const historyReadLimit = typeof options?.historyReadLimit === 'undefined' ? 3 : options?.historyReadLimit;
  const otherNames = Array.isArray(options?.otherParticipantNames) ? options?.otherParticipantNames ?? [] : [];
  const isPureStory = Boolean(options?.isPureStory);
  const shadowDraft = options?.protocolShadow;
  const cardForPrompt: Record<string, unknown> = stripRoleMetaFields(card);
  if (!readArenaHistory) delete (cardForPrompt as any).arena_history;
  if (!readCurrentState) delete (cardForPrompt as any).current_state;

  lines.push(`【角色】${role.name}`.trim());
  lines.push('（以下为角色设定；仅在系统提示词允许的阶段遵守协议规则，禁止直接输出字段名）');

  if (readArenaHistory) {
    const historyText = filterAndFormatHistory(
      role.name,
      (card as any).arena_history,
      otherNames,
      isPureStory,
      historyReadLimit
    );
    if (historyText) lines.push(historyText.trim());
  }

  if (readCurrentState) {
    const stateText = formatCurrentStateForPrompt((card as any).current_state);
    if (stateText) lines.push(stateText.trim());
  }

  if (template === 'general') {
    const content = safeStringField((cardForPrompt as any).content);
    if (content) {
      lines.push('// 通用角色设定（Markdown）');
      lines.push(content);
    } else {
      lines.push('// 核心设定');
      lines.push(JSON.stringify(cardForPrompt, null, 2));
    }
  } else {
    lines.push('// 核心设定');
    lines.push(JSON.stringify(cardForPrompt, null, 2));
  }

  if (shadowDraft) {
    const shadowLines: string[] = [];
    const shadowState = safeStringField(shadowDraft.currentStateSummary);
    const shadowImpact = safeStringField(shadowDraft.impact);
    if (shadowState) shadowLines.push(`- 状态摘要草案: ${shadowState}`);
    if (shadowImpact) shadowLines.push(`- 待写入历战影响: ${shadowImpact}`);
    if (shadowLines.length > 0) {
      lines.push('// 影子状态（未落库，仅供本轮参考）');
      lines.push(shadowLines.join('\n'));
    }
  }

  return lines.join('\n');
};

export const buildScenarioText = (scenario: MagicTeaPartyScenario, options?: { includeProtocolAppendix?: boolean }): string => {
  const card = stripScenarioMetaFields(toRecord(scenario.card));
  const template = inferTemplate(card);
  const lines: string[] = [];
  const includeProtocolAppendix = Boolean(options?.includeProtocolAppendix);

  lines.push(`【情景】${scenario.title}`.trim());
  lines.push(
    includeProtocolAppendix
      ? '（以下为情景全文与协议附录；仅在系统提示词允许的阶段遵守协议规则，禁止直接输出字段名）'
      : '（以下为情景全文；仅在系统提示词允许的阶段遵守协议规则，禁止直接输出字段名）'
  );

  if (template === 'scenario') {
    lines.push(JSON.stringify(card, null, 2));
    return lines.join('\n');
  }

  if (template === 'general-scenario') {
    const content = safeStringField(card.content);
    if (content) {
      lines.push(content);
    } else {
      lines.push(JSON.stringify(card, null, 2));
    }
    return lines.join('\n');
  }

  lines.push(JSON.stringify(card, null, 2));
  return lines.join('\n');
};

const formatDialogueHistory = (messages: MagicTeaPartyMessage[], userDisplayName: string): string => {
  const lines: string[] = [];
  lines.push('【对话记录】');
  for (const message of messages) {
    const content = readString(message.content);
    if (!content) continue;
    if (message.role === 'user') {
      lines.push(`${userDisplayName || '{{user}}'}: ${truncateText(content, 8_000)}`);
      continue;
    }
    if (message.role === 'assistant') {
      lines.push(`assistant: ${truncateText(content, 12_000)}`);
      continue;
    }
    lines.push(`system: ${truncateText(content, 4_000)}`);
  }
  return lines.join('\n');
};

export const buildMagicTeaPartyMainPrompt = (params: {
  session: Pick<MagicTeaPartySession, 'playerRoleId' | 'summary' | 'settings' | 'protocolShadow'>;
  roles: MagicTeaPartyRole[];
  scenario?: MagicTeaPartyScenario;
  auxScenarios?: MagicTeaPartyScenario[];
  worldbookText?: string;
  messages: MagicTeaPartyMessage[];
  requestChoices?: boolean;
  stylePrompt?: string;
}): string => {
  const language = params.session.settings.language ?? 'zh-CN';
  const outputFormat = params.session.settings.outputFormat ?? 'jsonl';
  const userDisplayName = params.session.settings.userDisplayName?.trim() || '{{user}}';
  const playerRoleId = params.session.playerRoleId ?? null;
  const baseOutputPlan = params.session.settings.outputPlan ?? { choices: 'off', summary: 'off', updates: 'off' };
  const enableSummary = params.session.settings.enableSummary !== false;
  const enableChoicesSetting = params.requestChoices === true ? true : Boolean(params.session.settings.enableChoices);
  const writeArenaHistory = Boolean(params.session.settings.writeArenaHistory);
  const writeCurrentState = Boolean(params.session.settings.writeCurrentState);
  const outputPlan = {
    choices: outputFormat === 'jsonl' ? baseOutputPlan.choices : 'off',
    summary: outputFormat === 'jsonl' && enableSummary ? baseOutputPlan.summary : 'off',
    updates: outputFormat === 'jsonl' && (writeArenaHistory || writeCurrentState) ? baseOutputPlan.updates : 'off',
  } as const;
  const effectiveChoicesPlan = enableChoicesSetting ? outputPlan.choices : 'off';
  const enableChoices = effectiveChoicesPlan !== 'off';
  const choiceCount = params.session.settings.choiceCount ?? 3;
  const readArenaHistory = Boolean(params.session.settings.readArenaHistory);
  const readCurrentState = Boolean(params.session.settings.readCurrentState);
  const historyReadLimit = readArenaHistory
    ? (params.session.settings.isArenaHistoryUnlimited ? null : params.session.settings.readArenaHistoryLimit ?? 3)
    : undefined;
  const roleNames = params.roles.map((role) => role.name).filter(Boolean);

  const playerRole = playerRoleId ? params.roles.find((role) => role.id === playerRoleId) ?? null : null;
  const protocolShadowDrafts = Array.isArray(params.session.protocolShadow?.drafts) ? params.session.protocolShadow?.drafts ?? [] : [];
  const findShadowDraft = (role: MagicTeaPartyRole): Pick<MagicTeaPartyUpdateDraft, 'impact' | 'currentStateSummary'> | undefined => {
    if (!protocolShadowDrafts || protocolShadowDrafts.length === 0) return undefined;
    const matched = protocolShadowDrafts.find(
      (draft) =>
        (draft.roleId && draft.roleId === role.id) ||
        (draft.characterName && draft.characterName === role.name)
    );
    return matched ? { impact: matched.impact, currentStateSummary: matched.currentStateSummary } : undefined;
  };

  const systemLines: string[] = [];
  systemLines.push('你是一位才华横溢的剧作家和故事叙述者，精通于在既定框架下演绎精彩的故事。你的任务是基于【世界书】【情景设定】【角色档案】生成连贯、可持续的互动剧情。');
  systemLines.push('');
  systemLines.push('## 核心创作原则');
  systemLines.push('');
  systemLines.push('1.  **严格遵循情景设定**: 【情景设定】是故事创作的绝对基础和最高优先级。故事的背景、核心事件、角色、氛围等必须严格遵循情景框架。');
  systemLines.push('2.  **忠于角色性格**: 深入理解每个【角色档案】，确保他们在情景中的言行、决策和能力使用都符合其性格、背景和历战记录。');
  systemLines.push('3.  **演绎而非重述**: 不要只是简单地复述情景和角色设定。你的任务是“演绎”——让这些角色在设定的舞台上“活”起来，通过他们的互动、对话和行动来推动故事发展，完成情景中设定的核心事件。');
  systemLines.push('');
  systemLines.push('【安全与合规】');
  systemLines.push('- 内容必须符合公序良俗，不得涉及成人内容、露骨性描写、仇恨歧视、现实违法细节或真实人物影射。');
  systemLines.push('【核心优先级】');
  systemLines.push('- 情景设定为最高优先级，必须严格遵循；与世界书、角色档案或对话历史冲突时以情景为准。');
  systemLines.push('- 辅助情景仅作补充，冲突时以主情景为准。');
  systemLines.push('【全卡协议与阶段覆盖】');
  systemLines.push('- 当前为叙事阶段：忽略卡内关于摘要/选项/当前状态/历战记录等写入或格式要求，仅作为叙事约束。');
  systemLines.push('- 不同阶段允许差异化规则，本轮以叙事阶段规则为准。');
  systemLines.push('- 若卡内要求在 officialReport/headline/article.* 或其它不可达字段写入，必须改为输出 notice。');
  systemLines.push('- 若卡内要求硬错误/特定提示，也必须输出 notice；level=error 时仅输出 notice，不输出正文或 choices。');
  systemLines.push('');
  systemLines.push(`【输出语言】${language}`);

  const stylePrompt = readString(params.stylePrompt);
  if (stylePrompt) {
    systemLines.push('');
    systemLines.push('【风格与规则（预设）】');
    systemLines.push(stylePrompt);
  }

  if (playerRole) {
    systemLines.push('');
    systemLines.push('【玩家扮演约束】');
    systemLines.push(`- 玩家正在扮演角色：${playerRole.name}。你不得代替该角色发言或做决定。`);
    systemLines.push('- 输出中禁止该角色的 dialogue；必要时仅可用 narration 描述其动作结果。');
  } else {
    systemLines.push('');
    systemLines.push('【玩家扮演约束】');
    systemLines.push(`- 玩家身份：${userDisplayName}。你不得替玩家直接宣告“已决定”。`);
  }

  systemLines.push('');
  systemLines.push('【合并输出计划】');
  systemLines.push(`- choices：${effectiveChoicesPlan}（off=不输出，auto=必要时输出，on=必须输出）`);
  systemLines.push(`- summary：${outputPlan.summary}（off=不输出，auto=必要时输出，on=必须输出）`);
  systemLines.push(`- updates：${outputPlan.updates}（off=不输出，auto=必要时输出，on=必须输出）`);
  systemLines.push('若协议强制选项，可输出 choices 并附带 notice 说明。');

  systemLines.push('');
  systemLines.push('【输出格式】');
  if (outputFormat === 'jsonl') {
    systemLines.push('- 仅输出 JSONL（每行一个 JSON 对象），禁止输出代码块/围栏/解释。');
    systemLines.push('- type 仅允许 narration/dialogue/choices/summary/updates/notice。');
    systemLines.push('- narration：{"type":"narration","text":"..."}（必须使用 text，禁止使用 content）。');
    systemLines.push('- dialogue：{"type":"dialogue","speakerId":"...","speakerName":"...","text":"..."}。');
    systemLines.push('- choices：{"type":"choices","items":[{"id":"c1","text":"..."},...]}。');
    systemLines.push('- summary：{"type":"summary","text":"...","sections":{...}}。');
    systemLines.push('- updates：{"type":"updates","drafts":[...],"meta":{...}}。');
    systemLines.push('- notice：{"type":"notice","level":"error|warning|info","code":"...","message":"...","meta":{...}}。');
    systemLines.push('- notice 必须独立成行；level=error 时仅输出 notice。');
    systemLines.push('- dialogue 必须包含 speakerId（来自角色 id），并尽量包含 speakerName。');
    systemLines.push('- choices 仅在需要时输出一行，items 默认 2~4；若协议强制数量/标识，可调整至 2~16 并保留标识。');
    systemLines.push('- summary/updates 仅在合并输出计划允许时输出，且必须位于正文/choices 之后。');
  } else {
    systemLines.push('- 仅输出 Markdown 故事正文。');
    systemLines.push('- 若需要 notice，请输出独立 mtp_notice 块；level=error 时仅输出 notice。');
  }

  if (enableChoices && outputFormat === 'jsonl') {
    systemLines.push('');
    systemLines.push('【选项】');
    if (effectiveChoicesPlan === 'on') {
      systemLines.push(`- 必须在本轮结尾输出 choices，一共 ${Math.min(16, Math.max(2, choiceCount))} 条，长度 12~30 字。`);
    } else {
      systemLines.push(`- 在需要时输出 choices，一共 ${Math.min(16, Math.max(2, choiceCount))} 条，长度 12~30 字。`);
    }
    systemLines.push('- 选项必须是“玩家可选行动”，不要引入新设定/新角色。');
  }

  if (outputFormat === 'jsonl' && outputPlan.summary !== 'off') {
    systemLines.push('');
    systemLines.push('【摘要】');
    systemLines.push('- summary 必须在正文与 choices 之后输出。');
    systemLines.push('- text 是完整摘要；sections 可按“世界状态/角色关系/关键事件/未决事项/禁忌”拆分，信息不足部分可写“无”。');
  }

  if (outputFormat === 'jsonl' && outputPlan.updates !== 'off') {
    systemLines.push('');
    systemLines.push('【更新草案】');
    systemLines.push('- updates 必须在 summary 之后输出（若 summary 未输出则紧跟 choices 之后）。');
    systemLines.push('- drafts 必须只包含角色列表中的角色，字段仅允许 roleId/characterName/impact/currentStateSummary/hasWinner/winner。');
    systemLines.push('- meta 可携带 messageRange/usedSummary 等信息。');
    systemLines.push('【创作原则】');
    systemLines.push('- 如果情景是合作或日常互动，没有明确的胜负和强弱，则不适用胜利者。');
    systemLines.push('- 如果情景包含竞争或对抗元素并分出了胜负或强弱，请确定胜利者的名字。');
    systemLines.push('- 如果是平局，则返回“平局”。');
    systemLines.push('【记录要点】');
    systemLines.push('- impact：总结角色经历带来的影响、成长或关系变化。');
    systemLines.push('- currentStateSummary：描述角色的即时状态（如身体状况、关系、心情或想法）；无变化可省略。');
  }

  const parts: string[] = [];
  parts.push(systemLines.join('\n').trim());

  const worldbookText = readString(params.worldbookText);
  if (worldbookText) parts.push(worldbookText);

  if (params.scenario) parts.push(buildScenarioText(params.scenario, { includeProtocolAppendix: true }));
  if (Array.isArray(params.auxScenarios) && params.auxScenarios.length > 0) {
    const aux = params.auxScenarios.map((item) => buildScenarioText(item, { includeProtocolAppendix: true })).join('\n\n');
    parts.push(`【辅助情景】\n${aux}`.trim());
  }

  if (params.roles.length > 0) {
    parts.push(
      `【角色档案】\n${params.roles
        .map((role) =>
          {
            const shadowDraft = findShadowDraft(role);
            const shadowPayload =
              shadowDraft && (readArenaHistory || readCurrentState)
                ? {
                    ...(readArenaHistory ? { impact: shadowDraft.impact } : {}),
                    ...(readCurrentState ? { currentStateSummary: shadowDraft.currentStateSummary } : {}),
                  }
                : undefined;
            return buildRoleProfileText(role, {
              readArenaHistory,
              readCurrentState,
              historyReadLimit,
              otherParticipantNames: roleNames.filter((name) => name !== role.name),
              isPureStory: false,
              includeProtocolAppendix: true,
              protocolShadow: shadowPayload,
            });
          }
        )
        .join('\n\n')}`.trim()
    );
  }

  if (readString(params.session.summary)) {
    parts.push(`【会话摘要】\n${truncateText(readString(params.session.summary), 10_000)}`.trim());
  }

  parts.push(formatDialogueHistory(params.messages, userDisplayName));
  parts.push('请基于以上信息继续剧情。');
  return parts.join('\n\n').trim();
};

export const buildMagicTeaPartyChoicesPrompt = (params: {
  session: Pick<MagicTeaPartySession, 'playerRoleId' | 'summary' | 'settings' | 'protocolShadow'>;
  roles: MagicTeaPartyRole[];
  scenario?: MagicTeaPartyScenario;
  auxScenarios?: MagicTeaPartyScenario[];
  worldbookText?: string;
  messages: MagicTeaPartyMessage[];
  stylePrompt?: string;
  choiceCount?: number;
}): string => {
  const choiceCount = Math.min(16, Math.max(2, params.choiceCount ?? params.session.settings.choiceCount ?? 3));

  const patchedSession: Pick<MagicTeaPartySession, 'playerRoleId' | 'summary' | 'settings' | 'protocolShadow'> = {
    ...params.session,
    settings: {
      ...params.session.settings,
      outputFormat: 'jsonl',
      enableChoices: true,
      choiceCount,
      outputPlan: { choices: 'on', summary: 'off', updates: 'off' },
    },
  };

  const base = buildMagicTeaPartyMainPrompt({
    session: patchedSession,
    roles: params.roles,
    scenario: params.scenario,
    auxScenarios: params.auxScenarios,
    worldbookText: params.worldbookText,
    messages: params.messages,
    requestChoices: true,
    stylePrompt: params.stylePrompt,
  });

  return [
    base,
    '',
    '【阶段规则：选项】',
    '- 你现在仅处理“选项生成”，必须遵守角色/情景卡内关于选项数量、标识或格式的要求（如有）。',
    '- 若卡内要求硬错误/特定提示，必须输出 notice。',
    '【选项原则】',
    '- 选项必须源于当前情景与对话上下文。',
    '- 选项之间要有明确差异且各自可执行，避免只是措辞变化或结果近似。',
    '- 保持角色性格、能力边界与世界观一致，确保后续可合理演绎。',
    '【任务】你将仅生成“下一步玩家可选行动”的 choices；如需报错/提示则输出 notice。',
    `【输出要求】仅输出 1 行 JSON：{"type":"choices","items":[{"id":"c1","text":"..."},...]}，items 默认 ${choiceCount} 条；若协议强制数量/标识，可调整至 2~16 并保留标识。`,
    '【输出限制】禁止输出代码块、解释、标题或多余换行。',
  ]
    .join('\n')
    .trim();
};

export const buildMagicTeaPartyUpdatePrompt = (params: {
  roles: MagicTeaPartyRole[];
  scenario?: MagicTeaPartyScenario;
  auxScenarios?: MagicTeaPartyScenario[];
  lastChoices?: { id: string; text: string }[] | null;
  messages: MagicTeaPartyMessage[];
  summary?: string;
  language?: MagicTeaPartySession['settings']['language'];
  userDisplayName?: string;
  writeArenaHistory: boolean;
  writeCurrentState: boolean;
}): string => {
  const language = params.language ?? 'zh-CN';
  const userDisplayName = readString(params.userDisplayName) || '{{user}}';
  const writeArenaHistory = params.writeArenaHistory;
  const writeCurrentState = params.writeCurrentState;

  const enabledFields: string[] = [];
  if (writeArenaHistory) enabledFields.push('impact');
  if (writeCurrentState) enabledFields.push('currentStateSummary');

  const lines: string[] = [];
  lines.push('你的任务是根据【对话记录】生成角色更新草案，用于写入历战记录与当前状态摘要。');
  lines.push('');
  lines.push('## 核心记录原则');
  lines.push('');
  lines.push('1.  **只记录已发生的事实**: 所有内容必须来自对话记录与情景设定，不得补写或推断未发生事件。');
  lines.push('2.  **记录变化而非复述**: 重点描述角色经历带来的影响、成长或状态变化，避免重复已知设定。');
  lines.push('3.  **具体可落库**: 使用清晰、可执行、可写入的表述，避免空泛或文学化。');
  lines.push(`【输出语言】${language}`);
  lines.push('【阶段说明】记录更新阶段（仅输出 JSON 草案）。');
  lines.push('【核心优先级】');
  lines.push('- 情景设定为最高优先级；辅助情景仅作补充，冲突时以主情景为准。');
  lines.push('【全卡协议】');
  lines.push('- 本阶段允许采用与叙事阶段不同的规则集（例如格式/风格/用词），以阶段系统提示词为最高优先级。');
  lines.push('- 若被要求写入 officialReport/headline/article.* 等不可达字段，请将内容映射为 impact/currentStateSummary，不得输出字段名。');
  lines.push('【通用约束】');
  lines.push('- 严禁编造未发生的剧情或新设定。');
  lines.push('- 输出必须是可解析的 JSON，不要输出解释、Markdown 或多余文本。');
  lines.push('- 角色名称必须与提供的列表完全一致。');
  lines.push(`- 仅生成以下字段：${enabledFields.join('、') || '（本次未开启任何可写入字段）'}`);
  lines.push('【胜利者判定】');
  lines.push('- 如果情景是合作或日常互动，没有明确的胜负和强弱，则不适用胜利者。');
  lines.push('- 如果情景包含竞争或对抗元素并分出了胜负或强弱，请确定胜利者的名字。');
  lines.push('- 如果是平局，则返回“平局”。');
  lines.push('【记录要点】');
  lines.push('- impact：总结角色经历带来的影响、成长或关系变化。');
  lines.push('- currentStateSummary：描述角色的即时状态（如身体状况、关系、心情或想法）；无变化可省略。');
  lines.push('');
  lines.push('【输出 JSON Schema】');
  lines.push(
    JSON.stringify(
      {
        updates: [
          {
            roleId: 'string',
            characterName: 'string',
            impact: 'string',
            currentStateSummary: 'string',
            hasWinner: false,
            winner: '不适用',
          },
        ],
      },
      null,
      2
    )
  );

  const roleLines = params.roles.map((role) => {
    const snapshot = formatCurrentStateForPrompt((role.card as any)?.current_state);
    const snapshotText = snapshot ? `\n  当前状态快照：\n  ${snapshot.replace(/\n/g, '\n  ')}` : '';
    return `- ${role.name}（roleId=${role.id}）${snapshotText}`;
  });

  if (roleLines.length > 0) {
    lines.push('');
    lines.push('【角色列表】');
    lines.push(roleLines.join('\n'));
  }

  if (params.scenario) {
    lines.push('');
    lines.push(buildScenarioText(params.scenario, { includeProtocolAppendix: true }));
  }
  if (Array.isArray(params.auxScenarios) && params.auxScenarios.length > 0) {
    const aux = params.auxScenarios.map((item) => buildScenarioText(item, { includeProtocolAppendix: true })).join('\n\n');
    lines.push('');
    lines.push(`【辅助情景】\n${aux}`.trim());
  }

  if (params.roles.length > 0) {
    lines.push('');
    lines.push(
      `【角色档案】\n${params.roles
        .map((role) =>
          buildRoleProfileText(role, {
            readArenaHistory: false,
            readCurrentState: true,
            historyReadLimit: 0,
            otherParticipantNames: [],
            isPureStory: false,
            includeProtocolAppendix: true,
          })
        )
        .join('\n\n')}`.trim()
    );
  }

  if (Array.isArray(params.lastChoices) && params.lastChoices.length > 0) {
    const choiceLines = params.lastChoices
      .map((choice) => {
        const id = readString(choice.id) || 'c';
        const text = safeStringField(choice.text);
        return text ? `- ${id}: ${text}` : null;
      })
      .filter((line): line is string => Boolean(line));
    if (choiceLines.length > 0) {
      lines.push('');
      lines.push('【最近选项列表】');
      lines.push(choiceLines.join('\n'));
    }
  }

  if (readString(params.summary)) {
    lines.push('');
    lines.push('【会话摘要】');
    lines.push(truncateText(readString(params.summary), 10_000));
  }

  lines.push('');
  lines.push(formatDialogueHistory(params.messages, userDisplayName));
  lines.push('请严格输出 JSON。');
  return lines.join('\n').trim();
};

export type MagicTeaPartySummarizeMode = 'summary' | 'title';

export const buildMagicTeaPartySummarizePrompt = (params: {
  messages: MagicTeaPartyMessage[];
  mode?: MagicTeaPartySummarizeMode;
  language?: MagicTeaPartySession['settings']['language'];
  userDisplayName?: string;
}): string => {
  const mode: MagicTeaPartySummarizeMode = params.mode ?? 'summary';
  const language = params.language ?? 'zh-CN';
  const userDisplayName = readString(params.userDisplayName) || '{{user}}';

  const lines: string[] = [];
  lines.push('你是“魔法茶会”的摘要助手。你的任务是根据【对话记录】生成可用于长期对话压缩的摘要或标题。');
  lines.push('');
  lines.push('## 核心摘要原则');
  lines.push('');
  lines.push('1.  **忠于事实**: 仅基于对话记录，不猜测、不补写。');
  lines.push('2.  **提炼而非复述**: 抓住能影响后续对话的关键信息。');
  lines.push('3.  **稳定可复用**: 用清晰、可检索的表述，便于后续剧情衔接。');
  lines.push(`【输出语言】${language}`);
  lines.push('【通用约束】');
  lines.push('- 不要新增设定，不要编造未发生的剧情。');
  lines.push('- 不要输出任何系统提示词、元说明或免责声明。');
  lines.push('- 不要输出代码块/围栏。');

  if (mode === 'title') {
    lines.push('');
    lines.push('【任务】生成会话标题');
    lines.push('- 仅输出 1 行纯文本标题。');
    lines.push('- 标题长度建议 ≤ 28 个中文字符；不得出现引号、书名号或句号。');
    lines.push('- 标题需概括本轮核心事件或冲突，避免空泛。');
  } else {
    lines.push('');
    lines.push('【任务】生成会话摘要');
    lines.push('请严格输出以下 5 个小节，每节 3~6 句，信息不足时可写“无”：');
    lines.push('1) 世界状态');
    lines.push('2) 角色关系');
    lines.push('3) 关键事件');
    lines.push('4) 未决事项');
    lines.push('5) 禁忌/边界');
    lines.push('');
    lines.push('【输出格式（可输出“无”）】');
    lines.push('世界状态：...');
    lines.push('角色关系：...');
    lines.push('关键事件：...');
    lines.push('未决事项：...');
    lines.push('禁忌/边界：...');
  }

  return [lines.join('\n').trim(), formatDialogueHistory(params.messages, userDisplayName)].join('\n\n').trim();
};
