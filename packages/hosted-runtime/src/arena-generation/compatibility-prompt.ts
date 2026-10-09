// Compatibility surface; random adjudication remains server-owned.
export * from '@mahoshojo/ai-core/arena-generation';
import type { ArenaPromptAdjudicatorEvent, ArenaPromptAdjudicationResult } from '@mahoshojo/ai-core/arena-generation';

export const processAdjudicationChain = (events: ArenaPromptAdjudicatorEvent[], depth = 0): ArenaPromptAdjudicationResult[] => {
    const allResults: ArenaPromptAdjudicationResult[] = [];

    for (const event of events) {
        const roll = Math.floor(Math.random() * 100) + 1;
        let outcomeName = "未知";
        let details = "";
        let nextEvent: ArenaPromptAdjudicatorEvent | undefined = undefined;

        if (event.type === 'binary' && event.probability) {
            const isSuccess = roll <= event.probability;
            outcomeName = isSuccess ? '成功' : '失败';
            details = `掷骰(${roll}) vs 成功率(${event.probability}%)`;
            if (isSuccess && event.onSuccess) {
                nextEvent = event.onSuccess.event;
            } else if (!isSuccess && event.onFailure) {
                nextEvent = event.onFailure.event;
            }
        } else if (event.type === 'custom' && event.outcomes) {
            let cumulativeProbability = 0;
            const totalProb = event.outcomes.reduce((sum, o) => sum + o.probability, 0);
            const scale = 100 / (totalProb || 100);

            for (const outcome of event.outcomes) {
                cumulativeProbability += outcome.probability * scale;
                if (roll <= cumulativeProbability) {
                    outcomeName = outcome.name;
                    details = `掷骰(${roll}) 落在区间 [${(cumulativeProbability - outcome.probability * scale).toFixed(1)}, ${cumulativeProbability.toFixed(1)}]`;
                    if (outcome.chainedEvent) {
                        nextEvent = outcome.chainedEvent.event;
                    }
                    break;
                }
            }
        }

        allResults.push({
            depth,
            description: event.description,
            type: event.type,
            roll,
            outcome: outcomeName,
            details,
        });

        if (nextEvent) {
            allResults.push(...processAdjudicationChain([nextEvent], depth + 1));
        }
    }

    return allResults;
};
