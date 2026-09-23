const DRAFT_2020_12 = 'https://json-schema.org/draft/2020-12/schema';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

type Schema = boolean | { [key: string]: unknown };

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const typeOf = (value: unknown): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value as number) && typeof value === 'number') return 'integer';
  return typeof value;
};

const matchesType = (type: string, value: unknown): boolean => {
  const actual = typeOf(value);
  if (type === 'number') return actual === 'number' || actual === 'integer';
  if (type === 'integer') return actual === 'integer';
  return actual === type;
};

const deepEqual = (left: unknown, right: unknown): boolean => {
  if (left === right) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => deepEqual(item, right[index]));
  }
  if (typeof left === 'object') {
    const leftKeys = Object.keys(left as object).filter((key) => (left as Record<string, unknown>)[key] !== undefined);
    const rightKeys = Object.keys(right as object).filter((key) => (right as Record<string, unknown>)[key] !== undefined);
    return leftKeys.length === rightKeys.length && leftKeys.every((key) => (
      deepEqual((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key])
    ));
  }
  return false;
};

const resolveRef = (root: unknown, ref: string): Schema => {
  if (ref === '#' || ref === '#/') return root as Schema;
  if (!ref.startsWith('#/')) throw new Error(`不支持的 JSON Schema $ref：${ref}`);
  let cursor: unknown = root;
  for (const rawSegment of ref.slice(2).split('/')) {
    const segment = rawSegment.replace(/~1/gu, '/').replace(/~0/gu, '~');
    if (!isRecord(cursor) && !Array.isArray(cursor)) throw new Error(`JSON Schema $ref 不存在：${ref}`);
    cursor = (cursor as Record<string, unknown>)[segment];
    if (cursor === undefined) throw new Error(`JSON Schema $ref 不存在：${ref}`);
  }
  return cursor as Schema;
};

const collectErrors = (
  root: unknown,
  schema: Schema,
  value: unknown,
  path: string,
  errors: string[],
): void => {
  if (schema === true) return;
  if (schema === false) {
    errors.push(`${path || '$'} 不允许出现`);
    return;
  }
  if (!isRecord(schema)) {
    errors.push(`${path || '$'} 的 schema 非法`);
    return;
  }

  const ref = schema.$ref;
  if (typeof ref === 'string') {
    // Draft 2020-12 allows $ref siblings; both the target and local keywords apply.
    collectErrors(root, resolveRef(root, ref), value, path, errors);
  } else if ('$ref' in schema) {
    errors.push(`${path || '$'} 的 $ref 必须是 string`);
  }

  // Known assertion keywords with wrong types would otherwise be silently ignored.
  const numericKeywords = [
    'minLength', 'maxLength', 'minItems', 'maxItems',
    'minProperties', 'maxProperties',
    'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
    'multipleOf', 'minContains', 'maxContains',
  ] as const;
  for (const keyword of numericKeywords) {
    if (keyword in schema && typeof schema[keyword] !== 'number') {
      errors.push(`${path || '$'} 的 ${keyword} 必须是 number`);
    }
  }
  if ('uniqueItems' in schema && typeof schema.uniqueItems !== 'boolean') {
    errors.push(`${path || '$'} 的 uniqueItems 必须是 boolean`);
  }
  if ('pattern' in schema && typeof schema.pattern !== 'string') {
    errors.push(`${path || '$'} 的 pattern 必须是 string`);
  }
  if ('required' in schema && !Array.isArray(schema.required)) {
    errors.push(`${path || '$'} 的 required 必须是 array`);
  }
  if ('enum' in schema && !Array.isArray(schema.enum)) {
    errors.push(`${path || '$'} 的 enum 必须是 array`);
  }
  if ('allOf' in schema && !Array.isArray(schema.allOf)) {
    errors.push(`${path || '$'} 的 allOf 必须是 array`);
  }
  if ('anyOf' in schema && !Array.isArray(schema.anyOf)) {
    errors.push(`${path || '$'} 的 anyOf 必须是 array`);
  }
  if ('oneOf' in schema && !Array.isArray(schema.oneOf)) {
    errors.push(`${path || '$'} 的 oneOf 必须是 array`);
  }
  if ('prefixItems' in schema && !Array.isArray(schema.prefixItems)) {
    errors.push(`${path || '$'} 的 prefixItems 必须是 array`);
  }

  const type = schema.type;
  if (type !== undefined) {
    if (typeof type !== 'string' && !Array.isArray(type)) {
      errors.push(`${path || '$'} 的 type 必须是 string 或 string[]`);
    } else if (typeof type === 'string') {
      if (!matchesType(type, value)) {
        errors.push(`${path || '$'} 类型应为 ${type}`);
        return;
      }
    } else if (!type.some((entry) => typeof entry === 'string' && matchesType(entry, value))) {
      errors.push(`${path || '$'} 类型不在允许集合`);
      return;
    }
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => deepEqual(entry, value))) {
    errors.push(`${path || '$'} 不在 enum 允许值内`);
  }
  if ('const' in schema && !deepEqual(schema.const, value)) {
    errors.push(`${path || '$'} 必须等于 const`);
  }

  if (Array.isArray(schema.allOf)) {
    for (const entry of schema.allOf as Schema[]) collectErrors(root, entry, value, path, errors);
  }
  if (Array.isArray(schema.anyOf)) {
    const anyOfErrors = (schema.anyOf as Schema[]).map((entry) => {
      const bucket: string[] = [];
      collectErrors(root, entry, value, path, bucket);
      return bucket;
    });
    if (anyOfErrors.every((bucket) => bucket.length > 0)) errors.push(`${path || '$'} 不满足 anyOf`);
  }
  if (Array.isArray(schema.oneOf)) {
    let passed = 0;
    for (const entry of schema.oneOf as Schema[]) {
      const bucket: string[] = [];
      collectErrors(root, entry, value, path, bucket);
      if (bucket.length === 0) passed += 1;
    }
    if (passed !== 1) errors.push(`${path || '$'} 必须恰好满足 oneOf 中的 1 个分支`);
  }
  if (schema.not !== undefined) {
    const bucket: string[] = [];
    collectErrors(root, schema.not as Schema, value, path, bucket);
    if (bucket.length === 0) errors.push(`${path || '$'} 不得匹配 not`);
  }
  if (schema.if !== undefined) {
    const branch: string[] = [];
    collectErrors(root, schema.if as Schema, value, path, branch);
    if (branch.length === 0) {
      if (schema.then !== undefined) collectErrors(root, schema.then as Schema, value, path, errors);
    } else if (schema.else !== undefined) {
      collectErrors(root, schema.else as Schema, value, path, errors);
    }
  }

  if (typeof value === 'string') {
    // JSON Schema string lengths count Unicode code points, not UTF-16 units.
    const codePoints = [...value];
    if (typeof schema.minLength === 'number' && codePoints.length < schema.minLength) {
      errors.push(`${path || '$'} 字符串长度不足（minLength）`);
    }
    if (typeof schema.maxLength === 'number' && codePoints.length > schema.maxLength) {
      errors.push(`${path || '$'} 字符串长度超限（maxLength）`);
    }
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(value)) {
      errors.push(`${path || '$'} 不匹配 pattern`);
    }
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) errors.push(`${path || '$'} 小于 minimum`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) errors.push(`${path || '$'} 大于 maximum`);
    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) {
      errors.push(`${path || '$'} 不大于 exclusiveMinimum`);
    }
    if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) {
      errors.push(`${path || '$'} 不小于 exclusiveMaximum`);
    }
    if (typeof schema.multipleOf === 'number' && schema.multipleOf > 0) {
      const ratio = value / schema.multipleOf;
      if (Math.abs(ratio - Math.round(ratio)) > Number.EPSILON) errors.push(`${path || '$'} 不是 multipleOf`);
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errors.push(`${path || '$'} 数组项数不足`);
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      errors.push(`${path || '$'} 数组项数超限`);
    }
    if (schema.uniqueItems === true) {
      for (let index = 0; index < value.length; index += 1) {
        if (value.slice(0, index).some((item) => deepEqual(item, value[index]))) {
          errors.push(`${path || '$'} 存在重复项`);
          break;
        }
      }
    }
    if (Array.isArray(schema.prefixItems)) {
      const prefix = schema.prefixItems as Schema[];
      const limit = Math.min(prefix.length, value.length);
      for (let index = 0; index < limit; index += 1) {
        collectErrors(root, prefix[index], value[index], `${path}[${index}]`, errors);
      }
      if (value.length > prefix.length) {
        const restSchema = 'items' in schema ? (schema.items as Schema) : true;
        for (let index = prefix.length; index < value.length; index += 1) {
          collectErrors(root, restSchema, value[index], `${path}[${index}]`, errors);
        }
      }
    } else if (schema.items !== undefined) {
      for (let index = 0; index < value.length; index += 1) {
        collectErrors(root, schema.items as Schema, value[index], `${path}[${index}]`, errors);
      }
    }
    if (schema.contains !== undefined) {
      const containsErrors = value.map((item, index) => {
        const bucket: string[] = [];
        collectErrors(root, schema.contains as Schema, item, `${path}[${index}]`, bucket);
        return bucket;
      });
      const matches = containsErrors.filter((bucket) => bucket.length === 0).length;
      const minContains = typeof schema.minContains === 'number' ? schema.minContains : 1;
      if (matches < minContains) errors.push(`${path || '$'} 不满足 contains`);
      if (typeof schema.maxContains === 'number' && matches > schema.maxContains) {
        errors.push(`${path || '$'} 超过 maxContains`);
      }
    }
  }

  if (isRecord(value)) {
    const keys = Object.keys(value);
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (typeof key === 'string' && !(key in value)) errors.push(`${path || '$'} 缺少 required 字段 ${key}`);
      }
    }
    if (typeof schema.minProperties === 'number' && keys.length < schema.minProperties) {
      errors.push(`${path || '$'} 字段数不足`);
    }
    if (typeof schema.maxProperties === 'number' && keys.length > schema.maxProperties) {
      errors.push(`${path || '$'} 字段数超限`);
    }
    const properties = isRecord(schema.properties) ? schema.properties : undefined;
    const patternProperties = isRecord(schema.patternProperties) ? schema.patternProperties : undefined;
    for (const key of keys) {
      const childPath = path ? `${path}.${key}` : key;
      let matched = false;
      if (properties && key in properties) {
        matched = true;
        collectErrors(root, properties[key] as Schema, value[key], childPath, errors);
      }
      if (patternProperties) {
        for (const [pattern, entry] of Object.entries(patternProperties)) {
          if (new RegExp(pattern, 'u').test(key)) {
            matched = true;
            collectErrors(root, entry as Schema, value[key], childPath, errors);
          }
        }
      }
      if (!matched && schema.additionalProperties === false) {
        errors.push(`${childPath} 不是允许的字段`);
      } else if (!matched && isRecord(schema.additionalProperties)) {
        collectErrors(root, schema.additionalProperties as Schema, value[key], childPath, errors);
      }
    }
    if (isRecord(schema.dependentRequired)) {
      for (const [key, dependents] of Object.entries(schema.dependentRequired)) {
        if (!(key in value) || !Array.isArray(dependents)) continue;
        for (const dependent of dependents) {
          if (typeof dependent === 'string' && !(dependent in value)) {
            errors.push(`${path || '$'} 字段 ${key} 要求同时存在 ${dependent}`);
          }
        }
      }
    }
  }
};

/**
 * Draft 2020-12 assertion keywords the host intentionally does not implement.
 * Ignoring them would silently weaken author-declared constraints, so fail closed.
 * Unknown *extension* keywords remain ignored per JSON Schema.
 */
const UNSUPPORTED_STANDARD_KEYWORDS = new Set([
  'unevaluatedProperties',
  'unevaluatedItems',
  'dependentSchemas',
  'propertyNames',
  '$dynamicRef',
  '$dynamicAnchor',
]);

/** Structural schema positions to walk; instance-data keywords (const/enum/default) are skipped. */
const SCHEMA_CONTAINER_KEYWORDS = new Set([
  '$defs',
  'definitions',
  'allOf',
  'anyOf',
  'oneOf',
  'not',
  'if',
  'then',
  'else',
  'items',
  'prefixItems',
  'contains',
  'additionalProperties',
  'patternProperties',
  'properties',
  'dependentSchemas',
]);

const assertSupportedKeywords = (node: unknown): void => {
  if (typeof node === 'boolean') return;
  if (Array.isArray(node)) {
    for (const item of node) assertSupportedKeywords(item);
    return;
  }
  if (!isRecord(node)) return;
  for (const key of Object.keys(node)) {
    if (UNSUPPORTED_STANDARD_KEYWORDS.has(key)) {
      throw new Error(`JSON Schema 使用了宿主未实现的标准关键字：${key}`);
    }
  }
  for (const [key, value] of Object.entries(node)) {
    if (!SCHEMA_CONTAINER_KEYWORDS.has(key)) continue;
    assertSupportedKeywords(value);
  }
};

/**
 * CSP-safe Draft 2020-12 subset validator for Web Package generation targets.
 * Unsupported dialects and known-but-unimplemented standard assertions fail closed;
 * unknown keywords are ignored per JSON Schema.
 */
export const assertJsonSchema202012 = (schema: unknown, value: unknown): void => {
  if (!isRecord(schema) && typeof schema !== 'boolean') throw new Error('JSON Schema 必须是 object 或 boolean');
  if (isRecord(schema)) {
    const dialect = schema.$schema;
    if (typeof dialect === 'string' && dialect !== DRAFT_2020_12) {
      throw new Error(`仅支持 JSON Schema Draft 2020-12，收到：${dialect.slice(0, 120)}`);
    }
    assertSupportedKeywords(schema);
  }
  const errors: string[] = [];
  collectErrors(schema, schema as Schema, value, '', errors);
  if (errors.length > 0) throw new Error(`JSON Schema 校验失败：${errors.slice(0, 5).join('；')}`);
};
