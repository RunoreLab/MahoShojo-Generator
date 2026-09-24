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
