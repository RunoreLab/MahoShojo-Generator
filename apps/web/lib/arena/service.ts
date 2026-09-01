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
        combatantIndices?: number[];
        scenarioNativeOverride?: boolean;
        participantNames?: string[];
        nonNativeDataInvolved?: boolean;
        conflictingNativeNames?: string[];
    }
): Promise<Array<{ combatantIndex: number; data: any; isNative: boolean }>> => {
    const updatedCombatants = [];
    const participantNames = options.participantNames
        ?? combatants.map(c => c.data.codename || c.data.name);
    const nowISO = new Date().toISOString();
    const { writeArenaHistory, writeCurrentState } = options;
    const generationId = options.generationId?.trim() || null;

    const nameToNativenessMap = new Map<string, boolean[]>();
    combatants.forEach(c => {
        const name = c.data.codename || c.data.name;
        if (!nameToNativenessMap.has(name)) {
            nameToNativenessMap.set(name, []);
        }
        nameToNativenessMap.get(name)!.push(c.isNative);
    });

    const normalizeName = (name: unknown): string => typeof name === 'string'
        ? name.replace(/\s+/gu, '').toLocaleLowerCase()
        : '';
    const conflictingNames = new Set(
        options.conflictingNativeNames?.map(normalizeName).filter(Boolean) ?? [],
    );
    for (const [name, nativenessStates] of nameToNativenessMap.entries()) {
        const hasNative = nativenessStates.includes(true);
        const hasNonNative = nativenessStates.includes(false);
        if (hasNative && hasNonNative) {
            conflictingNames.add(normalizeName(name));
            log.warn(`检测到原生性冲突的角色名称: "${name}"。该角色的所有实例在此次战斗中将被视为非原生处理。`);
        }
    }

    const isScenarioNative = options.scenarioNativeOverride
        ?? (scenario ? await verifySignature(scenario) : true);
    const isAnyNonNative = options.nonNativeDataInvolved
        ?? (combatants.some(c => !c.isNative || conflictingNames.has(normalizeName(c.data.codename || c.data.name))) || (report.mode === 'scenario' && !isScenarioNative));

    for (let combatantIndex = 0; combatantIndex < combatants.length; combatantIndex += 1) {
        const combatant = combatants[combatantIndex];
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
        if (conflictingNames.has(normalizeName(characterName))) {
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
            );
            if (!alreadyApplied) {
                history.attributes.updated_at = nowISO;
                const lastEntryId = history.entries.length > 0 ? history.entries[history.entries.length - 1].id : 0;
                const characterImpact = impacts[combatantIndex]?.impact
                    || "在此次事件中获得了成长。";

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
                    },
                };

                history.entries.push(newEntry);
                characterData.arena_history = history;
                didMutate = true;
            }
        }

        if (writeCurrentState) {
            const summary = impacts[combatantIndex]?.currentStateSummary?.trim();
            const currentStateAlreadyApplied = generationId
                && characterData.current_state?.generation_id === generationId;
            if (summary && !currentStateAlreadyApplied) {
                const nextState = characterData.current_state ?? { summary: '', fields: [] };
                characterData.current_state = {
                    ...nextState,
                    summary,
                    updated_at: nowISO,
                    ...(generationId ? { generation_id: generationId } : {}),
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

            updatedCombatants.push({
                combatantIndex: options.combatantIndices?.[combatantIndex] ?? combatantIndex,
                data: characterData,
                isNative: shouldSign,
            });
        }
    }

    return updatedCombatants;
};
