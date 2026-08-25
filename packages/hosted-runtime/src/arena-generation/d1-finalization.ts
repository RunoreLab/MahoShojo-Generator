import type {
  ArenaGenerationTerminalRecord,
  ArenaGenerationTerminalStore,
} from '@mahoshojo/hosted-api/arena-generation/service';
import type {
  ArenaGenerationFinalizationPorts,
  ArenaTerminalClaimInput,
} from './finalization';
import type { NodeDataD1Client } from '../node-runtime/data-ports';

const OUTPUT_KIND = 'battle_report_generation_output';
const OUTPUT_PREVIEW_CHARS = 120_000;

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

const dateParts = (value: Date): string => [
  value.getUTCFullYear(),
  String(value.getUTCMonth() + 1).padStart(2, '0'),
  String(value.getUTCDate()).padStart(2, '0'),
].join('/');

const outputKey = (generationId: string, now: Date): string => (
  `v1/battle-report-generations/${dateParts(now)}/${generationId}/output.md`
);

const numberOf = (value: unknown): number | null => (
  typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : null
);

const stringOf = (value: unknown): string | null => (
  typeof value === 'string' && value.trim() ? value.trim() : null
);

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
  value === 'cancelled' ? 'aborted' : value
);

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
  const combatantsFallback = Array.isArray(input.payload.combatants)
    ? input.payload.combatants.map((value, sortIndex) => {
      const combatant = recordOf(value);
      const data = recordOf(combatant?.data);
      return {
        sortIndex,
        name: stringOf(data?.codename) ?? stringOf(data?.name) ?? `未知角色#${sortIndex + 1}`,
        type: stringOf(combatant?.type),
        templateId: stringOf(combatant?.filename) ?? stringOf(data?.templateId),
        isNative: combatant?.isNative === true,
        isPreset: combatant?.isPreset === true,
        teamId: numberOf(combatant?.teamId),
        characterGuidance: stringOf(combatant?.characterGuidance)?.slice(0, 100) ?? null,
        dataCardId: stringOf(combatant?.sourceDataCardId),
        dataCardUpdatedAt: stringOf(combatant?.sourceDataCardUpdatedAt),
      };
    })
    : [];
  return {
    generationRequestId: input.generationRequestId,
    generationOwnerHash: await sha256(input.actorKey),
    resultRef: input.resultRef,
    errorCode: input.errorCode,
    arenaStrictPolicy: seasonAuthorityAvailable ? '1+3:v1' : null,
    arenaFreeRankingEnabled: input.payload.arenaFreeRankingEnabled === true,
    seasonId: seasonAuthorityAvailable ? stringOf(season?.seasonId) : null,
    seasonMode: seasonAuthorityAvailable && stringOf(season?.mode) !== 'classic'
      ? stringOf(season?.mode)
      : null,
    seasonStoryGuidance: seasonAuthorityAvailable ? stringOf(season?.storyGuidance) : null,
    seasonScenarioPreset: seasonAuthorityAvailable
      ? stringOf(season?.scenarioPresetFilename)
      : null,
    seasonQuestionnaireLoreAllowed: seasonAuthorityAvailable
      && season?.questionnaireLoreAllowed === true
      ? true
      : null,
    seasonQuestionnaireLorePresetIds: seasonAuthorityAvailable
      && Array.isArray(season?.questionnaireLorePresetIds)
      ? season.questionnaireLorePresetIds
      : [],
    readNarrativeHistory: input.payload.readNarrativeHistory === true,
    narrativeHistoryReadLimit: numberOf(input.payload.narrativeHistoryReadLimit),
    narrativeHistoryReadCount: numberOf(input.payload.narrativeHistoryReadCount) ?? 0,
    questionnaireLoreEnabled: input.payload.questionnaireLoreEnabled === true,
    questionnaireLoreIds: Array.isArray(input.payload.questionnaireLoreIds)
      ? input.payload.questionnaireLoreIds
      : [],
    scenarioFileName: safeScenarioFileName,
    auxScenarioCount: Array.isArray(input.payload.auxScenarios)
      ? input.payload.auxScenarios.length
      : 0,
    materialCount: Array.isArray(input.payload.materials) ? input.payload.materials.length : 0,
    materialSourceTypes: Array.isArray(input.payload.materialSourceTypes)
      ? input.payload.materialSourceTypes
      : [],
    resolvedModelOverride: stringOf(input.telemetry.model),
    combatantsFallback,
  };
};

const readStoredClaim = async (
  client: NodeDataD1Client,
  input: ArenaTerminalClaimInput,
): Promise<{ resultRef: string | null }> => {
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
  ) throw new Error('ARENA_TERMINAL_CLAIM_CONFLICT');
  return { resultRef: stringOf(extra.resultRef) };
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
      const key = outputKey(input.generationId, timestamp);
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
      let insert: Awaited<ReturnType<ReturnType<NodeDataD1Client['prepare']>['run']>>;
      try {
        insert = await client.prepare(`
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
  ?, ?, ?, ?, ?, 'stream', 'api/arena/generate-stream',
  ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
  ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
)
      `.trim()).bind(
        input.generationId,
        startedAtIso,
        endedAt.toISOString(),
        durationMs,
        terminalStatus(input.status),
        stringOf(serverContext?.ipAnonymized),
        stringOf(input.payload.mode) ?? 'classic',
        actorUserId(input.actorKey),
        stringOf(input.payload.scenarioTitle) ?? stringOf(recordOf(input.payload.scenario)?.title),
        stringOf(input.payload.scenarioSourceDataCardId),
        stringOf(input.payload.scenarioSourceDataCardUpdatedAt),
        stringOf(input.payload.language),
        stringOf(input.payload.customStoryLength) ?? stringOf(input.payload.storyLength),
        stringOf(pvp?.roomId),
        stringOf(pvp?.matchId),
        stringOf(pvp?.roundId),
        booleanInt(input.payload.readArenaHistory),
        numberOf(input.payload.arenaHistoryReadLimit),
        booleanInt(input.payload.writeArenaHistory),
        booleanInt(input.payload.readCurrentState),
        booleanInt(input.payload.writeCurrentState),
        Array.isArray(input.payload.combatants) ? input.payload.combatants.length : null,
        input.payload.scenario ? 1 : 0,
        stringOf(input.payload.userGuidance) ? 1 : 0,
        Array.isArray(input.payload.adjudicationEvents) && input.payload.adjudicationEvents.length > 0 ? 1 : 0,
        recordOf(input.payload.teams) && Object.keys(recordOf(input.payload.teams)!).length > 0 ? 1 : 0,
        stringOf(customProvider?.providerId),
        stringOf(customProvider?.modelId),
        stringOf(input.telemetry.providerName),
        stringOf(input.telemetry.providerType),
        stringOf(input.telemetry.model),
        stringOf(report?.headline) ?? headlineFromMarkdown(input.markdown),
        stringOf(report?.winner) ?? winnerFromMarkdown(input.markdown),
        input.markdown.length,
        markdownBytes,
        numberOf(usage?.promptTokens),
        numberOf(usage?.completionTokens),
        numberOf(usage?.totalTokens),
        numberOf(usage?.cachedTokens),
        numberOf(usage?.reasoningTokens),
        stringOf(input.payload.userGuidance)?.slice(0, 600) ?? null,
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
          return { kind: 'existing', resultRef: stored.resultRef };
        } catch {
          throw error;
        }
      }
      const created = (numberOf(insert.meta.changes) ?? 0) > 0;
      if (created) {
        return { kind: 'created', resultRef: input.resultRef };
      }
      const stored = await readStoredClaim(client, input);
      return {
        kind: 'existing',
        resultRef: stored.resultRef,
      };
    },

    async persistCombatants(input) {
      const client = options.getD1Client();
      if (!client || !Array.isArray(input.payload.combatants)) return;
      const createdAt = now().toISOString();
      for (let index = 0; index < input.payload.combatants.length; index += 1) {
        const combatant = recordOf(input.payload.combatants[index]);
        const data = recordOf(combatant?.data);
        const serialized = data ? JSON.stringify(data) : '';
        const name = stringOf(data?.codename) ?? stringOf(data?.name) ?? `未知角色#${index + 1}`;
        await client.prepare(`
INSERT INTO battle_report_generation_combatants (
  generation_id, sort_index, name, type, template_id, is_native, is_preset,
  team_id, character_guidance, data_card_id, data_card_updated_at,
  size_chars, size_bytes, created_at
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `.trim()).bind(
          input.generationId,
          index,
          name,
          stringOf(combatant?.type),
          stringOf(combatant?.filename) ?? stringOf(data?.templateId),
          booleanInt(combatant?.isNative),
          booleanInt(combatant?.isPreset),
          numberOf(combatant?.teamId),
          stringOf(combatant?.characterGuidance)?.slice(0, 100) ?? null,
          stringOf(combatant?.sourceDataCardId),
          stringOf(combatant?.sourceDataCardUpdatedAt),
          serialized ? serialized.length : null,
          serialized ? new TextEncoder().encode(serialized).byteLength : null,
          createdAt,
        ).run({ retry: 'none' });
      }
    },

    async applyStoryImpacts() {
      // Arena v1 的角色历史/当前状态属于客户端卡片数据；由兼容 update endpoint
      // 返回签名后的角色对象。服务端只以 terminal claim gate 防止客户端重复调用。
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
  options: Pick<NodeArenaGenerationPersistenceOptions, 'getD1Client' | 'objectStore'>,
): ArenaGenerationTerminalStore => Object.freeze({
  async readOwnedTerminal(input: {
    generationId: string;
    actorKey: string;
  }): Promise<ArenaGenerationTerminalRecord | null> {
    const client = options.getD1Client();
    if (!client) return null;
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
    `.trim()).bind(input.generationId).all({ retry: 'safe-read' });
    const row = result.results[0];
    const extra = parseExtra(row?.extra_json);
    if (!row || extra?.generationOwnerHash !== await sha256(input.actorKey)) return null;
    const status = row.status === 'completed'
      || row.status === 'failed'
      || row.status === 'producer_lost'
      || row.status === 'cancelled'
      ? row.status
      : row.status === 'aborted'
        ? 'cancelled'
        : null;
    const requestId = stringOf(extra?.generationRequestId);
    if (!status || !requestId) return null;
    const r2Key = stringOf(row['r2_key']);
    let markdown = stringOf(row['output_preview']) ?? '';
    if (r2Key && options.objectStore) {
      markdown = await options.objectStore.getText(r2Key).catch(() => markdown);
    }
    return {
      generationId: input.generationId,
      generationRequestId: requestId,
      status,
      updatedAt: stringOf(row['updated_at']) ?? new Date(0).toISOString(),
      resultRef: stringOf(extra?.resultRef),
      markdown,
      reasoning: '',
    };
  },
});
