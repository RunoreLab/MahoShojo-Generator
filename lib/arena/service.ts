import { queryFromD1 } from '@/lib/d1';
import { config as appConfig } from '@/lib/config';
import { getLogger } from '@/lib/logger';
import { NewsReport } from '@/components/BattleReportCard';
import { ArenaHistoryEntry } from '@/types/arena';
import { inferCharacterKind, inferTemplateId } from '@/lib/schemas';
import { generateSignature, verifySignature } from '@/lib/signature';
import { randomUUID } from '@/lib/crypto';

const log = getLogger('arena-service');

export const applyPostBattleUpdates = async (
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
            } else {
                history.attributes.updated_at = nowISO;
            }

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
                    scenario_title: scenario?.title || null,
                    non_native_data_involved: isAnyNonNative,
                },
            };

            history.entries.push(newEntry);
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
                    scenario_title: scenario?.title || null,
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

export const updateBattleStats = async (winnerName: string, participants: any[]) => {
    if (!appConfig.SHOW_STAT_DATA) return;

    try {
        const isCompetitiveMode = !winnerName.includes('、') && !winnerName.includes(',');

        for (const participant of participants) {
            const name = participant.data.codename || participant.data.name;
            const isPreset = !!participant.data.isPreset;

            const isWinner = isCompetitiveMode && name === winnerName && winnerName !== '平局';
            const isLoser = isCompetitiveMode && name !== winnerName && winnerName !== '平局';

            await queryFromD1(
                "INSERT INTO characters (name, is_preset) VALUES (?, ?) ON CONFLICT(name) DO NOTHING;",
                [name, isPreset ? 1 : 0]
            );

            let sql = 'UPDATE characters SET participations = participations + 1';

            if (isWinner) {
                sql += ', wins = wins + 1';
            } else if (isLoser) {
                sql += ', losses = losses + 1';
            }

            sql += ' WHERE name = ?;';

            await queryFromD1(sql, [name]);
        }

        const participantNames = participants.map(p => p.data.codename || p.data.name);
        await queryFromD1(
            "INSERT INTO battles (winner_name, participants_json, created_at) VALUES (?, ?, ?);",
            [winnerName, JSON.stringify(participantNames), new Date().toISOString()]
        );

        log.info('成功更新事件统计数据到 D1');
    } catch (error) {
        log.error('更新 D1 数据库失败:', { error });
    }
};
