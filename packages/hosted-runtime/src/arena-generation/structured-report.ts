import { z } from 'zod/v3';

export type ArenaStructuredReportOptions = Readonly<{
  enableImpacts: boolean;
  enableImpactText: boolean;
  enableCurrentState: boolean;
}>;

export const buildArenaStructuredReportSchema = (
  options: ArenaStructuredReportOptions,
) => {
  const baseShape: Record<string, z.ZodTypeAny> = {
    headline: z.string().describe('本场战斗或故事的新闻标题，可以使用震惊体等技巧来吸引读者。'),
    article: z.object({
      body: z.string().describe('战斗简报或故事的正文。【注意】内容应当符合公序良俗，排除涉及或影射政治、现实、脏话、性、色情、暴力、仇恨言论、歧视、犯罪、争议性的内容。'),
      analysis: z.string().describe('记者的分析与猜测。这部分内容可以带有记者的主观色彩，看热闹不嫌事大，进行一些有逻辑但可能不完全真实的猜测和引申，制造“爆点”，字数约100-150字。'),
    }),
    officialReport: z.object({
      winner: z.string().describe("胜利者的代号或名称。如果是平局，则返回'平局'。如果是无胜负要素的故事，请列出所有核心参与角色的名字；如果带有竞争性并分出了胜负（如战斗、辩论、比赛），则只写胜利者的名字。"),
      conclusion: z.string().describe('对本次事件的总结点评，描述事件带来的最终结果，包括对参与者和相关者的后续影响。'),
    }),
  };

  if (options.enableImpacts) {
    const impactShape: Record<string, z.ZodTypeAny> = {
      characterName: z.string().describe('参与者的代号或名称。'),
    };
    if (options.enableImpactText) {
      impactShape.impact = z.string().describe('概括该角色在此次事件中的成长、感悟或变化。');
    }
    if (options.enableCurrentState) {
      impactShape.currentStateSummary = z.string().describe('该角色在本次故事后的即时状态概述。');
    }
    baseShape.impacts = z.array(z.object(impactShape)).describe('对每位参与该事件的核心角色的影响总结列表。');
  }

  return z.object(baseShape).describe('生成一份关于魔法少女的新闻报道。如果用户提供了引导，请在创作时参考，但必须确保最终内容符合魔法少女世界观和公序良俗。');
};

export const parseArenaStructuredReportJson = (
  value: string,
  options: ArenaStructuredReportOptions,
): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(value) as unknown;
    const result = buildArenaStructuredReportSchema(options).safeParse(parsed);
    return result.success ? result.data as Record<string, unknown> : null;
  } catch {
    return null;
  }
};
