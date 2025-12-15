import { queryFromD1 } from '@/lib/d1';
import { config as appConfig } from '@/lib/config';
import { getLogger } from '@/lib/logger';
import { NewsReport } from '@/components/BattleReportCard';
import { ArenaHistoryEntry } from '@/types/arena';
import { inferCharacterKind, inferTemplateId } from '@/lib/schemas';
import { generateSignature, verifySignature } from '@/lib/signature';
import { webcrypto } from 'crypto';

const log = getLogger('arena-service');
const randomUUID =
    typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function'
        ? globalThis.crypto.randomUUID.bind(globalThis.crypto)
        : webcrypto.randomUUID.bind(webcrypto);

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
