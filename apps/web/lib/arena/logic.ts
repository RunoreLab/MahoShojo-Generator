import { ArenaHistory, CharacterCurrentState } from '@/types/arena';
import { formatQuestionnaireAnswers, normalizeUserAnswers } from '@/lib/questionnaires';

export const filterAndFormatHistory = (
    characterName: string,
    history: ArenaHistory | undefined,
    otherParticipantNames: string[],
    isPureBattle: boolean,
    limit?: number | null
): string => {
    if (!history || !history.entries || history.entries.length === 0) {
        return '';
    }

    let relevantEntries = [...history.entries];

    if (isPureBattle) {
        relevantEntries = relevantEntries.filter(
            entry => !entry.metadata.user_guidance && !entry.metadata.scenario_title && !(entry.metadata as any)?.character_guidance
        );
    }

    relevantEntries.sort((a, b) => {
        const aIsRelevant = a.participants.some(p => otherParticipantNames.includes(p));
        const bIsRelevant = b.participants.some(p => otherParticipantNames.includes(p));
        if (aIsRelevant && !bIsRelevant) return -1;
        if (!aIsRelevant && bIsRelevant) return 1;
        return b.id - a.id;
    });

    const sliceLimit = limit === null
        ? Infinity
        : typeof limit === 'number' && limit > 0
            ? limit
            : 20;
    const selectedEntries = sliceLimit === Infinity
        ? relevantEntries
        : relevantEntries.slice(0, sliceLimit);

    if (selectedEntries.length === 0) {
        return '';
    }

    const formattedHistory = selectedEntries.map(entry => {
        const g = typeof (entry.metadata as any)?.character_guidance === 'string' ? (entry.metadata as any).character_guidance.trim() : '';
        return `- 事件: "${entry.title}", 胜利者: ${entry.winner}, 对${characterName}的影响: "${entry.impact}"${g ? `, 当时的角色行动引导: "${g}"` : ''}`;
    }).join('\n');

    return `\n// ${characterName}的过往重要经历回顾:\n${formattedHistory}\n`;
};

export const formatCurrentStateForPrompt = (state: CharacterCurrentState | undefined): string => {
    if (!state) return '';
    const lines: string[] = [];
    if (state.summary?.trim()) {
        lines.push(`- 状态摘要: ${state.summary.trim()}`);
    }
    if (Array.isArray(state.fields) && state.fields.length > 0) {
        lines.push('- 结构化状态点:');
        state.fields.forEach(field => {
            const value = field.type === 'boolean'
                ? (field.value ? '是' : '否')
                : field.type === 'number'
                    ? field.value
                    : field.value;
            lines.push(`  • ${field.label} (${field.type}): ${value}`);
        });
    }
    if (lines.length === 0) return '';
    return `\n// 当前状态快照\n${lines.join('\n')}\n`;
};

export const formatUserAnswersForPrompt = (userAnswers: unknown, questions: string[]): string => {
    if (!userAnswers) return '';
    const normalized = normalizeUserAnswers(userAnswers, questions);
    if (normalized.length === 0) return '';
    const answerText = formatQuestionnaireAnswers(normalized);
    if (!answerText) return '';
    return `\n// 问卷回答 (用于理解角色深层性格与理念)\n${answerText}\n`;
};
