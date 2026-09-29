/**
 * Author-facing readiness hints for AI generation.
 *
 * The host states the *shape* of a data target (see ADR-web-package-target-shape-and-normalization-v1),
 * but it deliberately does not invent what the package wants the content to say.
 * That leaves one blind spot: a package can be perfectly importable and still
 * fail generation every time because it never told the model anything.
 *
 * These hints run at import time so the author finds out while they still have
 * the package open, instead of after a failed generation. They are advisory
 * only — a package with zero hints here may still be perfectly usable, and a
 * package with every hint may still work, so nothing here blocks import.
 *
 * Only data targets are checked. A `text/html` target is a self-describing
 * document, and a prose target genuinely does not need field-level guidance.
 */
import type { WebPackageManifest } from '@mahoshojo/contracts/web-package';

/**
 * A field list with no semantics is the failure mode this project hit in the
 * wild: `required: [id, text, weight, accept, reject]` passes while the package's
 * real `accept` contract (`{attr1..attr4}` deltas) is never checked.
 */
const THIN_INSTRUCTIONS_CHARS = 300;

/**
 * Measured: a 79 KiB working reference produced a 65 KiB / ~28k-token target that
 * took 5 minutes to stream. The reference size sets the output size, so an
 * oversized one buys nothing and costs generation time plus a truncation risk.
 */
const LARGE_REFERENCE_BYTES = 48 * 1024;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

/** The level whose `required`/`properties` actually constrain each generated record. */
const recordSchemaOf = (schema: unknown): Record<string, unknown> | null => {
  if (!isRecord(schema)) return null;
  if (schema.type === 'array' || schema.items !== undefined) {
    return isRecord(schema.items) ? schema.items : null;
  }
  return schema;
};

const requiredNames = (schema: unknown): readonly string[] => {
  const record = recordSchemaOf(schema);
  const required = record?.required;
  return Array.isArray(required) ? required.filter((name): name is string => typeof name === 'string') : [];
};

const declaredNames = (schema: unknown): readonly string[] => {
  const record = recordSchemaOf(schema);
  const properties = record?.properties;
  return isRecord(properties) ? Object.keys(properties) : [];
};

export const buildGenerationReadinessHints = (
  manifest: WebPackageManifest,
  read: {
    text(_path: string): string | null;
    json(_path: string): unknown;
  },
): readonly string[] => {
  if (manifest.generation.mediaType !== 'application/json') return [];
  const hints: string[] = [];

  const instructionsPath = manifest.generation.instructions;
  const instructions = instructionsPath ? read.text(instructionsPath)?.trim() ?? '' : '';
  if (!instructionsPath) {
    hints.push(
      '生成可行性：目标文件是 JSON 数据文件，但没有 generation.instructions。'
      + '宿主只知道"这必须是一份 JSON"，无法知道这些数据该表达什么——AI 很可能输出一个结构正确但内容无关的对象。',
    );
  } else if (instructions.length < THIN_INSTRUCTIONS_CHARS) {
    hints.push(
      `生成可行性：generation.instructions 只有 ${instructions.length} 字符，接近一份字段名清单。`
      + '请补写每个字段的语义、取值范围与一个完整记录示例，否则 AI 只能猜。',
    );
  }

  const schemaPath = manifest.generation.schema;
  const schema = schemaPath === undefined ? undefined : read.json(schemaPath);
  if (schemaPath === undefined || schema === undefined) {
    hints.push(
      '生成可行性：没有 generation.schema，宿主无法把 AI 的输出与这个包的结构对齐，生成会更容易失败。',
    );
  } else {
    const required = requiredNames(schema);
    const declared = declaredNames(schema);
    if (required.length === 0) {
      hints.push(
        '生成可行性：generation.schema 没有 required 约束，任何结构都会通过校验，'
        + '包括 AI 漏掉关键字段的情况。请在记录层补上 required。',
      );
    }
    if (declared.length === 0) {
      // 真实第三方包的典型写法：只列 required，不写 properties。结果是子对象的
      // 结构完全不受约束——AI 把 accept 写成"下一个事件"也能通过校验。
      hints.push(
        '生成可行性：generation.schema 只声明了必填字段名，没有 properties，'
        + '因此无法约束任何字段的结构和取值范围。校验通过不代表内容对引擎有意义：'
        + '请为每个字段补上 properties，并把子对象与数组的结构写进 schema。',
      );
    } else if (declared.length > 1 && required.length * 2 < declared.length) {
      hints.push(
        `生成可行性：generation.schema 声明了 ${declared.length} 个字段但只把 ${required.length} 个列入 required。`
        + '校验通过不代表内容对引擎有意义，请确认嵌套结构（子对象、数组、取值范围）都被约束。',
      );
    }
  }

  const examplePath = manifest.generation.example;
  if (!examplePath) {
    hints.push(
      '生成可行性：没有 generation.example。宿主不会自动拿包自带的默认目标文件当示例，'
      + '补一份 3–5 条的小样本（或一份可运行的参考实现）是提升一次生成成功率最直接的办法。',
    );
  } else {
    const example = read.text(examplePath) ?? '';
    const bytes = new TextEncoder().encode(example).byteLength;
    if (bytes > LARGE_REFERENCE_BYTES) {
      hints.push(
        `生成可行性：generation.example 有 ${Math.round(bytes / 1024)} KiB，偏大。`
        + '范例有多长，目标文件通常就要产出多长——实测 79 KiB 的参考实现产出了 65 KiB、约 2.8 万 token，'
        + '单次生成跑了 5 分钟。请把范例精简到"仍可运行、但不含可删的样式与内容"的最小形态，'
        + '否则容易撞上输出上限或等待超时。',
      );
    }
  }

  return hints;
};
