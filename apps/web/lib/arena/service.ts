import { getLogger } from '@/lib/logger';
import { NewsReport } from '@/components/BattleReportCard';
import { ArenaHistoryEntry } from '@/types/arena';
import { inferCharacterKind, inferTemplateId } from '@mahoshojo/domain/data-cards';
import { generateSignature, verifySignature } from '@/lib/signature';
import { randomUUID } from '@/lib/crypto';

const log = getLogger('arena-service');

const getScenarioTitle = (scenario: any | null): string | null => {
    if (!scenario || typeof scenario !== 'object') return null;
    const title = typeof scenario?.title === 'string' ? scenario.title.trim() : '';
    if (title) return title;
    const name = typeof scenario?.name === 'string' ? scenario.name.trim() : '';
    if (name) return name;
    return null;
};

export const applyPostBattleUpdates = async (
    combatants: any[],
    report: NewsReport,
    impacts: { characterName: string; impact?: string; currentStateSummary?: string }[],
    userGuidance: string | null,
    scenario: any | null,
    options: {
        writeArenaHistory: boolean;
        writeCurrentState: boolean;
        generationId?: string;
        baseRevisionHash?: string;
        scenarioNativeOverride?: boolean;
    }
): Promise<any[]> => {
    const updatedCombatants = [];
    const participantNames = combatants.map(c => c.data.codename || c.data.name);
    const nowISO = new Date().toISOString();
    const { writeArenaHistory, writeCurrentState } = options;
    const generationId = options.generationId?.trim() || null;
    const baseRevisionHash = options.baseRevisionHash?.trim() || null;

    const nameToNativenessMap = new Map<string, boolean[]>();
    combatants.forEach(c => {
        const name = c.data.codename || c.data.name;
        if (!nameToNativenessMap.has(name)) {
            nameToNativenessMap.set(name, []);
        }
        nameToNativenessMap.get(name)!.push(c.isNative);
    });

    const conflictingNames = new Set<string>();
    for (const [name, nativenessStates] of nameToNativenessMap.entries()) {
        const hasNative = nativenessStates.includes(true);
        const hasNonNative = nativenessStates.includes(false);
        if (hasNative && hasNonNative) {
            conflictingNames.add(name);
            log.warn(`检测到原生性冲突的角色名称: "${name}"。该角色的所有实例在此次战斗中将被视为非原生处理。`);
        }
    }

    const isScenarioNative = options.scenarioNativeOverride
        ?? (scenario ? await verifySignature(scenario) : true);
    const isAnyNonNative = combatants.some(c => !c.isNative || conflictingNames.has(c.data.codename || c.data.name)) || (report.mode === 'scenario' && !isScenarioNative);

    for (const combatant of combatants) {
        const characterData = JSON.parse(JSON.stringify(combatant.data));
        const characterName = characterData.codename || characterData.name;
        const characterGuidance =
            typeof (combatant as any)?.characterGuidance === 'string'
                ? (combatant as any).characterGuidance.trim().slice(0, 100)
                : '';

        if (!characterData.templateId) {
            characterData.templateId = inferTemplateId(characterData);
            log.info(`为旧版角色 "${characterName}" 补充了 templateId: ${characterData.templateId}`);
        }

        const inferredKind = inferCharacterKind(characterData);
        combatant.type =
            inferredKind === 'magical-girl'
                ? 'magical-girl'
                : inferredKind === 'canshou'
                    ? 'canshou'
                    : 'general-character';

        let shouldSign = combatant.isNative;
        if (conflictingNames.has(characterName)) {
            shouldSign = false;
        }
        let didMutate = false;

        if (writeArenaHistory) {
            let history = characterData.arena_history;

            if (!history || !history.attributes || !history.entries) {
                history = {
                    attributes: {
                        world_line_id: randomUUID(),
                        created_at: nowISO,
                        updated_at: nowISO,
                        sublimation_count: 0,
                        last_sublimation_at: null,
                    },
                    entries: [],
                };
            }
            const alreadyApplied = generationId && history.entries.some(
                (entry: ArenaHistoryEntry) => entry.metadata?.generation_id === generationId
                    && (!baseRevisionHash
                        || !entry.metadata?.base_revision_hash
                        || entry.metadata.base_revision_hash === baseRevisionHash)
            );
            if (!alreadyApplied) {
                history.attributes.updated_at = nowISO;
                const lastEntryId = history.entries.length > 0 ? history.entries[history.entries.length - 1].id : 0;
                const characterImpact = impacts.find(i => i.characterName === characterName)?.impact || "在此次事件中获得了成长。";

                const newEntry: ArenaHistoryEntry = {
                    id: lastEntryId + 1,
                    type: report.mode as ArenaHistoryEntry['type'] || 'classic',
                    title: report.headline,
                    participants: participantNames,
                    winner: report.officialReport.winner,
                    impact: characterImpact,
                    metadata: {
                        user_guidance: userGuidance,
                        ...(characterGuidance ? { character_guidance: characterGuidance } : {}),
                        scenario_title: getScenarioTitle(scenario),
                        non_native_data_involved: isAnyNonNative,
                        ...(generationId ? { generation_id: generationId } : {}),
                        ...(baseRevisionHash ? { base_revision_hash: baseRevisionHash } : {}),
                    },
                };

                history.entries.push(newEntry);
                characterData.arena_history = history;
                didMutate = true;
            }
        }

        if (writeCurrentState) {
            const summary = impacts.find(i => i.characterName === characterName)?.currentStateSummary?.trim();
            const currentStateAlreadyApplied = generationId
                && characterData.current_state?.generation_id === generationId
                && (!baseRevisionHash
                    || !characterData.current_state?.base_revision_hash
                    || characterData.current_state.base_revision_hash === baseRevisionHash);
            if (summary && !currentStateAlreadyApplied) {
                const nextState = characterData.current_state ?? { summary: '', fields: [] };
                characterData.current_state = {
                    ...nextState,
                    summary,
                    updated_at: nowISO,
                    ...(generationId ? { generation_id: generationId } : {}),
                    ...(baseRevisionHash ? { base_revision_hash: baseRevisionHash } : {}),
                };
                didMutate = true;
            }
        }

        if (didMutate) {
            if (shouldSign) {
                characterData.signature = await generateSignature(characterData);
            } else {
                delete characterData.signature;
            }

            updatedCombatants.push(characterData);
        }
    }

    return updatedCombatants;
};

export const redoPostBattleUpdates = async (
    combatants: any[],
    report: NewsReport,
    impacts: { characterName: string; impact?: string; currentStateSummary?: string }[],
    userGuidance: string | null,
    scenario: any | null,
    options: { writeArenaHistory: boolean; writeCurrentState: boolean }
): Promise<any[]> => {
    const updatedCombatants = [];
    const participantNames = combatants.map(c => c.data.codename || c.data.name);
    const nowISO = new Date().toISOString();
    const { writeArenaHistory, writeCurrentState } = options;

    const areParticipantsEquivalent = (a: unknown, b: string[]): boolean => {
        if (!Array.isArray(a)) return false;
        if (a.length !== b.length) return false;
        const aSet = new Set(a.map(String));
        const bSet = new Set(b.map(String));
        if (aSet.size !== bSet.size) return false;
        for (const item of aSet) {
            if (!bSet.has(item)) return false;
        }
        return true;
    };

    const nameToNativenessMap = new Map<string, boolean[]>();
    combatants.forEach(c => {
        const name = c.data.codename || c.data.name;
        if (!nameToNativenessMap.has(name)) {
            nameToNativenessMap.set(name, []);
        }
        nameToNativenessMap.get(name)!.push(c.isNative);
    });

    const conflictingNames = new Set<string>();
    for (const [name, nativenessStates] of nameToNativenessMap.entries()) {
        const hasNative = nativenessStates.includes(true);
        const hasNonNative = nativenessStates.includes(false);
        if (hasNative && hasNonNative) {
            conflictingNames.add(name);
            log.warn(`检测到原生性冲突的角色名称: "${name}"。该角色的所有实例在此次战斗中将被视为非原生处理。`);
        }
    }

    const isScenarioNative = scenario ? await verifySignature(scenario) : true;
    const isAnyNonNative = combatants.some(c => !c.isNative || conflictingNames.has(c.data.codename || c.data.name)) || (report.mode === 'scenario' && !isScenarioNative);

	    for (const combatant of combatants) {
	        const characterData = JSON.parse(JSON.stringify(combatant.data));
	        const characterName = characterData.codename || characterData.name;
	        const characterGuidance =
	            typeof (combatant as any)?.characterGuidance === 'string'
	                ? (combatant as any).characterGuidance.trim().slice(0, 100)
	                : '';

	        if (!characterData.templateId) {
	            characterData.templateId = inferTemplateId(characterData);
	            log.info(`为旧版角色 "${characterName}" 补充了 templateId: ${characterData.templateId}`);
	        }

        const inferredKind = inferCharacterKind(characterData);
        combatant.type =
            inferredKind === 'magical-girl'
                ? 'magical-girl'
                : inferredKind === 'canshou'
                    ? 'canshou'
                    : 'general-character';

        let shouldSign = combatant.isNative;
        if (conflictingNames.has(characterName)) {
            shouldSign = false;
        }
        let didMutate = false;

        if (writeArenaHistory) {
            const history = characterData.arena_history;
            if (!history || !history.attributes || !Array.isArray(history.entries) || history.entries.length === 0) {
                throw new Error(`角色 "${characterName}" 没有可重做的历战记录条目（请先完成一次成功写入）。`);
            }

            history.attributes.updated_at = nowISO;

            const targetIndex = (() => {
                let bestIndex = -1;
                let bestScore = -1;

                for (let i = history.entries.length - 1; i >= 0; i -= 1) {
                    const entry = history.entries[i];
                    if (!entry) continue;
                    if (!areParticipantsEquivalent(entry.participants, participantNames)) continue;

                    let score = 0;
                    if (entry.type === report.mode) score += 2;
                    if (entry.winner === report.officialReport.winner) score += 4;
                    if (entry.title === report.headline) score += 1;

                    if (score > bestScore) {
                        bestScore = score;
                        bestIndex = i;
                    }

                    // 已经达到“完美命中”，可提前退出
                    if (bestScore >= 7) {
                        return bestIndex;
                    }
                }

                // 至少要求：参战者一致 + 模式一致，否则视为不可安全重做
                if (bestIndex !== -1 && bestScore >= 2) return bestIndex;
                return -1;
            })();

            if (targetIndex === -1) {
                throw new Error(`角色 "${characterName}" 未找到与本次战报匹配的历战记录条目，已取消重做以避免重复写入。`);
            }

            const characterImpact = impacts.find(i => i.characterName === characterName)?.impact || "在此次事件中获得了成长。";
            const previous = history.entries[targetIndex];
            history.entries[targetIndex] = {
                ...previous,
                impact: characterImpact,
                metadata: {
                    ...(previous?.metadata ?? {}),
                    user_guidance: userGuidance,
                    ...(characterGuidance ? { character_guidance: characterGuidance } : {}),
                    scenario_title: getScenarioTitle(scenario),
                    non_native_data_involved: isAnyNonNative,
                },
            };

            characterData.arena_history = history;
            didMutate = true;
        }

        if (writeCurrentState) {
            const summary = impacts.find(i => i.characterName === characterName)?.currentStateSummary?.trim();
            if (summary) {
                const nextState = characterData.current_state ?? { summary: '', fields: [] };
                characterData.current_state = {
                    ...nextState,
                    summary,
                    updated_at: nowISO,
                };
                didMutate = true;
            }
        }

        if (didMutate) {
            if (shouldSign) {
                characterData.signature = await generateSignature(characterData);
            } else {
                delete characterData.signature;
            }

            updatedCombatants.push(characterData);
        }
    }

    return updatedCombatants;
};
