import type {
  ArenaGenerationTerminalRecord,
  ArenaGenerationTerminalStore,
} from '@mahoshojo/hosted-api/arena-generation/service';
import type {
  ArenaGenerationFinalizationPorts,
  ArenaTerminalClaimInput,
} from './finalization';
import type { NodeDataD1Client } from '../node-runtime/data-ports';
import { hashArenaCombatantBaseRevision } from '@mahoshojo/domain/arena-reconciliation';

const OUTPUT_KIND = 'battle_report_generation_output';
const OUTPUT_PREVIEW_CHARS = 120_000;
const LOCAL_RECONCILIATION_MAX_BYTES = 64 * 1_024;
export const MAX_ARENA_TERMINAL_COMBATANTS = 32;
export const MAX_ARENA_TERMINAL_EXTRA_JSON_BYTES = 96 * 1_024;
const MAX_ARENA_TERMINAL_IMPACTS = 32;

export type ArenaGenerationObjectStore = {
  put(_input: {
    key: string;
    body: string;
    contentType: string;
    signal: AbortSignal;
  }): Promise<{
    bytes: number;
    storedBytes: number;
    contentEncoding: string | null;
  }>;
  getText(_key: string): Promise<string>;
};

export type NodeArenaGenerationPersistenceOptions = {
  getD1Client(): NodeDataD1Client | null;
  objectStore?: ArenaGenerationObjectStore;
  now?: () => Date;
  settleRatings?(_generationId: string): Promise<void>;
  readRanking?(_generationId: string): Promise<unknown | null>;
};

const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const actorUserId = (actorKey: string): number | null => {
  const match = actorKey.match(/^user:(\d+)$/u);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
};

const outputKey = (generationId: string): string => (
  `v1/battle-report-generations/${generationId}/output.md`
);

const numberOf = (value: unknown): number | null => (
  typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : null
);

const stringOf = (value: unknown): string | null => (
  typeof value === 'string' && value.trim() ? value.trim() : null
);

const boundedString = (value: unknown, maxChars: number): string | null => (
  stringOf(value)?.slice(0, maxChars) ?? null
);

const boundedStringArray = (
  value: unknown,
  maxItems: number,
  maxChars: number,
): string[] => Array.isArray(value)
  ? value.slice(0, maxItems).flatMap((item) => {
    const bounded = boundedString(item, maxChars);
    return bounded ? [bounded] : [];
  })
  : [];

const jsonBytes = (value: unknown): number => new TextEncoder().encode(
  JSON.stringify(value),
).byteLength;

const booleanInt = (value: unknown): number | null => (
  typeof value === 'boolean' ? (value ? 1 : 0) : null
);

const recordOf = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const parseExtra = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== 'string' || !value) return null;
  try {
    return recordOf(JSON.parse(value));
  } catch {
    return null;
  }
};

const streamReport = (metadata: Record<string, unknown>): Record<string, unknown> | null => {
  const streamMeta = recordOf(metadata.streamMeta);
  return recordOf(streamMeta?.meta)?.report as Record<string, unknown> | null
    ?? recordOf(streamMeta?.report);
};

const streamImpacts = (metadata: Record<string, unknown>): Array<Record<string, unknown>> => {
  const streamMeta = recordOf(metadata.streamMeta);
  const meta = recordOf(streamMeta?.meta) ?? streamMeta;
  return Array.isArray(meta?.impacts)
    ? meta.impacts.flatMap((value) => recordOf(value) ? [recordOf(value)!] : [])
    : [];
};

const headlineFromMarkdown = (markdown: string): string | null => {
  for (const line of markdown.split(/\r?\n/u)) {
    const match = line.trim().match(/^#{1,3}\s+(.+)$/u);
    if (match?.[1]) return match[1].trim().slice(0, 300);
  }
  return null;
};

const winnerFromMarkdown = (markdown: string): string | null => {
  const lines = markdown.split(/\r?\n/u);
  const index = lines.findIndex((line) => /^##\s*(?:胜利者|winner)\s*$/iu.test(line.trim()));
  if (index < 0) return null;
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const value = lines[cursor]?.trim();
    if (!value) continue;
    if (value.startsWith('#')) return null;
    return value.replace(/^[>*_`\s-]+|[>*_`\s-]+$/gu, '').slice(0, 300) || null;
  }
  return null;
};

const terminalStatus = (value: ArenaTerminalClaimInput['status']): string => (
  value === 'cancelled' ? 'aborted' : value === 'producer_lost' ? 'failed' : value
);

const generationAuditContext = (serverContext: Record<string, unknown> | null): {
  generationMode: 'stream' | 'non-stream';
  endpoint: string;
} => {
  const endpoint = stringOf(serverContext?.endpoint);
  if (endpoint === 'api/arena/generate') {
    return { generationMode: 'non-stream', endpoint };
  }
  if (endpoint === 'api/generate-battle-story') {
    return { generationMode: 'non-stream', endpoint };
  }
  if (endpoint === 'api/arena/session/generate-next') {
    return { generationMode: 'stream', endpoint };
  }
  return { generationMode: 'stream', endpoint: 'api/arena/generate-stream' };
};

const buildExtraJson = async (
  input: ArenaTerminalClaimInput,
): Promise<Record<string, unknown>> => {
  const serverContext = recordOf(input.payload.__arenaServerContextV1);
  const season = recordOf(serverContext?.season);
  const seasonAuthorityAvailable = season?.authorityAvailable === true;
  const scenarioFileName = stringOf(input.payload.scenarioFileName);
  const safeScenarioFileName = scenarioFileName
    && scenarioFileName.length <= 128
    && !scenarioFileName.includes('/')
    && !scenarioFileName.includes('\\')
    && !scenarioFileName.includes('..')
    ? scenarioFileName
    : null;
  const boundedCombatants = Array.isArray(input.payload.combatants)
    ? input.payload.combatants.slice(0, MAX_ARENA_TERMINAL_COMBATANTS)
    : [];
  const combatantsFallback = boundedCombatants
    .map((value, sortIndex) => {
      const combatant = recordOf(value);
      const data = recordOf(combatant?.data);
      return {
        sortIndex,
        name: boundedString(data?.codename, 300)
          ?? boundedString(data?.name, 300)
          ?? `未知角色#${sortIndex + 1}`,
        type: boundedString(combatant?.type, 64),
        templateId: boundedString(combatant?.filename, 256)
          ?? boundedString(data?.templateId, 256),
        isNative: combatant?.isNative === true,
        isPreset: combatant?.isPreset === true,
        teamId: numberOf(combatant?.teamId),
        characterGuidance: boundedString(combatant?.characterGuidance, 100),
        dataCardId: boundedString(combatant?.sourceDataCardId, 128),
        dataCardUpdatedAt: boundedString(combatant?.sourceDataCardUpdatedAt, 128),
      };
    });
  const baseRevisionHash = await hashArenaCombatantBaseRevision(
    boundedCombatants,
  );
  const report = streamReport(input.metadata);
  const scenario = recordOf(input.payload.scenario);
  const reconciliationCandidate = {
    report: {
      headline: boundedString(report?.headline, 300) ?? headlineFromMarkdown(input.markdown) ?? '',
      mode: boundedString(input.payload.mode, 64) ?? 'classic',
      officialReport: {
        winner: boundedString(report?.winner, 300) ?? winnerFromMarkdown(input.markdown) ?? '',
      },
    },
    impacts: streamImpacts(input.metadata).slice(0, MAX_ARENA_TERMINAL_IMPACTS).flatMap((impact) => {
      const characterName = boundedString(impact.characterName, 300);
      if (!characterName) return [];
      return [{
        characterName,
        impact: boundedString(impact.impact, 2_000),
        currentStateSummary: boundedString(impact.currentStateSummary, 2_000),
      }];
    }),
    rosterCount: combatantsFallback.length,
    baseRevisionHash,
    userGuidance: boundedString(input.payload.userGuidance, 600),
    scenario: {
      title: boundedString(scenario?.title, 300) ?? boundedString(scenario?.name, 300),
      isNative: serverContext?.scenarioNative === true,
    },
    writeArenaHistory: input.payload.writeArenaHistory === true,
    writeCurrentState: input.payload.writeCurrentState === true,
  };
  const localCardReconciliation = jsonBytes(reconciliationCandidate) <= LOCAL_RECONCILIATION_MAX_BYTES
    ? reconciliationCandidate
    : {
      available: false,
      reason: 'manifest_budget_exceeded',
      baseRevisionHash,
      rosterCount: combatantsFallback.length,
    };
  const authority = {
    generationRequestId: boundedString(input.generationRequestId, 128),
    generationOwnerHash: await sha256(input.actorKey),
    generationPayloadHash: boundedString(input.payloadHash, 128),
    generationTerminalStatus: input.status,
    finalizationCompleted: false,
    resultRef: boundedString(input.resultRef, 512),
    errorCode: boundedString(input.errorCode, 80),
  };
  const candidate = {
    ...authority,
    arenaStrictPolicy: seasonAuthorityAvailable ? '1+3:v1' : null,
    arenaFreeRankingEnabled: input.payload.arenaFreeRankingEnabled === true,
    seasonId: seasonAuthorityAvailable ? boundedString(season?.seasonId, 128) : null,
    seasonMode: seasonAuthorityAvailable && boundedString(season?.mode, 64) !== 'classic'
      ? boundedString(season?.mode, 64)
      : null,
    seasonStoryGuidance: seasonAuthorityAvailable ? boundedString(season?.storyGuidance, 4_000) : null,
    seasonScenarioPreset: seasonAuthorityAvailable
      ? boundedString(season?.scenarioPresetFilename, 128)
      : null,
    seasonQuestionnaireLoreAllowed: seasonAuthorityAvailable
      && season?.questionnaireLoreAllowed === true
      ? true
      : null,
    seasonQuestionnaireLorePresetIds: seasonAuthorityAvailable
      ? boundedStringArray(season?.questionnaireLorePresetIds, 50, 128)
      : [],
    readNarrativeHistory: input.payload.readNarrativeHistory === true,
    narrativeHistoryReadLimit: numberOf(input.payload.narrativeHistoryReadLimit),
    narrativeHistoryReadCount: numberOf(input.payload.narrativeHistoryReadCount) ?? 0,
    questionnaireLoreEnabled: input.payload.questionnaireLoreEnabled === true,
    questionnaireLoreIds: boundedStringArray(input.payload.questionnaireLoreIds, 50, 128),
    scenarioFileName: safeScenarioFileName,
    auxScenarioCount: Array.isArray(input.payload.auxScenarios)
      ? input.payload.auxScenarios.length
      : 0,
    materialCount: Array.isArray(input.payload.materials) ? input.payload.materials.length : 0,
    materialSourceTypes: boundedStringArray(input.payload.materialSourceTypes, 10, 64),
    resolvedModelOverride: boundedString(input.telemetry.model, 256),
    combatantsFallback,
    localCardReconciliation,
  };
  if (jsonBytes(candidate) <= MAX_ARENA_TERMINAL_EXTRA_JSON_BYTES) return candidate;
  const compact = {
    ...authority,
    combatantsFallback,
    localCardReconciliation: {
      available: false,
      reason: 'manifest_budget_exceeded',
      baseRevisionHash,
      rosterCount: combatantsFallback.length,
    },
  };
  if (jsonBytes(compact) <= MAX_ARENA_TERMINAL_EXTRA_JSON_BYTES) return compact;
  return {
    ...authority,
    combatantsFallback: [],
    localCardReconciliation: {
      available: false,
      reason: 'manifest_budget_exceeded',
      baseRevisionHash,
      rosterCount: combatantsFallback.length,
    },
  };
};

const readStoredClaim = async (
  client: NodeDataD1Client,
  input: ArenaTerminalClaimInput,
): Promise<{
  resultRef: string | null;
  finalized: boolean;
  status: string | null;
}> => {
  const result = await client.prepare(`
SELECT id, status, extra_json
FROM battle_report_generations
WHERE id = ?
LIMIT 1
  `.trim()).bind(input.generationId).all({ retry: 'safe-read' });
  const row = result.results[0];
  const extra = parseExtra(row?.extra_json);
  if (
    !row
    || extra?.generationRequestId !== input.generationRequestId
    || extra?.generationOwnerHash !== await sha256(input.actorKey)
    || extra?.generationPayloadHash !== input.payloadHash
  ) throw new Error('ARENA_TERMINAL_CLAIM_CONFLICT');
  return {
    resultRef: stringOf(extra.resultRef),
    finalized: extra.finalizationCompleted === true,
    status: stringOf(extra.generationTerminalStatus),
  };
};

type StoredTerminalRow = Record<string, unknown>;

const readStoredTerminalRow = async (
  client: NodeDataD1Client,
  generationId: string,
): Promise<StoredTerminalRow | null> => {
  const result = await client.prepare(`
SELECT
  brg.id,
  brg.status,
  brg.updated_at,
  brg.output_preview,
  brg.extra_json,
  lo.r2_key
FROM battle_report_generations AS brg
LEFT JOIN large_objects AS lo
  ON lo.kind = '${OUTPUT_KIND}' AND lo.owner_ref_id = brg.id
WHERE brg.id = ?
LIMIT 1
  `.trim()).bind(generationId).all({ retry: 'safe-read' });
  return result.results[0] ?? null;
};

const logicalTerminalStatus = (
  row: StoredTerminalRow,
  extra: Record<string, unknown>,
): ArenaGenerationTerminalRecord['status'] | null => {
  const logicalStatus = stringOf(extra.generationTerminalStatus);
  if (
    logicalStatus === 'completed'
    || logicalStatus === 'failed'
    || logicalStatus === 'producer_lost'
    || logicalStatus === 'cancelled'
  ) return logicalStatus;
  if (row.status === 'completed' || row.status === 'failed') return row.status;
  return row.status === 'aborted' ? 'cancelled' : null;
};

const validateStoredTerminalIdentity = async (input: {
  row: StoredTerminalRow;
  generationRequestId: string;
  actorKey: string;
  payloadHash?: string;
}): Promise<Record<string, unknown>> => {
  const extra = parseExtra(input.row.extra_json);
  if (
    !extra
    || extra.generationRequestId !== input.generationRequestId
    || extra.generationOwnerHash !== await sha256(input.actorKey)
    || (input.payloadHash !== undefined && extra.generationPayloadHash !== input.payloadHash)
  ) throw new Error('ARENA_TERMINAL_CLAIM_CONFLICT');
  return extra;
};

const materializeStoredTerminal = async (input: {
  row: StoredTerminalRow;
  generationId: string;
  actorKey: string;
  objectStore?: ArenaGenerationObjectStore;
  requireFinalized: boolean;
}): Promise<ArenaGenerationTerminalRecord | null> => {
  const extra = parseExtra(input.row.extra_json);
  if (
    !extra
    || extra.generationOwnerHash !== await sha256(input.actorKey)
    || (input.requireFinalized && extra.finalizationCompleted !== true)
  ) return null;
  const status = logicalTerminalStatus(input.row, extra);
  const requestId = stringOf(extra.generationRequestId);
  if (!status || !requestId) return null;
  const resultRef = stringOf(extra.resultRef);
  const r2Key = stringOf(input.row['r2_key']);
  let markdown = stringOf(input.row['output_preview']) ?? '';
  let contentAvailable = status !== 'completed';
  if (status === 'completed' && r2Key && resultRef) {
    if (input.objectStore) {
      try {
        markdown = await input.objectStore.getText(r2Key);
        contentAvailable = true;
      } catch {
        contentAvailable = false;
      }
    }
  }
  return {
    generationId: input.generationId,
    generationRequestId: requestId,
    status,
    updatedAt: stringOf(input.row['updated_at']) ?? new Date(0).toISOString(),
    resultRef,
    markdown,
    reasoning: '',
    payloadHash: stringOf(extra.generationPayloadHash),
    contentAvailable,
  };
};

const persistFallbackCombatants = async (input: {
  client: NodeDataD1Client;
  generationId: string;
  extra: Record<string, unknown>;
  createdAt: string;
}): Promise<void> => {
  const fallback = Array.isArray(input.extra.combatantsFallback)
    ? input.extra.combatantsFallback.slice(0, 32)
    : [];
  for (let index = 0; index < fallback.length; index += 1) {
    const combatant = recordOf(fallback[index]);
    if (!combatant) continue;
    await input.client.prepare(`
INSERT OR IGNORE INTO battle_report_generation_combatants (
  generation_id, sort_index, name, type, template_id, is_native, is_preset,
  team_id, character_guidance, data_card_id, data_card_updated_at,
  size_chars, size_bytes, created_at
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
    `.trim()).bind(
      input.generationId,
      numberOf(combatant.sortIndex) ?? index,
      boundedString(combatant.name, 300) ?? `未知角色#${index + 1}`,
      boundedString(combatant.type, 64),
      boundedString(combatant.templateId, 256),
      booleanInt(combatant.isNative),
      booleanInt(combatant.isPreset),
      numberOf(combatant.teamId),
      boundedString(combatant.characterGuidance, 100),
      boundedString(combatant.dataCardId, 128),
      boundedString(combatant.dataCardUpdatedAt, 128),
      input.createdAt,
    ).run({ retry: 'none' });
  }
};

export const createNodeArenaGenerationFinalizationPorts = (
  options: NodeArenaGenerationPersistenceOptions,
): ArenaGenerationFinalizationPorts => {
  const now = options.now ?? (() => new Date());
  const ports: ArenaGenerationFinalizationPorts = {
    async storeOutput(input) {
      const client = options.getD1Client();
      if (!client || !options.objectStore) return { resultRef: null };
      const timestamp = now();
      const key = outputKey(input.generationId);
      const stored = await options.objectStore.put({
        key,
        body: input.markdown,
        contentType: 'text/markdown; charset=utf-8',
        signal: input.signal,
      });
      const id = `arena-output:${input.generationId}`;
      await client.prepare(`
INSERT INTO large_objects (
  id, kind, owner_ref_id, owner_user_id, r2_key, bytes, stored_bytes,
  sha256, content_type, content_encoding, created_at, updated_at
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(kind, owner_ref_id) DO UPDATE SET
  owner_user_id = excluded.owner_user_id,
  r2_key = excluded.r2_key,
  bytes = excluded.bytes,
  stored_bytes = excluded.stored_bytes,
  content_type = excluded.content_type,
  content_encoding = excluded.content_encoding,
  updated_at = excluded.updated_at
      `.trim()).bind(
        id,
        OUTPUT_KIND,
        input.generationId,
        actorUserId(input.actorKey),
        key,
        stored.bytes,
        stored.storedBytes,
        null,
        'text/markdown; charset=utf-8',
        stored.contentEncoding,
        timestamp.toISOString(),
        timestamp.toISOString(),
      ).run({ retry: 'none' });
      return { resultRef: `r2:${key}` };
    },

    async claimTerminal(input) {
      const client = options.getD1Client();
      if (!client) throw new Error('ARENA_D1_UNAVAILABLE');
      const endedAt = now();
      const serverContext = recordOf(input.payload.__arenaServerContextV1);
      const auditContext = generationAuditContext(serverContext);
      const startedAtIso = stringOf(serverContext?.startedAt) ?? endedAt.toISOString();
      const startedAtMs = Date.parse(startedAtIso);
      const durationMs = Number.isFinite(startedAtMs)
        ? Math.max(0, endedAt.getTime() - startedAtMs)
        : 0;
      const report = streamReport(input.metadata);
      const customProvider = recordOf(input.payload.customProvider);
      const pvp = recordOf(input.payload.pvpContext);
      const usage = recordOf(input.telemetry.usage);
      const extraJson = await buildExtraJson(input);
      const markdownBytes = new TextEncoder().encode(input.markdown).byteLength;
      const preview = input.markdown.slice(0, OUTPUT_PREVIEW_CHARS);
      let inserted: Awaited<ReturnType<ReturnType<NodeDataD1Client['prepare']>['run']>>;
      try {
        inserted = await client.prepare(`
INSERT OR IGNORE INTO battle_report_generations (
  id, started_at, ended_at, duration_ms, status, generation_mode, endpoint,
  ip_anonymized, mode, user_id, scenario_title, scenario_data_card_id,
  scenario_data_card_updated_at, language, story_length, pvp_room_id,
  pvp_match_id, pvp_round_id, read_arena_history, arena_history_read_limit,
  write_arena_history, read_current_state, write_current_state, combatant_count,
  has_scenario, has_user_guidance, has_adjudication_events, has_teams,
  custom_provider_id, custom_model_id, ai_provider_name, ai_provider_type,
  ai_model, headline, winner, output_chars, output_bytes, prompt_tokens,
  completion_tokens, total_tokens, cached_tokens, reasoning_tokens,
  user_guidance_preview, output_preview, extra_json, created_at, updated_at
)
VALUES (
  ?, ?, ?, ?, ?, ?, ?,
  ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
  ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
)
      `.trim()).bind(
        input.generationId,
        startedAtIso,
        endedAt.toISOString(),
        durationMs,
        terminalStatus(input.status),
        auditContext.generationMode,
        auditContext.endpoint,
        boundedString(serverContext?.ipAnonymized, 128),
        boundedString(input.payload.mode, 64) ?? 'classic',
        actorUserId(input.actorKey),
        boundedString(input.payload.scenarioTitle, 300)
          ?? boundedString(recordOf(input.payload.scenario)?.title, 300),
        boundedString(input.payload.scenarioSourceDataCardId, 128),
        boundedString(input.payload.scenarioSourceDataCardUpdatedAt, 128),
        boundedString(input.payload.language, 32),
        boundedString(input.payload.customStoryLength, 32)
          ?? boundedString(input.payload.storyLength, 32),
        boundedString(pvp?.roomId, 128),
        boundedString(pvp?.matchId, 128),
        boundedString(pvp?.roundId, 128),
        booleanInt(input.payload.readArenaHistory),
        numberOf(input.payload.arenaHistoryReadLimit),
        booleanInt(input.payload.writeArenaHistory),
        booleanInt(input.payload.readCurrentState),
        booleanInt(input.payload.writeCurrentState),
        Array.isArray(input.payload.combatants)
          ? Math.min(input.payload.combatants.length, MAX_ARENA_TERMINAL_COMBATANTS)
          : null,
        input.payload.scenario ? 1 : 0,
        stringOf(input.payload.userGuidance) ? 1 : 0,
        Array.isArray(input.payload.adjudicationEvents) && input.payload.adjudicationEvents.length > 0 ? 1 : 0,
        recordOf(input.payload.teams) && Object.keys(recordOf(input.payload.teams)!).length > 0 ? 1 : 0,
        boundedString(customProvider?.providerId, 256),
        boundedString(customProvider?.modelId, 256),
        boundedString(input.telemetry.providerName, 128),
        boundedString(input.telemetry.providerType, 64),
        boundedString(input.telemetry.model, 256),
        boundedString(report?.headline, 300) ?? headlineFromMarkdown(input.markdown),
        boundedString(report?.winner, 300) ?? winnerFromMarkdown(input.markdown),
        input.markdown.length,
        markdownBytes,
        numberOf(usage?.promptTokens),
        numberOf(usage?.completionTokens),
        numberOf(usage?.totalTokens),
        numberOf(usage?.cachedTokens),
        numberOf(usage?.reasoningTokens),
        boundedString(input.payload.userGuidance, 600),
        preview || null,
        JSON.stringify(extraJson),
        endedAt.toISOString(),
        endedAt.toISOString(),
        ).run({ retry: 'none' });
      } catch (error) {
        // A transport timeout can happen after D1 committed the INSERT. Reconcile the
        // authority row before surfacing failure so Redis cannot contradict D1.
        try {
          const stored = await readStoredClaim(client, input);
          return {
            kind: 'existing',
            resultRef: stored.resultRef,
            finalized: stored.finalized,
          };
        } catch {
          throw error;
        }
      }
      const created = (numberOf(inserted.meta.changes) ?? 0) > 0;
      if (created) {
        return { kind: 'created', resultRef: input.resultRef, finalized: false };
      }
      const stored = await readStoredClaim(client, input);
      return {
        kind: 'existing',
        resultRef: stored.resultRef,
        finalized: stored.finalized,
      };
    },

    async completeTerminal(input) {
      const client = options.getD1Client();
      if (!client) throw new Error('ARENA_D1_UNAVAILABLE');
      const completedAt = now().toISOString();
      const result = await client.prepare(`
UPDATE battle_report_generations
SET status = ?, ended_at = ?,
  extra_json = json_set(
    extra_json,
    '$.generationTerminalStatus', ?,
    '$.finalizationCompleted', json('true')
  ),
  updated_at = ?
WHERE id = ?
  AND json_extract(extra_json, '$.generationRequestId') = ?
  AND json_extract(extra_json, '$.generationOwnerHash') = ?
  AND json_extract(extra_json, '$.generationPayloadHash') = ?
  AND json_extract(extra_json, '$.generationTerminalStatus') = ?
  AND COALESCE(json_extract(extra_json, '$.finalizationCompleted'), 0) != 1
      `.trim()).bind(
        terminalStatus(input.status),
        completedAt,
        input.status,
        completedAt,
        input.generationId,
        input.generationRequestId,
        await sha256(input.actorKey),
        input.payloadHash,
        input.status,
      ).run({ retry: 'none' });
      if ((numberOf(result.meta.changes) ?? 0) !== 1) {
        const stored = await readStoredClaim(client, input);
        if (!stored.finalized || stored.status !== input.status) {
          throw new Error('ARENA_TERMINAL_COMPLETION_PENDING');
        }
      }
    },

    async failTerminal(input) {
      const client = options.getD1Client();
      if (!client) throw new Error('ARENA_D1_UNAVAILABLE');
      const failedAt = now().toISOString();
      const result = await client.prepare(`
UPDATE battle_report_generations
SET status = 'failed', ended_at = ?,
  extra_json = json_set(
    COALESCE(extra_json, '{}'),
    '$.generationTerminalStatus', 'failed',
    '$.finalizationCompleted', json('true'),
    '$.finalizationFailureCode', ?
  ),
  updated_at = ?
WHERE id = ?
  AND json_extract(extra_json, '$.generationRequestId') = ?
  AND json_extract(extra_json, '$.generationOwnerHash') = ?
  AND json_extract(extra_json, '$.generationPayloadHash') = ?
  AND json_extract(extra_json, '$.generationTerminalStatus') = ?
  AND COALESCE(json_extract(extra_json, '$.finalizationCompleted'), 0) != 1
      `.trim()).bind(
        failedAt,
        input.failureCode.slice(0, 80),
        failedAt,
        input.generationId,
        input.generationRequestId,
        await sha256(input.actorKey),
        input.payloadHash,
        input.status,
      ).run({ retry: 'none' });
      if ((numberOf(result.meta.changes) ?? 0) !== 1) {
        const stored = await readStoredClaim(client, input);
        if (!stored.finalized || stored.status !== 'failed') {
          throw new Error('ARENA_TERMINAL_FAILURE_PENDING');
        }
      }
    },

    async persistCombatants(input) {
      const client = options.getD1Client();
      if (!client || !Array.isArray(input.payload.combatants)) return;
      const createdAt = now().toISOString();
      const combatants = input.payload.combatants.slice(0, MAX_ARENA_TERMINAL_COMBATANTS);
      for (let index = 0; index < combatants.length; index += 1) {
        const combatant = recordOf(combatants[index]);
        const data = recordOf(combatant?.data);
        const serialized = data ? JSON.stringify(data) : '';
        const name = boundedString(data?.codename, 300)
          ?? boundedString(data?.name, 300)
          ?? `未知角色#${index + 1}`;
        await client.prepare(`
INSERT OR IGNORE INTO battle_report_generation_combatants (
  generation_id, sort_index, name, type, template_id, is_native, is_preset,
  team_id, character_guidance, data_card_id, data_card_updated_at,
  size_chars, size_bytes, created_at
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `.trim()).bind(
          input.generationId,
          index,
          name,
          boundedString(combatant?.type, 64),
          boundedString(combatant?.filename, 256) ?? boundedString(data?.templateId, 256),
          booleanInt(combatant?.isNative),
          booleanInt(combatant?.isPreset),
          numberOf(combatant?.teamId),
          boundedString(combatant?.characterGuidance, 100),
          boundedString(combatant?.sourceDataCardId, 128),
          boundedString(combatant?.sourceDataCardUpdatedAt, 128),
          serialized ? serialized.length : null,
          serialized ? new TextEncoder().encode(serialized).byteLength : null,
          createdAt,
        ).run({ retry: 'none' });
      }
    },

    async applyStoryImpacts() {
      // Local-card reconciliation authority is frozen into the existing battle
      // report extra_json during claimTerminal. The cards themselves stay local.
    },

    async settleRatings(input) {
      await options.settleRatings?.(input.generationId);
    },

    async readRanking(input) {
      return options.readRanking?.(input.generationId) ?? null;
    },
  };
  return Object.freeze(ports);
};

export const createNodeArenaGenerationTerminalStore = (
  options: Pick<
    NodeArenaGenerationPersistenceOptions,
    'getD1Client' | 'objectStore' | 'settleRatings'
  >,
): ArenaGenerationTerminalStore => Object.freeze({
  async inspectOwnedFinalization(input: {
    generationId: string;
    actorKey: string;
  }) {
    const client = options.getD1Client();
    if (!client) return { kind: 'not-found' as const };
    const row = await readStoredTerminalRow(client, input.generationId);
    if (!row) return { kind: 'not-found' as const };
    const extra = parseExtra(row.extra_json);
    if (!extra || extra.generationOwnerHash !== await sha256(input.actorKey)) {
      return { kind: 'not-found' as const };
    }
    if (extra.finalizationCompleted !== true) {
      return {
        kind: 'pending' as const,
        payloadHash: stringOf(extra.generationPayloadHash),
      };
    }
    const terminal = await materializeStoredTerminal({
      row,
      generationId: input.generationId,
      actorKey: input.actorKey,
      objectStore: options.objectStore,
      requireFinalized: true,
    });
    return terminal
      ? { kind: 'terminal' as const, terminal }
      : { kind: 'pending' as const, payloadHash: stringOf(extra.generationPayloadHash) };
  },

  async readOwnedTerminal(input: {
    generationId: string;
    actorKey: string;
  }): Promise<ArenaGenerationTerminalRecord | null> {
    const client = options.getD1Client();
    if (!client) return null;
    const row = await readStoredTerminalRow(client, input.generationId);
    return row ? materializeStoredTerminal({
      row,
      generationId: input.generationId,
      actorKey: input.actorKey,
      objectStore: options.objectStore,
      requireFinalized: true,
    }) : null;
  },

  async reconcileExpiredLease(input: {
    generationId: string;
    generationRequestId: string;
    actorKey: string;
    payloadHash: string;
    mode: string | null;
    updatedAt: string;
    code: string;
  }): Promise<ArenaGenerationTerminalRecord> {
    const client = options.getD1Client();
    if (!client) throw new Error('ARENA_D1_UNAVAILABLE');
    const existing = await readStoredTerminalRow(client, input.generationId);
    if (existing) {
      const extra = await validateStoredTerminalIdentity({
        row: existing,
        generationRequestId: input.generationRequestId,
        actorKey: input.actorKey,
        payloadHash: input.payloadHash,
      });
      const status = logicalTerminalStatus(existing, extra);
      if (!status) throw new Error('ARENA_TERMINAL_STATUS_INVALID');
      if (extra.finalizationCompleted !== true) {
        await persistFallbackCombatants({
          client,
          generationId: input.generationId,
          extra,
          createdAt: input.updatedAt,
        });
        if (status === 'completed') await options.settleRatings?.(input.generationId);
        await client.prepare(`
UPDATE battle_report_generations
SET status = ?, ended_at = ?,
  extra_json = json_set(extra_json, '$.finalizationCompleted', json('true')),
  updated_at = ?
WHERE id = ?
  AND json_extract(extra_json, '$.generationRequestId') = ?
  AND json_extract(extra_json, '$.generationOwnerHash') = ?
  AND json_extract(extra_json, '$.generationPayloadHash') = ?
  AND json_extract(extra_json, '$.generationTerminalStatus') = ?
  AND COALESCE(json_extract(extra_json, '$.finalizationCompleted'), 0) != 1
        `.trim()).bind(
          terminalStatus(status),
          input.updatedAt,
          input.updatedAt,
          input.generationId,
          input.generationRequestId,
          await sha256(input.actorKey),
          input.payloadHash,
          status,
        ).run({ retry: 'none' });
      }
      const finalized = await readStoredTerminalRow(client, input.generationId);
      const terminal = finalized ? await materializeStoredTerminal({
        row: finalized,
        generationId: input.generationId,
        actorKey: input.actorKey,
        objectStore: options.objectStore,
        requireFinalized: true,
      }) : null;
      if (!terminal) throw new Error('ARENA_TERMINAL_RECONCILIATION_PENDING');
      return terminal;
    }
    const extra = {
      generationRequestId: input.generationRequestId,
      generationOwnerHash: await sha256(input.actorKey),
      generationPayloadHash: input.payloadHash,
      generationTerminalStatus: 'producer_lost',
      finalizationCompleted: true,
      errorCode: input.code,
      resultRef: null,
    };
    await client.prepare(`
INSERT OR IGNORE INTO battle_report_generations (
  id, started_at, ended_at, duration_ms, status, generation_mode, endpoint,
  mode, user_id, output_chars, output_bytes, extra_json, created_at, updated_at
)
VALUES (?, ?, ?, 0, 'failed', 'stream', 'api/arena/generate-stream',
  ?, ?, 0, 0, ?, ?, ?)
    `.trim()).bind(
      input.generationId,
      input.updatedAt,
      input.updatedAt,
      input.mode ?? 'classic',
      actorUserId(input.actorKey),
      JSON.stringify(extra),
      input.updatedAt,
      input.updatedAt,
    ).run({ retry: 'none' });
    const row = await readStoredTerminalRow(client, input.generationId);
    const storedExtra = parseExtra(row?.extra_json);
    if (
      !row
      || storedExtra?.generationRequestId !== input.generationRequestId
      || storedExtra?.generationOwnerHash !== extra.generationOwnerHash
      || storedExtra?.generationPayloadHash !== input.payloadHash
      || storedExtra?.generationTerminalStatus !== 'producer_lost'
    ) throw new Error('ARENA_PRODUCER_LOST_TERMINAL_CONFLICT');
    return {
      generationId: input.generationId,
      generationRequestId: input.generationRequestId,
      status: 'producer_lost',
      updatedAt: stringOf(row['updated_at']) ?? input.updatedAt,
      resultRef: null,
      markdown: '',
      reasoning: '',
      payloadHash: input.payloadHash,
      contentAvailable: true,
    };
  },
});

export const readNodeArenaGenerationReconciliation = async (input: {
  client: NodeDataD1Client;
  generationId: string;
}): Promise<Record<string, unknown> | null> => {
  const stored = await input.client.prepare(`
SELECT status, extra_json
FROM battle_report_generations
WHERE id = ?
LIMIT 1
  `.trim()).bind(input.generationId).all({ retry: 'safe-read' });
  const row = stored.results[0];
  if (row?.status !== 'completed') return null;
  const extra = parseExtra(row['extra_json']);
  if (extra?.finalizationCompleted !== true) return null;
  return recordOf(extra?.localCardReconciliation);
};
