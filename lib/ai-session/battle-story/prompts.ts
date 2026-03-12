import type {
  BattleStoryChapterPlan,
  BattleStoryChapterPlanLimit,
  BattleStoryDeterministicDigest,
  BattleStoryPromptContextResult,
  BattleStorySessionAction,
} from '@/lib/ai-session/battle-story/types';
import { resolveBattleStoryPromptChapterPlanState } from '@/lib/ai-session/battle-story/plan';

const normalizeText = (value: unknown): string => {
  return typeof value === 'string' ? value.trim() : '';
};

const buildActionInstruction = (params: {
  action: BattleStorySessionAction;
  chapterIndex: number;
  sourceChapterId?: string;
}): string => {
  if (params.action === 'rewrite') {
    return `当前任务是重写第 ${params.chapterIndex} 章。请保持前文章节已经成立的事实不变，只重写当前章节的展开、措辞与结果呈现。${params.sourceChapterId ? `被重写章节 ID：${params.sourceChapterId}。` : ''}`;
  }

  if (params.action === 'branch') {
    return `当前任务是从既有故事中分支续写第 ${params.chapterIndex} 章。请把分支点之前的内容视为既定事实，并在其后发展出新的走向。${params.sourceChapterId ? `分支来源章节 ID：${params.sourceChapterId}。` : ''}`;
  }

  if (params.action === 'continue') {
    return `当前任务是续写第 ${params.chapterIndex} 章。请承接既有章节与角色状态，不要把前文重新从头概述一遍。`;
  }

  return `当前任务是生成连续战报会话的首章（第 ${params.chapterIndex} 章）。请建立清晰的冲突、局势与角色状态变化，为后续章节留出延展空间。`;
};

export const buildBattleStoryInternalGuidance = (params: {
  action: BattleStorySessionAction;
  chapterIndex: number;
  sourceChapterId?: string;
  chapterPlan?: BattleStoryChapterPlan | BattleStoryChapterPlanLimit | null;
  context: BattleStoryPromptContextResult;
}): string => {
  const chapterPlanState =
    params.context.chapterPlanState ??
    resolveBattleStoryPromptChapterPlanState({
      chapterPlan: params.chapterPlan,
      chapterIndex: params.chapterIndex,
    });
  const chapterPlanInstruction = chapterPlanState
    ? chapterPlanState.isFinalChapter
      ? `本会话计划共 ${chapterPlanState.totalChapters} 章，当前正在生成第 ${chapterPlanState.currentChapterIndex} 章。本章是终章。请完成主线收束，交代主要冲突结果与角色余波，不要再强行留下“下一章继续”的空钩子。`
      : `本会话计划共 ${chapterPlanState.totalChapters} 章，当前正在生成第 ${chapterPlanState.currentChapterIndex} 章。本章不是终章。请推进主线，但不要提前把整条故事直接写到最终结局；结尾需要留下可供下一章承接的明确变化、悬念或阶段结果。`
    : '';
  const parts = [
    '你当前正在生成“连续战报会话”的一个章节。',
    '以下上下文全部属于既定事实，只能在此基础上继续发展，不得否定、覆盖或随意改写。',
    buildActionInstruction({
      action: params.action,
      chapterIndex: params.chapterIndex,
      sourceChapterId: params.sourceChapterId,
    }),
    chapterPlanInstruction,
    '要求：延续角色当前状态、保留已经发生的关键结果、避免机械复述上下文、正文必须仍然是一份可独立阅读的战报。',
    params.context.promptText,
  ];

  return parts.filter(Boolean).join('\n\n');
};

const digestToBlock = (digest: BattleStoryDeterministicDigest, index: number): string => {
  const lines = [`### 第 ${index} 章：${normalizeText(digest.chapterTitle) || `第 ${index} 章`}`];
  if (digest.winner) lines.push(`胜利者：${digest.winner}`);
  if (digest.officialConclusion) lines.push(`结论：${digest.officialConclusion}`);
  if (digest.bodyExcerpt) lines.push(`剧情摘要：${digest.bodyExcerpt}`);
  if (Array.isArray(digest.impactDigest) && digest.impactDigest.length > 0) {
    lines.push(
      `角色变化：${digest.impactDigest
        .map((item) => {
          const fragments = [item.characterName];
          if (item.impact) fragments.push(`变化=${item.impact}`);
          if (item.currentStateSummary) fragments.push(`状态=${item.currentStateSummary}`);
          return fragments.join(' / ');
        })
        .join('；')}`
    );
  }
  return lines.join('\n');
};

export const buildBattleStorySummaryPrompt = (params: {
  previousSummary?: string;
  digests: Array<BattleStoryDeterministicDigest & { index: number }>;
  language: string;
}): string => {
  const digestBlocks = params.digests.map((digest) => digestToBlock(digest, digest.index)).join('\n\n');
  const previousSummary = normalizeText(params.previousSummary);

  return [
    `请使用【${normalizeText(params.language) || 'zh-CN'}】生成一段“连续战报会话摘要”。`,
    '要求：只总结输入中已经出现的事实，不得编造新剧情；需要保留主线推进、胜负趋势、角色状态变化与仍未解决的矛盾；输出为一段供后续续写使用的紧凑摘要，不要写标题，不要写项目符号。',
    previousSummary ? `【已有摘要】\n${previousSummary}` : '',
    `【新增章节摘要材料】\n${digestBlocks}`,
  ]
    .filter(Boolean)
    .join('\n\n');
};

export const buildBattleStorySummaryFallback = (params: {
  previousSummary?: string;
  digests: Array<BattleStoryDeterministicDigest & { index: number }>;
}): string => {
  const blocks = params.digests.map((digest) => {
    const fragments = [`第${digest.index}章`];
    if (digest.chapterTitle) fragments.push(digest.chapterTitle);
    if (digest.winner) fragments.push(`胜者：${digest.winner}`);
    if (digest.officialConclusion) fragments.push(`结果：${digest.officialConclusion}`);
    else if (digest.bodyExcerpt) fragments.push(`经过：${digest.bodyExcerpt}`);
    return fragments.join('，');
  });

  return [normalizeText(params.previousSummary), blocks.join('；')].filter(Boolean).join('；');
};
