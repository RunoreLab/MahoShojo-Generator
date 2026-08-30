type ArenaStreamInput = Record<string, any>;

export class ArenaStreamInputError extends Error {
  readonly status = 400;

  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ArenaStreamInputError';
  }
}

export const parseArenaStreamRequestBody = async (request: Request): Promise<ArenaStreamInput> => {
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ArenaStreamInputError('invalid_json', '请求 JSON 必须为对象');
    }
    return parsed as ArenaStreamInput;
  } catch (error) {
    if (error instanceof ArenaStreamInputError) throw error;
    throw new ArenaStreamInputError('invalid_json', '请求 JSON 无效');
  }
};

const createJsonSerializer = () => {
  const objectCache = new WeakMap<object, string>();

  return (value: unknown, label: string): string => {
    if (value !== null && typeof value === 'object') {
      const cached = objectCache.get(value);
      if (cached !== undefined) return cached;
    }

    let serialized: string;
    try {
      serialized = JSON.stringify(value) ?? 'null';
    } catch {
      throw new ArenaStreamInputError('invalid_json_value', `${label}无法序列化`);
    }

    if (value !== null && typeof value === 'object') {
      objectCache.set(value, serialized);
    }
    return serialized;
  };
};

/**
 * 为 generate-stream 准备可复用的 JSON 序列化结果和输入统计。
 *
 * 此处不设置应用层输入长度或字节上限，也不截断用户内容。实际可接受大小仍由
 * Cloudflare、Next.js 运行时及上游 AI 提供商的客观能力决定。
 */
export const prepareArenaStreamInput = (input: ArenaStreamInput) => {
  const serialize = createJsonSerializer();
  const inputJson = serialize({
    combatants: input.combatants,
    userGuidance: typeof input.userGuidance === 'string' ? input.userGuidance.trim() || null : null,
    scenario: input.scenario,
    materials: input.materials,
    teams: input.teams,
  }, '生成输入');

  return {
    serialize,
    inputJson,
    inputChars: inputJson.length,
    inputBytes: new TextEncoder().encode(inputJson).byteLength,
  };
};
