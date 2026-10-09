import type { AdjudicationResult } from '@mahoshojo/domain/arena-types';
import type { AIReasoningEnvelope } from '@mahoshojo/contracts/ai-reasoning';
import type { WebPackageArtifact } from '@mahoshojo/contracts/web-package';

// eslint-disable-next-line no-unused-vars -- Parameter names in this type carry no runtime bindings.
export type ArenaReportTextMapper = (text: string) => string;

export interface ArenaBattleReport {
  reportFormat?: 'markdown' | 'web';
  webHtml?: string;
  webPackage?: WebPackageArtifact;
  webReady?: boolean;
  headline: string;
  scenario?: string;
  reporterInfo: {
    name:string;
    publication: string;
  };
  /** 本次生成所使用的 AI 模型（用于战报元数据展示，可能为空）。 */
  aiModel?: string | null;
  article: {
    body: string;
    analysis: string;
  };
  officialReport: {
    winner: string;
    conclusion: string;
  };
  /** AI 生成相关的 token 统计（用于战报页展示，可能为空）。 */
  aiUsage?: {
    promptTokens?: number | null;
    reasoningTokens?: number | null;
    textTokens?: number | null;
    completionTokens?: number | null;
    totalTokens?: number | null;
    cachedTokens?: number | null;
    [key: string]: unknown;
  };
  /** AI 思考内容（结构化，可能为空）。 */
  aiReasoning?: AIReasoningEnvelope | null;
  /**
   * 读取叙事历史条数：仅在开启 readNarrativeHistory 时由后端写入（未开启则不返回）。
   * 可能为 0（已开启但本地无可用条目）。
   */
  narrativeHistoryReadCount?: number;
  // 可选的用户引导信息字段
  userGuidance?: string;
  /**
   * 角色行动/想法引导（逐角色、可选）。
   * - 仅当用户填写时返回/展示
   * - 会被记录进战报生成记录与（可选）历战记录
   */
  characterGuidances?: Array<{ characterName: string; guidance: string }>;
  mode?: 'classic' | 'kizuna' | 'daily' | 'scenario';
  /** 已由宿主确认的随机判定结果，仅用于展示。 */
  adjudicationResults?: AdjudicationResult[];
}

export interface ArenaBattleAiImpact {
  characterName: string;
  impact?: string;
  currentStateSummary?: string;
}

export const normalizeBattleAiImpacts = (input: unknown, sanitizeText: ArenaReportTextMapper): ArenaBattleAiImpact[] => {
  if (!Array.isArray(input)) return [];

  const normalized = input
    .map((raw) => {
      if (!raw || typeof raw !== 'object') return null;
      const record = raw as Record<string, unknown>;
      const characterName = typeof record.characterName === 'string' ? record.characterName.trim() : '';
      if (!characterName) return null;

      const impact = typeof record.impact === 'string' ? record.impact.trim() : '';
      const currentStateSummary =
        typeof record.currentStateSummary === 'string' ? record.currentStateSummary.trim() : '';

      return {
        characterName: sanitizeText(characterName),
        ...(impact ? { impact: sanitizeText(impact) } : {}),
        ...(currentStateSummary ? { currentStateSummary: sanitizeText(currentStateSummary) } : {}),
      } satisfies ArenaBattleAiImpact;
    })
    .filter((item): item is ArenaBattleAiImpact => Boolean(item));

  if (normalized.length === 0) return [];

  const deduped = new Map<string, ArenaBattleAiImpact>();
  for (const item of normalized) {
    if (!deduped.has(item.characterName)) {
      deduped.set(item.characterName, item);
      continue;
    }
    const previous = deduped.get(item.characterName)!;
    deduped.set(item.characterName, {
      characterName: item.characterName,
      impact: item.impact ?? previous.impact,
      currentStateSummary: item.currentStateSummary ?? previous.currentStateSummary,
    });
  }

  return Array.from(deduped.values());
};

export const extractTitleFromBattleMarkdown = (markdown: string): string => {
  const lines = markdown.split(/\r?\n/).map((line) => line.trim());
  for (const line of lines) {
    if (!line) continue;
    const m = line.match(/^#{1,3}\s*(.+)$/);
    if (m?.[1]) return m[1].trim().slice(0, 120);
    return line.slice(0, 120);
  }
  return '未命名战报';
};

export const mapArenaBattleReportText = <T extends ArenaBattleReport>(report: T, sanitizeText: ArenaReportTextMapper): T => ({
  ...report,
  headline: sanitizeText(report.headline),
  scenario: report.scenario ? sanitizeText(report.scenario) : undefined,
  aiModel: typeof report.aiModel === 'string' ? sanitizeText(report.aiModel) : report.aiModel,
  reporterInfo: {
    ...report.reporterInfo,
    name: sanitizeText(report.reporterInfo.name),
    publication: sanitizeText(report.reporterInfo.publication),
  },
  article: {
    ...report.article,
    body: sanitizeText(report.article.body),
    analysis: sanitizeText(report.article.analysis),
  },
  officialReport: {
    ...report.officialReport,
    winner: sanitizeText(report.officialReport.winner),
    conclusion: sanitizeText(report.officialReport.conclusion),
  },
  userGuidance: report.userGuidance ? sanitizeText(report.userGuidance) : undefined,
  characterGuidances: Array.isArray((report as any).characterGuidances)
    ? ((report as any).characterGuidances as any[])
        .map((item) => {
          const characterName = typeof item?.characterName === 'string' ? item.characterName.trim() : '';
          const guidance = typeof item?.guidance === 'string' ? item.guidance.trim() : '';
          if (!characterName || !guidance) return null;
          return { characterName: sanitizeText(characterName), guidance: sanitizeText(guidance) };
        })
        .filter((item): item is { characterName: string; guidance: string } => Boolean(item))
    : undefined,
  aiReasoning: (() => {
    const reasoning = report.aiReasoning;
    if (!reasoning || typeof reasoning !== 'object') return reasoning;

    const sanitizedParts = Array.isArray(reasoning.parts)
      ? reasoning.parts.map((part) => ({
          ...part,
          text: typeof part?.text === 'string' ? sanitizeText(part.text) : part?.text,
        }))
      : reasoning.parts;

    return {
      ...reasoning,
      summary: typeof reasoning.summary === 'string' ? sanitizeText(reasoning.summary) : reasoning.summary,
      text: typeof reasoning.text === 'string' ? sanitizeText(reasoning.text) : reasoning.text,
      errorMessage:
        typeof reasoning.errorMessage === 'string' ? sanitizeText(reasoning.errorMessage) : reasoning.errorMessage,
      parts: sanitizedParts,
    };
  })(),
});

export const toBattleReportMarkdown = (report: ArenaBattleReport): string => {
  const headline = (report?.headline ?? '').toString().trim();
  const body = (report?.article?.body ?? '').toString().trim();
  const winner = (report?.officialReport?.winner ?? '').toString().trim();
  const conclusion = (report?.officialReport?.conclusion ?? '').toString().trim();

  const parts: string[] = [];
  if (headline) {
    parts.push(`# ${headline}`);
  } else {
    parts.push('# 战报');
  }

  if (body) {
    parts.push(body);
  }

  parts.push('## 胜利者');
  parts.push(winner ? `- ${winner}` : '- 未知');

  parts.push('## 最终结果');
  if (conclusion) {
    parts.push(conclusion);
  }

  return parts.join('\n\n');
};


/** Display projection only: no signature, growth finalization or persistence authority. */
export const projectArenaBattleReport = <T extends ArenaBattleReport>(input: {
  report: T;
  mode: string;
  scenarioDisplayName: string | null;
  adjudicationResults?: AdjudicationResult[];
  sanitizeText: ArenaReportTextMapper;
}): T => {
  const safeScenarioDisplayName = input.scenarioDisplayName ? input.sanitizeText(input.scenarioDisplayName) : null;
  const report = {
    ...(input.report.reportFormat === 'web' ? input.report : mapArenaBattleReportText(input.report, input.sanitizeText)),
    adjudicationResults: input.adjudicationResults,
  };
  if (input.mode === 'scenario' && safeScenarioDisplayName) report.scenario = safeScenarioDisplayName;
  else delete report.scenario;
  return report;
};

/** Preserve host roster metadata and complete returned card extensions. */
export const projectArenaUpdatedRoster = <T extends { data: any }>(combatants: T[], updatedCombatants: any[]): T[] =>
  combatants.map((combatant) => {
    const updated = updatedCombatants.find(
      (item) => (item.codename || item.name) === (combatant.data.codename || combatant.data.name),
    );
    return updated ? { ...combatant, data: updated } : combatant;
  });
