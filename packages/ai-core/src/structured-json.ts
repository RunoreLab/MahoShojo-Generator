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

const toCamelCase = (input: string) => {
  const normalized = input.replace(/-/g, '_');
  if (!normalized.includes('_')) return input;
  return normalized
    .split('_')
    .filter(Boolean)
    .map((part, index) => (index === 0 ? part.toLowerCase() : `${part[0] ? part[0].toUpperCase() : ''}${part.slice(1)}`))
    .join('');
};

const canonicalizeKey = (input: string) => input.replace(/[_-]/g, '').toLowerCase();

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
  const seen = new Set<string>();

  const pushCandidate = (startIndex: number, endIndex: number) => {
    if (startIndex < 0 || endIndex < startIndex) return;
    const jsonText = text.slice(startIndex, endIndex + 1).trim();
    if (!jsonText) return;
    const key = `${startIndex}:${endIndex}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ jsonText, startIndex, endIndex });
  };

  let cursor = 0;

  for (let i = 0; i < 10; i++) {
    const span = findJsonishSpan(text, cursor);
    if (!span) break;
    pushCandidate(span.start, span.end);
    cursor = span.end + 1;
  }

  const firstObj = text.indexOf('{');
  const firstArr = text.indexOf('[');
  const start =
    firstObj === -1 ? firstArr : firstArr === -1 ? firstObj : Math.min(firstObj, firstArr);

  // 兜底 1：尽量取首尾括号之间的大片段（有时配对扫描会被前置噪声干扰）
  const lastObj = text.lastIndexOf('}');
  const lastArr = text.lastIndexOf(']');
  const end = Math.max(lastObj, lastArr);
  if (start !== -1 && end !== -1 && end > start) {
    pushCandidate(start, end);
  }

  // 兜底 2：始终补一个“从首括号到文本末尾”的候选，覆盖：
  // - 根对象尾部被截断，但前面已有部分子对象闭合（lastObj 可用但不代表根对象完整）
  // - Markdown 围栏未闭合、尾部中断等场景
  if (start !== -1) {
    const tailEnd = text.length - 1;
    if (tailEnd >= start && (end === -1 || tailEnd > end)) {
      pushCandidate(start, tailEnd);
    }
  }

  return candidates;
};

export type StructuredJsonLimits = {
  maxInputChars: number;
  maxNestingDepth: number;
  maxNodes: number;
};

export const DEFAULT_STRUCTURED_JSON_LIMITS: Readonly<StructuredJsonLimits> = Object.freeze({
  // 与模型输出的实际用途保持足够余量，同时在进入 repair/schema 前提供硬上限。
  maxInputChars: 250_000,
  maxNestingDepth: 64,
  maxNodes: 10_000,
});

export type StructuredJsonParseErrorCode =
  | 'input-too-large'
  | 'unsafe-key'
  | 'limit-exceeded'
  | 'invalid-output';

/**
 * 结构化输出边界错误。
 *
 * 该错误只暴露稳定的 code，不携带原始模型输出、JSON repair 错误或 Zod
 * issue 详情，避免把不可信输出写进日志/遥测或上层错误响应。
 */
export class StructuredJsonParseError extends Error {
  readonly code: StructuredJsonParseErrorCode;

  constructor(code: StructuredJsonParseErrorCode, message: string) {
    super(message);
    this.name = 'StructuredJsonParseError';
    this.code = code;
  }
}

const resolveStructuredJsonLimits = (
  limits?: Partial<StructuredJsonLimits>,
): StructuredJsonLimits => {
  const resolve = (value: unknown, fallback: number): number => {
    // 不接受 NaN/Infinity/小数等会削弱边界语义的值；缺省或非法值回退到
    // 安全默认值，而不是把限制静默变成无限大。
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
      return fallback;
    }
    return value;
  };

  return {
    maxInputChars: resolve(limits?.maxInputChars, DEFAULT_STRUCTURED_JSON_LIMITS.maxInputChars),
    maxNestingDepth: resolve(limits?.maxNestingDepth, DEFAULT_STRUCTURED_JSON_LIMITS.maxNestingDepth),
    maxNodes: resolve(limits?.maxNodes, DEFAULT_STRUCTURED_JSON_LIMITS.maxNodes),
  };
};

const assertInputWithinStructuredJsonLimit = (input: string, limits: StructuredJsonLimits): void => {
  if (input.length > limits.maxInputChars) {
    throw new StructuredJsonParseError('input-too-large', '结构化输出超过允许的输入长度限制');
  }
};

const isUnsafeStructuredJsonKey = (key: string): boolean =>
  key === '__proto__' || key === 'prototype' || key === 'constructor';

type StructuredJsonScanItem = { value: unknown; depth: number };

/**
 * 在任何 schema 校验、键归一化或类型 coercion 前，对 JSON.parse 的结果做
 * 有界、非递归扫描。模型输出来自 JSON.parse/jsonrepair，因此这里只允许
 * JSON 的 object/array/primitive 形态；保守拒绝其它对象形态以防调用方未来
 * 复用内部校验时引入 getter/prototype 等副作用。
 */
const assertSafeStructuredJsonValue = (value: unknown, limits: StructuredJsonLimits): void => {
  const pending: StructuredJsonScanItem[] = [{ value, depth: 0 }];
  let nodes = 0;

  while (pending.length > 0) {
    const current = pending.pop()!;
    nodes += 1;
    if (nodes > limits.maxNodes) {
      throw new StructuredJsonParseError('limit-exceeded', '结构化输出超过允许的节点数量限制');
    }
    if (current.depth > limits.maxNestingDepth) {
      throw new StructuredJsonParseError('limit-exceeded', '结构化输出超过允许的嵌套深度限制');
    }

    const currentValue = current.value;
    if (currentValue === null || typeof currentValue !== 'object') continue;

    if (Array.isArray(currentValue)) {
      // JSON.parse 不会产生稀疏数组，但显式检查 length/own index 可避免该
      // 边界被未来的 parser/adapter 改变后绕过节点计数。
      for (let index = currentValue.length - 1; index >= 0; index -= 1) {
        if (!Object.prototype.hasOwnProperty.call(currentValue, index)) {
          throw new StructuredJsonParseError('invalid-output', '结构化输出包含无效数组');
        }
        pending.push({ value: currentValue[index], depth: current.depth + 1 });
      }
      for (const key of Object.keys(currentValue)) {
        if (isUnsafeStructuredJsonKey(key)) {
          throw new StructuredJsonParseError('unsafe-key', '结构化输出包含不允许的键名');
        }
      }
      continue;
    }

    const prototype = Object.getPrototypeOf(currentValue);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new StructuredJsonParseError('invalid-output', '结构化输出包含无效对象');
    }

    const keys = Object.keys(currentValue);
    for (const key of keys) {
      if (isUnsafeStructuredJsonKey(key)) {
        throw new StructuredJsonParseError('unsafe-key', '结构化输出包含不允许的键名');
      }
    }
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index]!;
      pending.push({ value: (currentValue as Record<string, unknown>)[key], depth: current.depth + 1 });
    }
  }
};

const parseJsonWithStructuredJsonLimits = (input: string, limits: StructuredJsonLimits): unknown => {
  assertInputWithinStructuredJsonLimit(input, limits);
  const parsed = tryParseJson(input);
  assertSafeStructuredJsonValue(parsed, limits);
  return parsed;
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

type KeyNormalizationAttempt = { attempted: boolean; succeeded: boolean };
type SchemaCoercionAttempt = { attempted: boolean; succeeded: boolean };

type UnwrapAttempt = {
  attempted: boolean;
  succeeded: boolean;
  key?: string;
  strategy?: 'known-key' | 'text-field' | 'single-key' | 'scan-keys';
};

type ValidationResult<T> =
  | { ok: true; data: T; keyNormalization: KeyNormalizationAttempt; schemaCoercion: SchemaCoercionAttempt }
  | { ok: false; keyNormalization: KeyNormalizationAttempt; schemaCoercion: SchemaCoercionAttempt };

const hasOwnKey = (record: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);

const inspectSchema = (
  schema: z.ZodTypeAny,
): { core: z.ZodTypeAny; optional: boolean; nullable: boolean } => {
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

  return { core: current, optional, nullable };
};

const levenshteinDistanceLimited = (a: string, b: string, maxDistance: number): number => {
  const lenA = a.length;
  const lenB = b.length;
  if (Math.abs(lenA - lenB) > maxDistance) return maxDistance + 1;

  let previousRow = new Array(lenB + 1).fill(0);
  for (let j = 0; j <= lenB; j++) previousRow[j] = j;

  for (let i = 1; i <= lenA; i++) {
    const currentRow = new Array(lenB + 1).fill(0);
    currentRow[0] = i;
    let rowMin = currentRow[0];

    for (let j = 1; j <= lenB; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currentRow[j] = Math.min(
        previousRow[j]! + 1,
        currentRow[j - 1]! + 1,
        previousRow[j - 1]! + cost,
      );
      if (currentRow[j]! < rowMin) rowMin = currentRow[j]!;
    }

    if (rowMin > maxDistance) return maxDistance + 1;
    previousRow = currentRow;
  }

  return previousRow[lenB]!;
};

const findMatchingKeyBySchema = (
  expectedKey: string,
  record: Record<string, unknown>,
  usedSourceKeys: Set<string>,
): string | null => {
  const variants = [expectedKey, toSnakeCase(expectedKey), toCamelCase(expectedKey)];
  for (const variant of variants) {
    if (usedSourceKeys.has(variant)) continue;
    if (hasOwnKey(record, variant)) return variant;
  }

  const expectedCanonical = canonicalizeKey(expectedKey);
  const exactCanonicalMatches = Object.keys(record).filter(
    (key) => !usedSourceKeys.has(key) && canonicalizeKey(key) === expectedCanonical,
  );
  if (exactCanonicalMatches.length === 1) {
    return exactCanonicalMatches[0]!;
  }

  const maxDistance = expectedCanonical.length <= 6 ? 1 : 2;
  let best: { key: string; distance: number } | null = null;
  let hasTie = false;

  for (const sourceKey of Object.keys(record)) {
    if (usedSourceKeys.has(sourceKey)) continue;
    const sourceCanonical = canonicalizeKey(sourceKey);
    if (!sourceCanonical || sourceCanonical[0] !== expectedCanonical[0]) continue;
    const distance = levenshteinDistanceLimited(sourceCanonical, expectedCanonical, maxDistance);
    if (distance > maxDistance) continue;

    if (!best || distance < best.distance) {
      best = { key: sourceKey, distance };
      hasTie = false;
      continue;
    }
    if (distance === best.distance) hasTie = true;
  }

  if (!best || hasTie) return null;
  return best.key;
};

const normalizeKeysBySchema = (
  value: unknown,
  schema: z.ZodTypeAny,
  depth: number,
): { value: unknown; changed: boolean } => {
  if (depth > 10) return { value, changed: false };

  const core = unwrapToCoreSchema(schema);
  const def: any = (core as any)?._def;
  const typeName: ZodTypeName | undefined = def?.typeName;

  if (typeName === z.ZodFirstPartyTypeKind.ZodArray) {
    if (!Array.isArray(value)) return { value, changed: false };
    const next: unknown[] = [];
    let changed = false;
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      const normalized = normalizeKeysBySchema(item, def.type, depth + 1);
      next.push(normalized.value);
      if (normalized.changed) changed = true;
    }
    return changed ? { value: next, changed: true } : { value, changed: false };
  }

  if (typeName === z.ZodFirstPartyTypeKind.ZodRecord) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { value, changed: false };
    const record = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    let changed = false;
    for (const [k, v] of Object.entries(record)) {
      const normalized = normalizeKeysBySchema(v, def.valueType, depth + 1);
      next[k] = normalized.value;
      if (normalized.changed) changed = true;
    }
    return changed ? { value: next, changed: true } : { value, changed: false };
  }

  if (typeName !== z.ZodFirstPartyTypeKind.ZodObject) {
    return { value, changed: false };
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) return { value, changed: false };
  const record = value as Record<string, unknown>;
  const shape = typeof def.shape === 'function' ? def.shape() : {};

  let changed = false;
  const merged: Record<string, unknown> = { ...record };
  const usedSourceKeys = new Set<string>();

  for (const [expectedKey, subSchema] of Object.entries(shape)) {
    const foundKey = findMatchingKeyBySchema(expectedKey, record, usedSourceKeys);
    if (!foundKey) continue;
    usedSourceKeys.add(foundKey);

    const normalized = normalizeKeysBySchema(record[foundKey], subSchema as z.ZodTypeAny, depth + 1);
    if (foundKey !== expectedKey || normalized.changed) {
      merged[expectedKey] = normalized.value;
      changed = true;
    }
    if (foundKey !== expectedKey && hasOwnKey(merged, foundKey)) {
      delete merged[foundKey];
      changed = true;
    }
  }

  return changed ? { value: merged, changed: true } : { value, changed: false };
};

const buildRequiredFallbackValue = (
  schema: z.ZodTypeAny,
  depth: number,
): { hasValue: boolean; value?: unknown } => {
  if (depth > 10) return { hasValue: false };

  const inspected = inspectSchema(schema);
  if (inspected.optional) return { hasValue: false };
  if (inspected.nullable) return { hasValue: true, value: null };

  const def: any = (inspected.core as any)?._def;
  const typeName: ZodTypeName | undefined = def?.typeName;

  if (typeName === z.ZodFirstPartyTypeKind.ZodString) return { hasValue: true, value: '' };
  if (typeName === z.ZodFirstPartyTypeKind.ZodNumber) return { hasValue: true, value: 0 };
  if (typeName === z.ZodFirstPartyTypeKind.ZodBoolean) return { hasValue: true, value: false };
  if (typeName === z.ZodFirstPartyTypeKind.ZodArray) return { hasValue: true, value: [] };
  if (typeName === z.ZodFirstPartyTypeKind.ZodRecord) return { hasValue: true, value: {} };

  if (typeName === z.ZodFirstPartyTypeKind.ZodEnum) {
    const values = Array.isArray(def?.values) ? def.values : [];
    if (values.length > 0) return { hasValue: true, value: values[0] };
  }

  if (typeName === z.ZodFirstPartyTypeKind.ZodNativeEnum) {
    const values = def?.values && typeof def.values === 'object' ? Object.values(def.values) : [];
    const filtered = values.filter((v: unknown) => typeof v === 'string' || typeof v === 'number');
    if (filtered.length > 0) return { hasValue: true, value: filtered[0] };
  }

  if (typeName === z.ZodFirstPartyTypeKind.ZodLiteral) {
    return { hasValue: true, value: def?.value };
  }

  if (typeName === z.ZodFirstPartyTypeKind.ZodObject) {
    const shape = typeof def.shape === 'function' ? def.shape() : {};
    const out: Record<string, unknown> = {};
    let hasAny = false;
    for (const [key, subSchema] of Object.entries(shape)) {
      const child = buildRequiredFallbackValue(subSchema as z.ZodTypeAny, depth + 1);
      if (!child.hasValue) continue;
      out[key] = child.value;
      hasAny = true;
    }
    return hasAny ? { hasValue: true, value: out } : { hasValue: true, value: {} };
  }

  if (typeName === z.ZodFirstPartyTypeKind.ZodUnion) {
    const options = Array.isArray(def?.options) ? def.options : [];
    for (const option of options) {
      const candidate = buildRequiredFallbackValue(option as z.ZodTypeAny, depth + 1);
      if (!candidate.hasValue) continue;
      const parsed = (option as z.ZodTypeAny).safeParse(candidate.value);
      if (parsed.success) return { hasValue: true, value: parsed.data };
    }
  }

  return { hasValue: false };
};

const coerceStringIntoObjectBySchema = (
  text: string,
  shape: Record<string, unknown>,
  depth: number,
): { value: unknown; changed: boolean } => {
  const stringFields = Object.entries(shape)
    .map(([key, subSchema]) => ({ key, schema: subSchema as z.ZodTypeAny, inspected: inspectSchema(subSchema as z.ZodTypeAny) }))
    .filter(({ inspected }) => {
      const def: any = (inspected.core as any)?._def;
      return def?.typeName === z.ZodFirstPartyTypeKind.ZodString;
    });

  if (stringFields.length === 0) return { value: text, changed: false };

  const preferred = stringFields.find((field) => !field.inspected.optional) ?? stringFields[0]!;
  const out: Record<string, unknown> = { [preferred.key]: text.trim() };

  for (const [key, subSchema] of Object.entries(shape)) {
    if (key === preferred.key) continue;
    const fallback = buildRequiredFallbackValue(subSchema as z.ZodTypeAny, depth + 1);
    if (!fallback.hasValue) continue;
    out[key] = fallback.value;
  }

  return { value: out, changed: true };
};

const coerceValueBySchema = (
  value: unknown,
  schema: z.ZodTypeAny,
  depth: number,
): { value: unknown; changed: boolean } => {
  if (depth > 10) return { value, changed: false };
  if (value == null) return { value, changed: false };

  const inspected = inspectSchema(schema);
  const def: any = (inspected.core as any)?._def;
  const typeName: ZodTypeName | undefined = def?.typeName;

  if (typeName === z.ZodFirstPartyTypeKind.ZodString) {
    if (typeof value === 'string') return { value, changed: false };
    if (typeof value === 'number' || typeof value === 'boolean') return { value: String(value), changed: true };
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      const candidates = ['answer', 'value', 'text', 'content', 'summary', 'message'];
      for (const key of candidates) {
        const candidate = record[key];
        if (typeof candidate === 'string' && candidate.trim()) {
          return { value: candidate, changed: true };
        }
      }
      try {
        return { value: JSON.stringify(value), changed: true };
      } catch {
        return { value, changed: false };
      }
    }
    if (Array.isArray(value)) {
      const asString = value
        .map((item) => (typeof item === 'string' ? item : typeof item === 'number' || typeof item === 'boolean' ? String(item) : ''))
        .filter((item) => item.length > 0)
        .join(' / ');
      if (asString) return { value: asString, changed: true };
    }
    return { value, changed: false };
  }

  if (typeName === z.ZodFirstPartyTypeKind.ZodNumber) {
    if (typeof value === 'number') return { value, changed: false };
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return { value, changed: false };
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) return { value: parsed, changed: true };
      return { value, changed: false };
    }
    if (typeof value === 'boolean') return { value: value ? 1 : 0, changed: true };
    return { value, changed: false };
  }

  if (typeName === z.ZodFirstPartyTypeKind.ZodBoolean) {
    if (typeof value === 'boolean') return { value, changed: false };
    if (typeof value === 'number' && (value === 0 || value === 1)) return { value: value === 1, changed: true };
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true' || normalized === '1') return { value: true, changed: true };
      if (normalized === 'false' || normalized === '0') return { value: false, changed: true };
    }
    return { value, changed: false };
  }

  if (typeName === z.ZodFirstPartyTypeKind.ZodEnum) {
    if (typeof value !== 'string') return { value, changed: false };
    const candidates: string[] = Array.isArray(def?.values) ? def.values : [];
    const exact = candidates.find((item) => item === value);
    if (exact) return { value, changed: false };
    const normalizedInput = value.trim().toLowerCase();
    const fuzzy = candidates.find((item) => item.toLowerCase() === normalizedInput);
    if (fuzzy) return { value: fuzzy, changed: true };
    return { value, changed: false };
  }

  if (typeName === z.ZodFirstPartyTypeKind.ZodLiteral) {
    if (value === def?.value) return { value, changed: false };
    if (typeof def?.value === 'string' && typeof value === 'string' && value.trim() === def.value) {
      return { value: def.value, changed: true };
    }
    return { value, changed: false };
  }

  if (typeName === z.ZodFirstPartyTypeKind.ZodUnion) {
    const options = Array.isArray(def?.options) ? def.options : [];
    for (const option of options) {
      const direct = (option as z.ZodTypeAny).safeParse(value);
      if (direct.success) return { value, changed: false };
    }
    for (const option of options) {
      const coerced = coerceValueBySchema(value, option as z.ZodTypeAny, depth + 1);
      if (!coerced.changed) continue;
      const parsed = (option as z.ZodTypeAny).safeParse(coerced.value);
      if (parsed.success) return { value: parsed.data, changed: true };
    }
    return { value, changed: false };
  }

  if (typeName === z.ZodFirstPartyTypeKind.ZodArray) {
    if (Array.isArray(value)) {
      let changed = false;
      const next = value.map((item) => {
        const coerced = coerceValueBySchema(item, def.type, depth + 1);
        if (coerced.changed) changed = true;
        return coerced.value;
      });
      return changed ? { value: next, changed: true } : { value, changed: false };
    }
    const wrapped = coerceValueBySchema(value, def.type, depth + 1);
    return { value: [wrapped.value], changed: true };
  }

  if (typeName === z.ZodFirstPartyTypeKind.ZodRecord) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { value, changed: false };
    const record = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    let changed = false;
    for (const [k, v] of Object.entries(record)) {
      const coerced = coerceValueBySchema(v, def.valueType, depth + 1);
      next[k] = coerced.value;
      if (coerced.changed) changed = true;
    }
    return changed ? { value: next, changed: true } : { value, changed: false };
  }

  if (typeName === z.ZodFirstPartyTypeKind.ZodObject) {
    const shape = typeof def.shape === 'function' ? def.shape() : {};

    if (typeof value === 'string') {
      return coerceStringIntoObjectBySchema(value, shape, depth + 1);
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) return { value, changed: false };
    const record = value as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...record };
    const usedSourceKeys = new Set<string>();
    let changed = false;
    let touchedKeys = 0;

    for (const [expectedKey, subSchema] of Object.entries(shape)) {
      const foundKey = findMatchingKeyBySchema(expectedKey, record, usedSourceKeys);
      if (!foundKey) continue;
      usedSourceKeys.add(foundKey);
      touchedKeys += 1;

      const coerced = coerceValueBySchema(record[foundKey], subSchema as z.ZodTypeAny, depth + 1);
      if (foundKey !== expectedKey || coerced.changed) {
        merged[expectedKey] = coerced.value;
        changed = true;
      }
      if (foundKey !== expectedKey && hasOwnKey(merged, foundKey)) {
        delete merged[foundKey];
        changed = true;
      }
    }

    if (touchedKeys > 0 && depth > 0) {
      for (const [expectedKey, subSchema] of Object.entries(shape)) {
        if (hasOwnKey(merged, expectedKey)) continue;
        const fallback = buildRequiredFallbackValue(subSchema as z.ZodTypeAny, depth + 1);
        if (!fallback.hasValue) continue;
        merged[expectedKey] = fallback.value;
        changed = true;
      }
    }

    return changed ? { value: merged, changed: true } : { value, changed: false };
  }

  return { value, changed: false };
};

const validateWithNormalization = <T>(
  value: unknown,
  schema: z.ZodSchema<T>,
  limits: StructuredJsonLimits,
): ValidationResult<T> => {
  // 这是所有 schema/coercion 路径的统一入口；即使调用方未来新增
  // unwrap/normalization 分支，也不能在扫描前把模型对象交给 Zod。
  assertSafeStructuredJsonValue(value, limits);
  const direct = schema.safeParse(value);
  if (direct.success) {
    return {
      ok: true,
      data: direct.data,
      keyNormalization: { attempted: false, succeeded: false },
      schemaCoercion: { attempted: false, succeeded: false },
    };
  }

  const normalized = normalizeKeysBySchema(value, schema, 0);
  if (normalized.changed) {
    const retried = schema.safeParse(normalized.value);
    if (retried.success) {
      return {
        ok: true,
        data: retried.data,
        keyNormalization: { attempted: true, succeeded: true },
        schemaCoercion: { attempted: false, succeeded: false },
      };
    }
  }

  const source = normalized.changed ? normalized.value : value;
  const coerced = coerceValueBySchema(source, schema, 0);
  if (!coerced.changed) {
    return {
      ok: false,
      keyNormalization: { attempted: normalized.changed, succeeded: false },
      schemaCoercion: { attempted: false, succeeded: false },
    };
  }

  const retriedAfterCoercion = schema.safeParse(coerced.value);
  if (retriedAfterCoercion.success) {
    return {
      ok: true,
      data: retriedAfterCoercion.data,
      keyNormalization: { attempted: normalized.changed, succeeded: false },
      schemaCoercion: { attempted: true, succeeded: true },
    };
  }

  return {
    ok: false,
    keyNormalization: { attempted: normalized.changed, succeeded: false },
    schemaCoercion: { attempted: true, succeeded: false },
  };
};

const tryUnwrapAndValidate = <T>(
  value: unknown,
  schema: z.ZodSchema<T>,
  unwrapCandidates: readonly string[],
  textFieldCandidates: readonly string[],
  limits: StructuredJsonLimits,
): {
  ok: true;
  data: T;
  unwrap: UnwrapAttempt;
  keyNormalization: KeyNormalizationAttempt;
  schemaCoercion: SchemaCoercionAttempt;
} | { ok: false; unwrap: UnwrapAttempt } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, unwrap: { attempted: false, succeeded: false } };
  }

  const record = value as Record<string, unknown>;

  const validateInner = (
    inner: unknown,
    unwrap: UnwrapAttempt,
  ): {
    ok: true;
    data: T;
    unwrap: UnwrapAttempt;
    keyNormalization: KeyNormalizationAttempt;
    schemaCoercion: SchemaCoercionAttempt;
  } | null => {
    if (inner == null || typeof inner !== 'object') return null;
    const validated = validateWithNormalization(inner, schema, limits);
    if (validated.ok) {
      return {
        ok: true,
        data: validated.data,
        unwrap,
        keyNormalization: validated.keyNormalization,
        schemaCoercion: validated.schemaCoercion,
      };
    }
    return null;
  };

  const validateInnerText = (
    innerText: string,
    unwrap: UnwrapAttempt,
  ): {
    ok: true;
    data: T;
    unwrap: UnwrapAttempt;
    keyNormalization: KeyNormalizationAttempt;
    schemaCoercion: SchemaCoercionAttempt;
  } | null => {
    if (!innerText.trim()) return null;
    try {
      const parsedInner = parseJsonWithStructuredJsonLimits(innerText, limits);
      return validateInner(parsedInner, unwrap);
    } catch (error) {
      if (error instanceof StructuredJsonParseError) throw error;
      return null;
    }
  };

  for (const key of unwrapCandidates) {
    const inner = record[key];
    if (!inner) continue;
    const hit = validateInner(inner, { attempted: true, succeeded: true, key, strategy: 'known-key' });
    if (hit) return hit;
  }

  for (const key of textFieldCandidates) {
    const inner = record[key];
    if (typeof inner !== 'string' || !inner.trim()) continue;
    const hit = validateInnerText(inner, { attempted: true, succeeded: true, key, strategy: 'text-field' });
    if (hit) return hit;
  }

  const keys = Object.keys(record);
  if (keys.length === 1) {
    const key = keys[0]!;
    const inner = record[key];
    const hit = validateInner(inner, { attempted: true, succeeded: true, key, strategy: 'single-key' });
    if (hit) return hit;
    if (typeof inner === 'string') {
      const hitText = validateInnerText(inner, { attempted: true, succeeded: true, key, strategy: 'single-key' });
      if (hitText) return hitText;
    }
  }

  for (const key of keys) {
    if (unwrapCandidates.includes(key) || textFieldCandidates.includes(key)) continue;
    const inner = record[key];
    if (!inner) continue;
    const hit = validateInner(inner, { attempted: true, succeeded: true, key, strategy: 'scan-keys' });
    if (hit) return hit;
    if (typeof inner === 'string') {
      const hitText = validateInnerText(inner, { attempted: true, succeeded: true, key, strategy: 'scan-keys' });
      if (hitText) return hitText;
    }
  }

  return { ok: false, unwrap: { attempted: true, succeeded: false } };
};

export type ParseStructuredJsonOptions = {
  taskName?: string;
  unwrapCandidates?: readonly string[];
  textFieldCandidates?: readonly string[];
  limits?: Partial<StructuredJsonLimits>;
};

export type ParseStructuredJsonTelemetry = {
  usedCandidateIndex: number;
  candidateStartIndex: number;
  candidateEndIndex: number;
  usedJsonRepair: boolean;
  unwrapAttempt: UnwrapAttempt;
  keyNormalization: KeyNormalizationAttempt;
  schemaCoercion: SchemaCoercionAttempt;
};

/**
 * Parses untrusted model text with the legacy Zod v3 compatibility API.
 * Callers using native Zod v4 schemas need an explicit adapter; v4 schema
 * internals are intentionally not guessed by this repair pipeline.
 */
export function parseStructuredJsonWithSchema<T>(
  rawText: string,
  schema: z.ZodSchema<T>,
  options: ParseStructuredJsonOptions = {},
): { data: T; telemetry: ParseStructuredJsonTelemetry } {
  const taskName = options.taskName ?? '结构化输出解析';
  const limits = resolveStructuredJsonLimits(options.limits);
  if (typeof rawText !== 'string') {
    throw new StructuredJsonParseError('invalid-output', `${taskName}失败：结构化输出不是文本`);
  }
  assertInputWithinStructuredJsonLimit(rawText, limits);
  const unwrapCandidates = options.unwrapCandidates ?? ['value', 'data', 'payload', 'result'];
  const textFieldCandidates = options.textFieldCandidates ?? ['json', 'text', 'raw', 'content', 'body'];

  const candidates = [
    ...extractJsonCandidates(rawText),
    ...buildMissingRootObjectCandidates(rawText, schema),
  ];
  if (candidates.length === 0) {
    throw new StructuredJsonParseError('invalid-output', `${taskName}失败：未找到可解析的 JSON 片段`);
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
        if (e instanceof StructuredJsonParseError) throw e;
        lastError = e;
        continue;
      }
    }

    // 必须在 direct schema.safeParse、unwrap、键归一化与 coercion 之前执行。
    assertSafeStructuredJsonValue(parsedJson, limits);

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
          keyNormalization: { attempted: false, succeeded: false },
          schemaCoercion: { attempted: false, succeeded: false },
        },
      };
    }

    const unwrapped = tryUnwrapAndValidate(
      parsedJson,
      schema,
      unwrapCandidates,
      textFieldCandidates,
      limits,
    );
    if (unwrapped.ok) {
      return {
        data: unwrapped.data,
        telemetry: {
          usedCandidateIndex: i,
          candidateStartIndex: candidate.startIndex,
          candidateEndIndex: candidate.endIndex,
          usedJsonRepair,
          unwrapAttempt: unwrapped.unwrap,
          keyNormalization: unwrapped.keyNormalization,
          schemaCoercion: unwrapped.schemaCoercion,
        },
      };
    }

    const normalized = validateWithNormalization(parsedJson, schema, limits);
    if (normalized.ok) {
      return {
        data: normalized.data,
        telemetry: {
          usedCandidateIndex: i,
          candidateStartIndex: candidate.startIndex,
          candidateEndIndex: candidate.endIndex,
          usedJsonRepair,
          unwrapAttempt: { attempted: false, succeeded: false },
          keyNormalization: normalized.keyNormalization,
          schemaCoercion: normalized.schemaCoercion,
        },
      };
    }

    // 不保留 Zod issue/raw value；最终错误必须不包含不可信模型输出。
    lastError = new Error('schema-validation-failed');
  }

  // lastError 仅用于调试流程内部，不向调用方透传其 message/cause。
  void lastError;
  throw new StructuredJsonParseError(
    'invalid-output',
    `${taskName}失败：JSON 解析/修复后仍无法通过 Schema 校验`,
  );
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

/** Builds a compact prompt instruction from a Zod v3 compatibility schema. */
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
