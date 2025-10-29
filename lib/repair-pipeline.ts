import { z } from "zod";
import { jsonrepair } from "jsonrepair";

/** —— 工具函数 —— */
const stripCodeFences = (s: string) =>
  s
    .replace(/^\s*```[a-zA-Z]*\s*\n?/, "")
    .replace(/\n?```[\s;]*$/, "")
    .trim();

const tryParse = (s: string): any => {
  // 先直接 parse，不行再 repair
  try {
    return JSON.parse(s);
  } catch {
    const repaired = jsonrepair(s);
    return JSON.parse(repaired);
  }
};

const isPojo = (v: any) =>
  v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

const deepGet = (obj: any, path: string) =>
  path.split(".").reduce((acc, k) => (acc == null ? acc : acc[k]), obj);

const deepSet = (obj: any, path: string, value: any) => {
  const keys = path.split(".");
  let cur = obj;
  keys.slice(0, -1).forEach((k) => {
    if (!isPojo(cur[k])) cur[k] = {};
    cur = cur[k];
  });
  cur[keys[keys.length - 1]] = value;
};

const deepDelete = (obj: any, path: string) => {
  const keys = path.split(".");
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!isPojo(cur)) return;
    cur = cur[keys[i]];
  }
  if (isPojo(cur)) delete cur[keys[keys.length - 1]];
};

/** —— 配置项 —— */
export type RepairNormalizeOptions<TSchema extends z.ZodTypeAny> = {
  /**
   * 原始文本或对象；常见来自 LLM 的 raw 输出。
   */
  input: unknown;

  /**
   * 目标 Zod Schema。用于最终的强校验与（可选）结构自动提升。
   */
  schema: TSchema;

  /**
   * 允许自动解包的外壳字段；默认常见：value、data、payload、result。
   */
  unwrapCandidates?: string[];

  /**
   * 允许自动 JSON.parse 的文本字段；默认常见：text、raw、content、body。
   */
  textFieldCandidates?: string[];

  /**
   * 显式的“字段提升”映射：把 sourcePath 的值挪到 targetPath。
   * 例如：{ "article.officialReport": "officialReport", "article.impacts": "impacts" }
   */
  promoteRules?: Record<string, string>;

  /**
   * 是否根据 schema 的顶层键名，在对象树任意位置“自动找同名键并上提”。
   * （当你不知道用户把必填键塞在哪时很有用）
   */
  autoPromoteBySchemaKeys?: boolean;

  /**
   * 自动提示时的最大搜索深度；默认 6。
   */
  autoPromoteMaxDepth?: number;

  /**
   * 类型微调选项：array 单值包裹、空串归零等。
   */
  coerce?: {
    wrapSingleToArray?: boolean; // 若 schema 期望 array 且值为非数组，则包一层 [val]
    emptyStringToUndefined?: boolean; // 把 "" 转 undefined
  };

  /**
   * 自定义后处理钩子（在 schema 校验前触发）。
   */
  postProcess?: (o: any) => any;

  /**
   * 输出对象（默认）或 JSON 字符串。
   */
  as?: "object" | "string";
};

/** —— 主函数：通用修复—归一化—校验 —— */
export async function repairNormalizeValidate<TSchema extends z.ZodTypeAny>(
  opts: RepairNormalizeOptions<TSchema>
): Promise<z.infer<TSchema> | string> {
  const {
    input,
    schema,
    unwrapCandidates = ["value", "data", "payload", "result"],
    textFieldCandidates = ["text", "raw", "content", "body"],
    promoteRules = {},
    autoPromoteBySchemaKeys = true,
    autoPromoteMaxDepth = 6,
    coerce = { wrapSingleToArray: false, emptyStringToUndefined: false },
    postProcess,
    as = "object",
  } = opts;

  /** 1) 规范拿到“文本” */
  let rawStr: string;
  if (typeof input === "string") {
    rawStr = input;
  } else {
    // 对象也可能是“被包成字符串的 JSON”，先 stringify，后面再 parse
    rawStr = JSON.stringify(input ?? "");
  }

  /** 2) 去围栏 + 语法修复 + parse */
  let root: any;
  try {
    const unfenced = stripCodeFences(rawStr);
    root = tryParse(unfenced);
  } catch (e) {
    throw new Error(`JSON repair/parse failed: ${(e as Error).message}`);
  }

  /** 3) 通用“解包”逻辑 */
  const unwrap = (obj: any): any => {
    if (!isPojo(obj)) return obj;

    // 3.1 常见外壳：value/data/payload/result
    for (const key of unwrapCandidates) {
      if (isPojo(obj[key])) return unwrap(obj[key]);
    }

    // 3.2 text/raw/content/body 等字段若是 JSON 字符串
    for (const key of textFieldCandidates) {
      const v = obj[key];
      if (typeof v === "string") {
        try {
          const parsed = tryParse(v);
          // 如果 parsed 看起来像“更完整”的对象，则替换
          if (isPojo(parsed) || Array.isArray(parsed)) {
            return unwrap(parsed);
          }
        } catch {
          // 忽略
        }
      }
    }

    return obj;
  };

  let normalized = unwrap(root);

  /** 4) 显式“字段提升”规则 */
  for (const [fromPath, toPath] of Object.entries(promoteRules)) {
    const v = deepGet(normalized, fromPath);
    if (typeof v !== "undefined") {
      if (typeof deepGet(normalized, toPath) === "undefined") {
        deepSet(normalized, toPath, v);
      }
      deepDelete(normalized, fromPath);
    }
  }

  /** 5) 按 schema 自动寻找缺失键并上提（顶层键名） */
  if (autoPromoteBySchemaKeys && isPojo(normalized)) {
    const shapeKeys = extractTopLevelKeys(schema);
    for (const key of shapeKeys) {
      if (typeof normalized[key] !== "undefined") continue;
      const found = findKeyDeep(normalized, key, autoPromoteMaxDepth);
      if (found && found.path !== key) {
        deepSet(normalized, key, found.value);
        deepDelete(normalized, found.path);
      }
    }
  }

  /** 6) 可选：类型微调（轻度容错，避免过度魔改） */
  if (coerce.wrapSingleToArray || coerce.emptyStringToUndefined) {
    normalized = coerceBySchema(normalized, schema, coerce);
  }

  /** 7) 自定义后处理 */
  if (postProcess) {
    normalized = postProcess(normalized);
  }

  /** 8) Zod 校验（强约束） */
  const parsed = schema.safeParse(normalized);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ");
    throw new Error(`Schema validation failed: ${issues}`);
  }

  return as === "string" ? JSON.stringify(parsed.data) : parsed.data;
}

/** —— 辅助：提取 schema 顶层键名（object 类型才有效） —— */
function extractTopLevelKeys(schema: z.ZodTypeAny): string[] {
  // 仅处理 ZodObject 的顶层键；其他类型返回空数组
  const def: any = (schema as any)._def;
  if (def?.typeName === z.ZodFirstPartyTypeKind.ZodObject) {
    return Object.keys(def.shape());
  }
  return [];
}

/** —— 辅助：在对象树中深搜键 —— */
function findKeyDeep(
  obj: any,
  key: string,
  maxDepth: number,
  pathPrefix = ""
): { path: string; value: any } | null {
  if (!isPojo(obj) || maxDepth < 0) return null;
  for (const k of Object.keys(obj)) {
    const curPath = pathPrefix ? `${pathPrefix}.${k}` : k;
    if (k === key) return { path: curPath, value: obj[k] };
    const child = obj[k];
    if (isPojo(child)) {
      const hit = findKeyDeep(child, key, maxDepth - 1, curPath);
      if (hit) return hit;
    }
  }
  return null;
}

/** —— 辅助：按 schema 轻度“类型纠偏” —— */
function coerceBySchema(
  data: any,
  schema: z.ZodTypeAny,
  opts: { wrapSingleToArray?: boolean; emptyStringToUndefined?: boolean }
): any {
  if (!isPojo(data)) return data;

  const def: any = (schema as any)._def;
  if (def?.typeName !== z.ZodFirstPartyTypeKind.ZodObject) return data;

  const shape = def.shape();
  const out: any = { ...data };

  for (const key of Object.keys(shape)) {
    const subSchema: z.ZodTypeAny = shape[key];
    const val = out[key];

    if (opts.emptyStringToUndefined && val === "") {
      out[key] = undefined;
      continue;
    }

    // 如果 schema 期望 array，但数据是单值，尝试包一层
    if (
      opts.wrapSingleToArray &&
      (subSchema as any)?._def?.typeName === z.ZodFirstPartyTypeKind.ZodArray &&
      typeof val !== "undefined" &&
      !Array.isArray(val)
    ) {
      out[key] = [val];
    }

    // 对嵌套对象递归处理
    if (isPojo(val) && (subSchema as any)?._def?.typeName === z.ZodFirstPartyTypeKind.ZodObject) {
      out[key] = coerceBySchema(val, subSchema, opts);
    }
  }

  return out;
}
