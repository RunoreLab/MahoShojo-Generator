import { jsonrepair } from 'jsonrepair';
import { z } from 'zod/v3';

type JsonCandidate = {
  jsonText: string;
  startIndex: number;
  endIndex: number;
};

const escapeRegExp = (input: string) => input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toSnakeCase = (input: string) =>
  input
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/-/g, '_')
    .toLowerCase();

const stripCodeFences = (input: string) =>
  input
    .replace(/^\s*```[a-zA-Z]*\s*\n?/, '')
    .replace(/\n?```[\s;]*$/, '')
    .trim();

const normalizeJsonishText = (input: string): string => {
  const normalized = input
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\u2060]/g, '');

  let out = '';
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]!;
    if (quote) {
      out += ch;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
      continue;
    }

    if (ch === 'T' || ch === 'F' || ch === 'N') {
      const rest = normalized.slice(i);
      const match = rest.match(/^(True|False|None)\b/);
      if (match) {
        out += match[1] === 'True' ? 'true' : match[1] === 'False' ? 'false' : 'null';
        i += match[1].length - 1;
        continue;
      }
    }

    out += ch;
  }

  return out;
};

const findJsonishSpan = (text: string, searchFrom = 0): { start: number; end: number } | null => {
  const firstObj = text.indexOf('{', searchFrom);
  const firstArr = text.indexOf('[', searchFrom);
  const start =
    firstObj === -1 ? firstArr : firstArr === -1 ? firstObj : Math.min(firstObj, firstArr);
  if (start === -1) return null;

  const stack: string[] = [text[start] === '{' ? '}' : ']'];
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }

    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') {
      if (stack.length > 0 && ch === stack[stack.length - 1]) {
        stack.pop();
        if (stack.length === 0) return { start, end: i };
      }
    }
  }

  return null;
};

type ZodTypeName = z.ZodFirstPartyTypeKind | string;

const unwrapToCoreSchema = (schema: z.ZodTypeAny): z.ZodTypeAny => {
  let current: z.ZodTypeAny = schema;
  for (let i = 0; i < 10; i++) {
    const def: any = (current as any)?._def;
    const typeName: ZodTypeName | undefined = def?.typeName;

    if (typeName === z.ZodFirstPartyTypeKind.ZodOptional) {
      current = def.innerType;
      continue;
    }
    if (typeName === z.ZodFirstPartyTypeKind.ZodNullable) {
      current = def.innerType;
      continue;
    }
    if (typeName === z.ZodFirstPartyTypeKind.ZodDefault) {
      current = def.innerType;
      continue;
    }
    if (typeName === z.ZodFirstPartyTypeKind.ZodEffects) {
      current = def.schema;
      continue;
    }

    break;
  }

  return current;
};

const getTopLevelKeysFromSchema = (schema: z.ZodTypeAny): string[] => {
  const core = unwrapToCoreSchema(schema);
  const def: any = (core as any)?._def;
  const typeName: ZodTypeName | undefined = def?.typeName;
  if (typeName !== z.ZodFirstPartyTypeKind.ZodObject) return [];
  const shape = typeof def.shape === 'function' ? def.shape() : {};
  return Object.keys(shape);
};

const buildMissingRootObjectCandidates = (raw: string, schema: z.ZodTypeAny): JsonCandidate[] => {
  const topLevelKeys = getTopLevelKeysFromSchema(schema);
  if (topLevelKeys.length === 0) return [];

  const keyVariants = Array.from(new Set([...topLevelKeys, ...topLevelKeys.map(toSnakeCase)]));
  const text = normalizeJsonishText(stripCodeFences(raw));

  let bestStart: number | null = null;
  for (const key of keyVariants) {
    const re = new RegExp(`(^|[\\s,{\\[])([\"']?)${escapeRegExp(key)}\\2\\s*:`, 'm');
    const match = re.exec(text);
    if (!match) continue;
    const start = match.index + match[1].length;
    if (bestStart === null || start < bestStart) bestStart = start;
  }

  if (bestStart === null) return [];

  let body = text.slice(bestStart).trim();
  // 常见：JSON 部分后面又跟了 ``` 或解释文本；优先截断围栏，减轻修复压力
  const fenceIndex = body.indexOf('```');
  if (fenceIndex !== -1) body = body.slice(0, fenceIndex).trim();
  if (!body) return [];

  return [
    {
      // LLM 有时会“漏掉最外层大括号”，只输出键值对列表：
      //   "a": 1, "b": 2
      // 这里包一层 { ... } 交给 jsonrepair + schema 校验兜底。
      jsonText: `{${body}}`,
      startIndex: bestStart,
      endIndex: bestStart + body.length - 1,
    },
  ];
};

const extractJsonCandidates = (raw: string): JsonCandidate[] => {
  const text = normalizeJsonishText(raw);
  const candidates: JsonCandidate[] = [];
  let cursor = 0;

  for (let i = 0; i < 10; i++) {
    const span = findJsonishSpan(text, cursor);
    if (!span) break;
    candidates.push({
      jsonText: text.slice(span.start, span.end + 1).trim(),
      startIndex: span.start,
      endIndex: span.end,
    });
    cursor = span.end + 1;
  }

  // 兜底：尽量取首尾括号之间的大片段（有时配对扫描会被前置噪声干扰）
  if (candidates.length === 0) {
    const firstObj = text.indexOf('{');
    const firstArr = text.indexOf('[');
    const start =
      firstObj === -1 ? firstArr : firstArr === -1 ? firstObj : Math.min(firstObj, firstArr);

    const lastObj = text.lastIndexOf('}');
    const lastArr = text.lastIndexOf(']');
    const end = Math.max(lastObj, lastArr);

    if (start !== -1 && end !== -1 && end > start) {
      candidates.push({
        jsonText: text.slice(start, end + 1).trim(),
        startIndex: start,
        endIndex: end,
      });
    } else if (start !== -1) {
      candidates.push({
        jsonText: text.slice(start).trim(),
        startIndex: start,
        endIndex: text.length - 1,
      });
    }
  }

  return candidates;
};

const tryParseJson = (input: string): unknown => {
  const trimmed = stripCodeFences(input);
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const repaired = jsonrepair(trimmed);
    return JSON.parse(repaired) as unknown;
  }
};

const formatZodIssues = (issues: z.ZodIssue[]): string => {
  return issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ');
};

type UnwrapAttempt = { attempted: boolean; succeeded: boolean; key?: string };

const tryUnwrapAndValidate = <T>(
  value: unknown,
  schema: z.ZodSchema<T>,
  unwrapCandidates: readonly string[],
  textFieldCandidates: readonly string[],
): { ok: true; data: T; unwrap: UnwrapAttempt } | { ok: false; unwrap: UnwrapAttempt } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, unwrap: { attempted: false, succeeded: false } };
  }

  const record = value as Record<string, unknown>;

  for (const key of unwrapCandidates) {
    const inner = record[key];
    if (!inner) continue;
    const parsed = schema.safeParse(inner);
    if (parsed.success) return { ok: true, data: parsed.data, unwrap: { attempted: true, succeeded: true, key } };
  }

  for (const key of textFieldCandidates) {
    const inner = record[key];
    if (typeof inner !== 'string' || !inner.trim()) continue;
    try {
      const parsedInner = tryParseJson(inner);
      const parsed = schema.safeParse(parsedInner);
      if (parsed.success) {
        return { ok: true, data: parsed.data, unwrap: { attempted: true, succeeded: true, key } };
      }
    } catch {
      // ignore
    }
  }

  return { ok: false, unwrap: { attempted: true, succeeded: false } };
};

export type ParseStructuredJsonOptions = {
  taskName?: string;
  unwrapCandidates?: readonly string[];
  textFieldCandidates?: readonly string[];
};

export type ParseStructuredJsonTelemetry = {
  usedCandidateIndex: number;
  candidateStartIndex: number;
  candidateEndIndex: number;
  usedJsonRepair: boolean;
  unwrapAttempt: UnwrapAttempt;
};

export function parseStructuredJsonWithSchema<T>(
  rawText: string,
  schema: z.ZodSchema<T>,
  options: ParseStructuredJsonOptions = {},
): { data: T; telemetry: ParseStructuredJsonTelemetry } {
  const taskName = options.taskName ?? '结构化输出解析';
  const unwrapCandidates = options.unwrapCandidates ?? ['value', 'data', 'payload', 'result'];
  const textFieldCandidates = options.textFieldCandidates ?? ['json', 'text', 'raw', 'content', 'body'];

  const candidates = [
    ...extractJsonCandidates(rawText),
    ...buildMissingRootObjectCandidates(rawText, schema),
  ];
  if (candidates.length === 0) {
    throw new Error(`${taskName}失败：未找到可解析的 JSON 片段`);
  }

  let lastError: unknown = null;
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]!;
    const jsonText = candidate.jsonText;
    if (!jsonText) continue;

    let parsedJson: unknown;
    let usedJsonRepair = false;
    try {
      parsedJson = JSON.parse(stripCodeFences(jsonText)) as unknown;
    } catch {
      try {
        usedJsonRepair = true;
        parsedJson = tryParseJson(jsonText);
      } catch (e) {
        lastError = e;
        continue;
      }
    }

    const validated = schema.safeParse(parsedJson);
    if (validated.success) {
      return {
        data: validated.data,
        telemetry: {
          usedCandidateIndex: i,
          candidateStartIndex: candidate.startIndex,
          candidateEndIndex: candidate.endIndex,
          usedJsonRepair,
          unwrapAttempt: { attempted: false, succeeded: false },
        },
      };
    }

    const unwrapped = tryUnwrapAndValidate(parsedJson, schema, unwrapCandidates, textFieldCandidates);
    if (unwrapped.ok) {
      return {
        data: unwrapped.data,
        telemetry: {
          usedCandidateIndex: i,
          candidateStartIndex: candidate.startIndex,
          candidateEndIndex: candidate.endIndex,
          usedJsonRepair,
          unwrapAttempt: unwrapped.unwrap,
        },
      };
    }

    lastError = new Error(`Schema validation failed: ${formatZodIssues(validated.error.issues)}`);
  }

  const suffix = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`${taskName}失败：JSON 解析/修复后仍无法通过 Schema 校验。${suffix ? `原因：${suffix}` : ''}`);
}

type Unwrapped = {
  schema: z.ZodTypeAny;
  optional: boolean;
  nullable: boolean;
};

const unwrapSchema = (schema: z.ZodTypeAny): Unwrapped => {
  let current: z.ZodTypeAny = schema;
  let optional = false;
  let nullable = false;

  for (let i = 0; i < 10; i++) {
    const def: any = (current as any)?._def;
    const typeName: ZodTypeName | undefined = def?.typeName;

    if (typeName === z.ZodFirstPartyTypeKind.ZodOptional) {
      optional = true;
      current = def.innerType;
      continue;
    }
    if (typeName === z.ZodFirstPartyTypeKind.ZodNullable) {
      nullable = true;
      current = def.innerType;
      continue;
    }
    if (typeName === z.ZodFirstPartyTypeKind.ZodDefault) {
      optional = true;
      current = def.innerType;
      continue;
    }
    if (typeName === z.ZodFirstPartyTypeKind.ZodEffects) {
      current = def.schema;
      continue;
    }

    break;
  }

  return { schema: current, optional, nullable };
};

const describeZod = (
  schema: z.ZodTypeAny,
  depth: number,
  maxDepth: number,
  maxProperties: number,
): { type: string; optional: boolean } => {
  const unwrapped = unwrapSchema(schema);
  const def: any = (unwrapped.schema as any)?._def;
  const typeName: ZodTypeName | undefined = def?.typeName;

  const withNullable = (t: string) => (unwrapped.nullable ? `${t} | null` : t);

  if (depth >= maxDepth) return { type: withNullable('<...>'), optional: unwrapped.optional };

  if (typeName === z.ZodFirstPartyTypeKind.ZodString) return { type: withNullable('string'), optional: unwrapped.optional };
  if (typeName === z.ZodFirstPartyTypeKind.ZodNumber) return { type: withNullable('number'), optional: unwrapped.optional };
  if (typeName === z.ZodFirstPartyTypeKind.ZodBoolean) return { type: withNullable('boolean'), optional: unwrapped.optional };

  if (typeName === z.ZodFirstPartyTypeKind.ZodEnum) {
    const values = Array.isArray(def?.values) ? def.values : [];
    const rendered = values.map((v: string) => JSON.stringify(v)).join(' | ') || 'string';
    return { type: withNullable(rendered), optional: unwrapped.optional };
  }

  if (typeName === z.ZodFirstPartyTypeKind.ZodNativeEnum) {
    const values = def?.values && typeof def.values === 'object' ? Object.values(def.values) : [];
    const filtered = values.filter((v: any) => typeof v === 'string' || typeof v === 'number');
    const rendered = filtered.map((v: any) => JSON.stringify(v)).join(' | ') || 'string';
    return { type: withNullable(rendered), optional: unwrapped.optional };
  }

  if (typeName === z.ZodFirstPartyTypeKind.ZodLiteral) {
    return { type: withNullable(JSON.stringify(def?.value)), optional: unwrapped.optional };
  }

  if (typeName === z.ZodFirstPartyTypeKind.ZodArray) {
    const item = describeZod(def.type, depth + 1, maxDepth, maxProperties);
    return { type: withNullable(`${item.type}[]`), optional: unwrapped.optional };
  }

  if (typeName === z.ZodFirstPartyTypeKind.ZodUnion) {
    const options = Array.isArray(def?.options) ? def.options : [];
    const rendered = options
      .slice(0, 8)
      .map((opt: z.ZodTypeAny) => describeZod(opt, depth + 1, maxDepth, maxProperties).type)
      .join(' | ') || '<unknown>';
    return { type: withNullable(rendered), optional: unwrapped.optional };
  }

  if (typeName === z.ZodFirstPartyTypeKind.ZodObject) {
    const shape = typeof def.shape === 'function' ? def.shape() : {};
    const keys = Object.keys(shape);
    const limitedKeys = keys.slice(0, maxProperties);
    const indent = (n: number) => '  '.repeat(n);
    const lines = limitedKeys.map((key) => {
      const sub = describeZod(shape[key], depth + 1, maxDepth, maxProperties);
      return `${indent(depth + 1)}${key}${sub.optional ? '?:' : ':'} ${sub.type}`;
    });
    if (keys.length > limitedKeys.length) {
      lines.push(`${indent(depth + 1)}...: <省略>`);
    }
    const body = lines.length > 0 ? `\n${lines.join('\n')}\n${indent(depth)}}` : '}';
    return { type: withNullable(`{${body}`), optional: unwrapped.optional };
  }

  if (typeName === z.ZodFirstPartyTypeKind.ZodRecord) {
    const valueType = describeZod(def.valueType, depth + 1, maxDepth, maxProperties);
    return { type: withNullable(`Record<string, ${valueType.type}>`), optional: unwrapped.optional };
  }

  if (typeName === z.ZodFirstPartyTypeKind.ZodAny) return { type: withNullable('any'), optional: unwrapped.optional };
  if (typeName === z.ZodFirstPartyTypeKind.ZodUnknown) return { type: withNullable('unknown'), optional: unwrapped.optional };

  return { type: withNullable('unknown'), optional: unwrapped.optional };
};

export function buildStructuredJsonInstructionFromZodSchema(
  schema: z.ZodTypeAny,
  options: { maxDepth?: number; maxProperties?: number } = {},
): string {
  const maxDepth = typeof options.maxDepth === 'number' ? options.maxDepth : 6;
  const maxProperties = typeof options.maxProperties === 'number' ? options.maxProperties : 80;
  const described = describeZod(schema, 0, maxDepth, maxProperties);

  return (
    `【结构化输出要求】\n` +
    `- 你必须只输出一个严格的 JSON（不要 Markdown，不要代码块，不要解释文字）。\n` +
    `- JSON 的键名必须完全匹配；不要输出多余字段。\n` +
    `- 标记为 ?: 的字段为可选字段（可以省略）；其余字段必须输出。\n` +
    `- 输出结构示意（TypeScript 风格，仅供你理解结构，最终必须输出 JSON）：\n` +
    `${described.type}\n`
  );
}
