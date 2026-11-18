import { z } from 'zod/v3';

export type ArenaStructuredReportOptions = Readonly<{
  enableImpacts: boolean;
  enableImpactText: boolean;
  enableCurrentState: boolean;
  mode?: string;
}>;

export const buildArenaStructuredReportSchema = (
  options: ArenaStructuredReportOptions,
) => {
  const isDaily = options.mode === 'daily';
  const baseShape: Record<string, z.ZodTypeAny> = {
    headline: z.string().describe(
      isDaily
        ? '本篇日常故事的温柔或生活化标题，简明点出人物、场景或日常片段即可，保持自然平和的叙述口吻。'
        : '本场战斗或故事的新闻标题，可以使用震惊体等技巧来吸引读者。',
    ),
    article: z.object({
      body: z.string().describe(
        isDaily
          ? '日常故事正文，聚焦角色日常互动、对话与生活细节；遵守共用创作规则与内容边界，不要无故写成战斗简报。'
          : '战斗简报或故事正文，遵守共用创作规则与内容边界。允许克制的战斗、失败和严肃冲突。',
      ),
      analysis: z.string().describe(
        isDaily
          ? '约100-150字的温和生活侧写与关系观察。可谈性格细节与互动余韵，不得将猜测当成已发生事实，也不得渲染战斗或编造未发生的冲突。'
          : '记者约100-150字的分析。可有个人观察与明确标为猜测的引申，但不得将猜测当成已发生事实或据此更改能力与胜负。',
      ),
    }),
    officialReport: z.object({
      winner: z.string().describe(
        isDaily
          ? "参与角色或结果字段。日常模式默认无胜负，请直接列出所有核心参与角色的名字（可用顿号分隔）；仅在明确进行了日常小游戏或比拼且分出胜负时才写胜者或'平局'。"
          : "胜利者的代号或名称。如果是平局，则返回'平局'。如果是无胜负要素的故事，请列出所有核心参与角色的名字；如果带有竞争性并分出了胜负（如战斗、辩论、比赛），则只写胜利者的名字。",
      ),
      conclusion: z.string().describe(
        isDaily
          ? '对本段日常互动的简短收束与余韵总结，记录当下的心情、氛围或细微关系状态，无需强行升华或硬凑事件闭环。'
          : '对本次事件的总结点评，描述事件带来的最终结果，包括对参与者和相关者的后续影响。',
      ),
    }),
  };

  if (options.enableImpacts) {
    const impactShape: Record<string, z.ZodTypeAny> = {
      characterName: z.string().describe('参与者的代号或名称。'),
    };
    if (options.enableImpactText) {
      impactShape.impact = z.string().describe(
        isDaily
          ? '仅概括本段日常故事中真实发生的经历、心情波动、关系细节或日常约定（含战前休整等状态），不凭空新增未发生的交战、弱点、代价或永久能力。'
          : '仅概括事件证据支持的经历、感悟或变化，不新增弱点、代价或永久能力。',
      );
    }
    if (options.enableCurrentState) {
      impactShape.currentStateSummary = z.string().describe('基于已发生事实的即时状态，区分暂时状态与永久变化，不把本场改编固化为永久设定。');
    }
    baseShape.impacts = z.array(z.object(impactShape)).describe('对每位参与该事件的核心角色的影响总结列表。');
  }

  return z.object(baseShape).describe(
    isDaily
      ? '按日常模式生成真实鲜活的日常生活故事与记录，聚焦人物互动与生活细节而非战斗推演；遵守共用设定忠实性、情景职责和内容边界规则。'
      : '按本场模式与适用世界观生成故事报告；遵守共用设定忠实性、情景职责和内容边界规则。',
  );
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
