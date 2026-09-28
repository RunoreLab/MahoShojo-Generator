import { Validator } from '@cfworker/json-schema';

const DRAFT_2020_12 = 'https://json-schema.org/draft/2020-12/schema';

type Schema = boolean | { [key: string]: unknown };

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

/**
 * Draft 2020-12 assertion keywords the host validator does not implement.
 * Ignoring them would silently weaken author-declared constraints, so fail closed.
 * Unknown *extension* keywords remain ignored per JSON Schema.
 *
 * `@cfworker/json-schema` implements unevaluatedProperties / unevaluatedItems /
 * propertyNames / dependentSchemas; only dynamic scope keywords remain
 * unsupported upstream (cfworker #150).
 */
const UNSUPPORTED_STANDARD_KEYWORDS = new Set([
  '$dynamicRef',
  '$dynamicAnchor',
]);

/** Structural schema positions to walk; instance-data keywords (const/enum/default) are skipped. */
const SINGLE_SCHEMA_KEYWORDS = new Set([
  'not',
  'if',
  'then',
  'else',
  'items',
  'contains',
  'additionalProperties',
  'propertyNames',
  'unevaluatedProperties',
  'unevaluatedItems',
]);

const SCHEMA_ARRAY_KEYWORDS = new Set([
  'allOf',
  'anyOf',
  'oneOf',
  'prefixItems',
]);

const SCHEMA_MAP_KEYWORDS = new Set([
  '$defs',
  'definitions',
  'patternProperties',
  'properties',
  'dependentSchemas',
]);

const visitChildSchemas = (
  node: Record<string, unknown>,
  visit: (_child: unknown, _path: string) => void,
): void => {
  for (const keyword of SINGLE_SCHEMA_KEYWORDS) {
    if (keyword in node) visit(node[keyword], keyword);
  }
  for (const keyword of SCHEMA_ARRAY_KEYWORDS) {
    const value = node[keyword];
    if (!Array.isArray(value)) continue;
    value.forEach((child, index) => visit(child, `${keyword}[${index}]`));
  }
  for (const keyword of SCHEMA_MAP_KEYWORDS) {
    const value = node[keyword];
    if (!isRecord(value)) continue;
    for (const [name, child] of Object.entries(value)) {
      visit(child, `${keyword}.${name}`);
    }
  }
};

const assertSupportedKeywords = (node: unknown): void => {
  if (typeof node === 'boolean') return;
  if (!isRecord(node)) return;
  for (const key of Object.keys(node)) {
    if (UNSUPPORTED_STANDARD_KEYWORDS.has(key)) {
      throw new Error(`JSON Schema 使用了宿主未实现的标准关键字：${key}`);
    }
  }
  visitChildSchemas(node, (child) => assertSupportedKeywords(child));
};

/** Only same-document JSON pointers are allowed; external $ref would escape the fail-closed host. */
const assertLocalRefsOnly = (node: unknown): void => {
  if (typeof node === 'boolean') return;
  if (!isRecord(node)) return;
  const ref = node.$ref;
  if (ref !== undefined) {
    if (typeof ref !== 'string') throw new Error('JSON Schema $ref 必须是 string');
    if (ref !== '#' && !ref.startsWith('#/')) {
      throw new Error(`不支持的 JSON Schema $ref：${ref}`);
    }
  }
  visitChildSchemas(node, (child) => assertLocalRefsOnly(child));
};

/**
 * Wrong-typed assertion keywords would otherwise be silently ignored or coerced
 * by the interpreter (e.g. minLength: 'nope'), so meta-validate them fail-closed.
 * Numeric bounds follow Draft 2020-12: non-negative integers; multipleOf > 0.
 */
const assertKeywordArgumentShapes = (node: unknown, path = ''): void => {
  if (typeof node === 'boolean') return;
  if (!isRecord(node)) return;

  const where = path || '$';
  const nonNegativeIntKeywords = [
    'minLength', 'maxLength', 'minItems', 'maxItems',
    'minProperties', 'maxProperties', 'minContains', 'maxContains',
  ] as const;
  for (const keyword of nonNegativeIntKeywords) {
    if (!(keyword in node)) continue;
    const value = node[keyword];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${where} 的 ${keyword} 必须是非负整数`);
    }
  }
  const finiteNumberKeywords = [
    'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
  ] as const;
  for (const keyword of finiteNumberKeywords) {
    if (keyword in node && (typeof node[keyword] !== 'number' || !Number.isFinite(node[keyword] as number))) {
      throw new Error(`${where} 的 ${keyword} 必须是 number`);
    }
  }
  if ('multipleOf' in node) {
    const value = node.multipleOf;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new Error(`${where} 的 multipleOf 必须是大于 0 的 number`);
    }
  }
  if ('uniqueItems' in node && typeof node.uniqueItems !== 'boolean') {
    throw new Error(`${where} 的 uniqueItems 必须是 boolean`);
  }
  if ('pattern' in node && typeof node.pattern !== 'string') {
    throw new Error(`${where} 的 pattern 必须是 string`);
  }
  if ('required' in node) {
    const required = node.required;
    if (!Array.isArray(required) || required.some((key) => typeof key !== 'string')) {
      throw new Error(`${where} 的 required 必须是 string[]`);
    }
    if (new Set(required as string[]).size !== required.length) {
      throw new Error(`${where} 的 required 不得包含重复项`);
    }
  }
  if ('enum' in node && !Array.isArray(node.enum)) {
    throw new Error(`${where} 的 enum 必须是 array`);
  }
  for (const keyword of SCHEMA_ARRAY_KEYWORDS) {
    if (!(keyword in node)) continue;
    const value = node[keyword];
    if (!Array.isArray(value) || value.some((child) => typeof child !== 'boolean' && !isRecord(child))) {
      throw new Error(`${where} 的 ${keyword} 必须是 JSON Schema[]`);
    }
  }
  for (const keyword of SINGLE_SCHEMA_KEYWORDS) {
    if (!(keyword in node)) continue;
    const value = node[keyword];
    if (typeof value !== 'boolean' && !isRecord(value)) {
      throw new Error(`${where} 的 ${keyword} 必须是 JSON Schema`);
    }
  }
  for (const keyword of SCHEMA_MAP_KEYWORDS) {
    if (!(keyword in node)) continue;
    const value = node[keyword];
    if (!isRecord(value) || Object.values(value).some((child) => typeof child !== 'boolean' && !isRecord(child))) {
      throw new Error(`${where} 的 ${keyword} 必须是 JSON Schema map`);
    }
  }
  if ('type' in node) {
    const type = node.type;
    const valid = typeof type === 'string'
      || (Array.isArray(type) && type.every((entry) => typeof entry === 'string'));
    if (!valid) throw new Error(`${where} 的 type 必须是 string 或 string[]`);
  }

  visitChildSchemas(node, (child, childPath) => {
    assertKeywordArgumentShapes(child, path ? `${path}.${childPath}` : childPath);
  });
};

/**
 * Preflight creator schemas before import/provider dispatch. Native JS regex is
 * deliberately unavailable for packages until a bounded implementation is needed.
 * Only schema positions are visited; annotation/default/const data is inert.
 */
export const preflightWebPackageJsonSchema = (schema: unknown): void => {
  if (!isRecord(schema) && typeof schema !== 'boolean') throw new Error('JSON Schema 必须是 object 或 boolean');
  const nodes = new Set<unknown>();
  const refs = new Map<Record<string, unknown>, string>();
  const visit = (node: unknown, depth = 0): void => {
    if (depth > 64 || nodes.size > 4096) throw new Error('JSON Schema 超出结构复杂度预算');
    nodes.add(node);
    if (!isRecord(node)) return;
    if (Object.keys(node).some((key) => key.startsWith('__absolute_')) || '$recursiveRef' in node || '$recursiveAnchor' in node) {
      throw new Error('JSON Schema 不支持内部或旧版递归关键字');
    }
    if ('pattern' in node || 'patternProperties' in node) {
      throw new Error('Web Package JSON Schema 暂不支持 pattern / patternProperties 正则约束');
    }
    if ('$schema' in node && node.$schema !== DRAFT_2020_12) {
      throw new Error('JSON Schema 仅支持 Draft 2020-12');
    }
    if ('type' in node) {
      const types = Array.isArray(node.type) ? node.type : [node.type];
      const allowed = ['null', 'boolean', 'object', 'array', 'number', 'integer', 'string'];
      if (!types.length || types.some((type) => !allowed.includes(type as string)) || new Set(types).size !== types.length) {
        throw new Error('JSON Schema type 必须是合法且不重复的类型');
      }
    }
    if ('dependentRequired' in node && (!isRecord(node.dependentRequired) || Object.values(node.dependentRequired).some(
      (value) => !Array.isArray(value) || value.some((key) => typeof key !== 'string') || new Set(value).size !== value.length,
    ))) {
      throw new Error('JSON Schema dependentRequired 必须是 string[] map');
    }
    if ('enum' in node && (!Array.isArray(node.enum) || !node.enum.length)) {
      throw new Error('JSON Schema enum 必须是非空 array');
    }
    if (typeof node.$ref === 'string') refs.set(node, node.$ref);
    visitChildSchemas(node, (child) => visit(child, depth + 1));
  };
  visit(schema);
  assertSupportedKeywords(schema);
  assertLocalRefsOnly(schema);
  try {
    assertKeywordArgumentShapes(schema);
  } catch (error) {
    throw new Error('JSON Schema 无效：' + (error instanceof Error ? error.message : String(error)));
  }
  const targets = new Map<unknown, unknown>();
  for (const [source, ref] of refs) {
    let target: unknown = schema;
    try {
      for (const segment of ref === '#' ? [] : decodeURIComponent(ref.slice(2)).split('/')) {
        const key = segment.replace(/~1/gu, '/').replace(/~0/gu, '~');
        if ((!isRecord(target) && !Array.isArray(target)) || !Object.prototype.hasOwnProperty.call(target, key)) throw new Error();
        target = (target as Record<string, unknown>)[key];
      }
    } catch {
      throw new Error('JSON Schema $ref 无法解析');
    }
    if (!nodes.has(target)) throw new Error('JSON Schema $ref 必须指向当前文档中的 schema');
    targets.set(source, target);
  }
  // Reject recursion that revalidates the same instance forever. Descending
  // properties/items is deliberately excluded so ordinary recursive data works.
  const checked = new Set<unknown>();
  const active = new Set<unknown>();
  const checkProgress = (node: unknown): void => {
    if (!isRecord(node) || checked.has(node)) return;
    if (active.has(node)) throw new Error('JSON Schema $ref 存在不推进数据层级的循环');
    active.add(node);
    if (targets.has(node)) checkProgress(targets.get(node));
    for (const key of ['not', 'if', 'then', 'else']) checkProgress(node[key]);
    for (const key of ['allOf', 'anyOf', 'oneOf']) {
      if (Array.isArray(node[key])) (node[key] as unknown[]).forEach(checkProgress);
    }
    if (isRecord(node.dependentSchemas)) Object.values(node.dependentSchemas).forEach(checkProgress);
    active.delete(node);
    checked.add(node);
  };
  nodes.forEach(checkProgress);
  // Construction checks resource identifiers without evaluating generated data.
  new Validator(schema as Schema, '2020-12', false);
};

const formatCfworkerErrors = (errors: readonly { instanceLocation?: string; keyword?: string; error?: string }[]): string => (
  errors.slice(0, 5).map((issue) => {
    const location = issue.instanceLocation && issue.instanceLocation !== '#' ? `${issue.instanceLocation} ` : '';
    const keyword = issue.keyword ? `${issue.keyword}: ` : '';
    return `${location}${keyword}${issue.error ?? 'invalid'}`;
  }).join('；')
);

/**
 * CSP-safe Draft 2020-12 validator for Web Package generation targets.
 * Delegates interpretation to `@cfworker/json-schema` (no eval / new Function);
 * the host keeps fail-closed meta-validation for dialect, unsupported keywords,
 * local-only $ref, and wrong-typed assertion arguments.
 */
export const assertJsonSchema202012 = (schema: unknown, value: unknown): void => {
  if (!isRecord(schema) && typeof schema !== 'boolean') throw new Error('JSON Schema 必须是 object 或 boolean');
  if (schema === false) throw new Error(`JSON Schema 校验失败：${'$'} 不允许出现`);
  if (schema === true) return;
  const dialect = schema.$schema;
  if (typeof dialect === 'string' && dialect !== DRAFT_2020_12) {
    throw new Error(`仅支持 JSON Schema Draft 2020-12，收到：${dialect.slice(0, 120)}`);
  }
  assertSupportedKeywords(schema);
  assertLocalRefsOnly(schema);
  assertKeywordArgumentShapes(schema);

  const result = new Validator(schema as Record<string, unknown>, '2020-12', false).validate(value);
  if (!result.valid) {
    throw new Error(`JSON Schema 校验失败：${formatCfworkerErrors(result.errors)}`);
  }
};

export type { Schema };
