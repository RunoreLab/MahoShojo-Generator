export const ARENA_STREAM_INPUT_LIMITS = {
  requestBytes: 512 * 1024,
  userGuidanceChars: 200,
  characterGuidanceChars: 100,
  internalGuidanceChars: 4_000,
  narrativeHistoryTitleChars: 200,
  narrativeHistoryContentChars: 50_000,
  narrativeHistoryTotalChars: 200_000,
  serializedFieldChars: 256_000,
} as const;

type ArenaStreamInput = Record<string, any>;

export class ArenaStreamInputLimitError extends Error {
  readonly status = 400;

  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ArenaStreamInputLimitError';
  }
}

const assertStringLimit = (
  value: unknown,
  maxChars: number,
  code: string,
  label: string,
): void => {
  if (typeof value === 'string' && value.length > maxChars) {
    throw new ArenaStreamInputLimitError(code, `${label}最多 ${maxChars} 个字符`);
  }
};

const serializeField = (value: unknown, label: string): string => {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new ArenaStreamInputLimitError('invalid_json_value', `${label}无法序列化`);
  }
  if (serialized.length > ARENA_STREAM_INPUT_LIMITS.serializedFieldChars) {
    throw new ArenaStreamInputLimitError('serialized_field_exceeded', `${label}内容过大`);
  }
  return serialized;
};

export const parseArenaStreamRequestBody = async (request: Request): Promise<ArenaStreamInput> => {
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > ARENA_STREAM_INPUT_LIMITS.requestBytes) {
    throw new ArenaStreamInputLimitError('request_bytes_exceeded', '请求内容超过 512 KiB');
  }

  if (!request.body) {
    throw new ArenaStreamInputLimitError('invalid_json', '请求 JSON 无效');
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let requestBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    requestBytes += value.byteLength;
    if (requestBytes > ARENA_STREAM_INPUT_LIMITS.requestBytes) {
      await reader.cancel('request bytes exceeded').catch(() => {});
      throw new ArenaStreamInputLimitError('request_bytes_exceeded', '请求内容超过 512 KiB');
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(requestBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const rawBody = new TextDecoder().decode(bytes);

  try {
    const parsed = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('body must be an object');
    }
    return parsed as ArenaStreamInput;
  } catch {
    throw new ArenaStreamInputLimitError('invalid_json', '请求 JSON 无效');
  }
};

export const serializeAndValidateArenaStreamInput = (input: ArenaStreamInput) => {
  assertStringLimit(
    input.userGuidance,
    ARENA_STREAM_INPUT_LIMITS.userGuidanceChars,
    'user_guidance_chars_exceeded',
    '故事引导',
  );
  assertStringLimit(
    input.internalGuidance,
    ARENA_STREAM_INPUT_LIMITS.internalGuidanceChars,
    'internal_guidance_chars_exceeded',
    '内部引导',
  );

  const combatants = Array.isArray(input.combatants) ? input.combatants : [];
  for (const combatant of combatants) {
    assertStringLimit(
      combatant?.characterGuidance,
      ARENA_STREAM_INPUT_LIMITS.characterGuidanceChars,
      'character_guidance_chars_exceeded',
      '角色行动引导',
    );
  }

  let narrativeHistoryTotalChars = 0;
  if (Array.isArray(input.narrativeHistory)) {
    for (const entry of input.narrativeHistory) {
      assertStringLimit(
        entry?.title,
        ARENA_STREAM_INPUT_LIMITS.narrativeHistoryTitleChars,
        'narrative_history_title_chars_exceeded',
        '叙事历史标题',
      );
      assertStringLimit(
        entry?.content,
        ARENA_STREAM_INPUT_LIMITS.narrativeHistoryContentChars,
        'narrative_history_content_chars_exceeded',
        '单条叙事历史正文',
      );
      narrativeHistoryTotalChars += typeof entry?.content === 'string' ? entry.content.length : 0;
    }
  }
  if (narrativeHistoryTotalChars > ARENA_STREAM_INPUT_LIMITS.narrativeHistoryTotalChars) {
    throw new ArenaStreamInputLimitError('narrative_history_total_chars_exceeded', '叙事历史正文合计最多 200000 个字符');
  }

  const serialized = {
    combatants: combatants.map((combatant) => serializeField(combatant?.data, '角色')),
    scenario: input.scenario ? serializeField(input.scenario, '情景') : null,
    auxScenarios: Array.isArray(input.auxScenarios)
      ? input.auxScenarios
        .filter((scenario: unknown) => scenario && typeof scenario === 'object')
        .map((scenario: unknown) => serializeField(scenario, '辅助情景'))
      : [],
    materials: Array.isArray(input.materials)
      ? input.materials.map((material: any) => serializeField(material?.content ?? material, '素材'))
      : [],
    adjudicationEvents: Array.isArray(input.adjudicationEvents)
      ? serializeField(input.adjudicationEvents, '判定事件')
      : null,
  };

  const inputJson = serializeField({
    combatants: input.combatants,
    userGuidance: typeof input.userGuidance === 'string' ? input.userGuidance.trim() || null : null,
    scenario: input.scenario,
    materials: input.materials,
    teams: input.teams,
  }, '生成输入');

  return {
    serialized,
    inputJson,
    inputChars: inputJson.length,
    inputBytes: new TextEncoder().encode(inputJson).byteLength,
  };
};
