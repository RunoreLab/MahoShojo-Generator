import type { MagicTeaPartyHistoryMessage } from '@/lib/magic-tea-party/types';

export type MagicTeaPartySystemInstructionKind = 'opening' | 'continue';

const SYSTEM_INSTRUCTION_TEXT: Record<MagicTeaPartySystemInstructionKind, string> = {
  opening: '【任务】请先生成故事开场：描写场景/氛围，安排角色登场，并给出可供玩家回应的钩子。',
  continue: '【任务】请在不等待玩家新输入的情况下，继续推进下一小节剧情。',
};

export const createMagicTeaPartySystemInstruction = (
  kind: MagicTeaPartySystemInstructionKind,
  id: string
): MagicTeaPartyHistoryMessage => ({
  id,
  role: 'system',
  content: SYSTEM_INSTRUCTION_TEXT[kind],
});

export const appendMagicTeaPartySystemInstruction = (
  history: MagicTeaPartyHistoryMessage[],
  kind: MagicTeaPartySystemInstructionKind,
  id: string
): MagicTeaPartyHistoryMessage[] => [...history, createMagicTeaPartySystemInstruction(kind, id)];
