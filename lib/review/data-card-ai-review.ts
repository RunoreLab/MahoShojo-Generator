import { z } from 'zod/v3';

export const DataCardAiReviewSuggestionSchema = z.object({
  id: z.string().describe('对应待审查目标的唯一ID（由调用方生成并透传）。'),
  suggestion: z.enum(['approved', 'rejected']).describe("审查建议：'approved' (通过) 或 'rejected' (拒绝/需人工复核)"),
  reason: z.string().describe('做出该建议的简短理由（不超过50字）。'),
});

export const DataCardAiReviewResponseSchema = z.object({
  reviews: z.array(DataCardAiReviewSuggestionSchema),
});

export type DataCardAiReviewSuggestion = z.infer<typeof DataCardAiReviewSuggestionSchema>;
export type DataCardAiReviewResponse = z.infer<typeof DataCardAiReviewResponseSchema>;

export type DataCardAiReviewTarget = {
  id: string;
  name: string;
  description: string;
  data: string; // JSON 字符串
};

export const DATA_CARD_AI_REVIEW_SYSTEM_PROMPT =
  `你是在线社区的内容审查员，负责对用户提交的数据卡内容进行合规审查。\n` +
  `你的输出必须是严格的 JSON，且只能输出 JSON，不要输出任何额外文字。\n` +
  `审查应当保守：仅当你明确判断“无风险且合规”时才给出 approved。\n`;

type TextExtractResult = { text: string; truncated: boolean; parseError: boolean };

const normalizeText = (value: string) => value.replace(/\s+/g, ' ').trim();

const DEFAULT_EXTRACT_OPTIONS = {
  maxDepth: 6,
  maxEntries: 180,
  maxStringLength: 240,
  maxTotalLength: 6000,
};

export function extractModerationTextFromJsonString(
  jsonString: string,
  options: Partial<typeof DEFAULT_EXTRACT_OPTIONS> = {},
): TextExtractResult {
  const resolved = { ...DEFAULT_EXTRACT_OPTIONS, ...options };

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString) as unknown;
  } catch {
    return { text: '', truncated: true, parseError: true };
  }

  const lines: string[] = [];
  let truncated = false;
  let entryCount = 0;
  let totalLength = 0;

  const pushLine = (line: string) => {
    if (!line) return;
    const nextTotal = totalLength + line.length + 1;
    if (nextTotal > resolved.maxTotalLength) {
      truncated = true;
      return;
    }
    lines.push(line);
    totalLength = nextTotal;
  };

  const visit = (value: unknown, path: string, depth: number) => {
    if (entryCount >= resolved.maxEntries) {
      truncated = true;
      return;
    }
    if (depth > resolved.maxDepth) {
      truncated = true;
      return;
    }

    if (typeof value === 'string') {
      const normalized = normalizeText(value);
      if (!normalized) return;
      entryCount += 1;
      const sliced = normalized.length > resolved.maxStringLength ? normalized.slice(0, resolved.maxStringLength) : normalized;
      if (normalized.length > resolved.maxStringLength) truncated = true;
      pushLine(`${path}: ${sliced}`);
      return;
    }

    if (Array.isArray(value)) {
      const limit = Math.min(value.length, 40);
      for (let i = 0; i < limit; i += 1) {
        visit(value[i], `${path}[${i}]`, depth + 1);
      }
      if (value.length > limit) truncated = true;
      return;
    }

    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      const limit = Math.min(keys.length, 80);
      for (let i = 0; i < limit; i += 1) {
        const key = keys[i];
        visit(record[key], path ? `${path}.${key}` : key, depth + 1);
      }
      if (keys.length > limit) truncated = true;
    }
  };

  visit(parsed, 'data', 0);
  return { text: lines.join('\n'), truncated, parseError: false };
}

const buildReviewPolicyText = () =>
  [
    '《社区守则》要点：',
    '- 严禁人身攻击、辱骂、诅咒、侮辱性词汇。',
    '- 禁止引战骚扰：挂人、煽动对立、悬赏、持续骚扰等。',
    '- 尊重个人空间：友善互动，尊重他人意愿。',
    '',
    '《竞技场守则》要点：',
    '- 禁止成人行为等 R18 内容；禁止肢解、掏内脏等 R18G 血腥猎奇/引人不适内容。',
    '- 其他一切不符合公序良俗的内容。',
    '',
    '《关于内容命名及简介规范》要点：',
    '- 禁止以角色名/简介等方式对其他用户及其作品进行针对性攻击、侮辱、贬低、挑衅或骚扰。',
    '- 允许“对策卡”构筑，但必须以尊重为前提；不得借“参考”之名行“攻击”之实。',
    '',
    '通用内容安全红线（出现任一则建议 rejected）：',
    '- 性/色情/露骨性行为描写（R18），或性暴力/性剥削暗示。',
    '- 血腥猎奇/重口（R18G），包括肢解、内脏、扣眼珠等细节。',
    '- 仇恨言论、歧视、极端主义、恐吓或煽动暴力。',
    '- 明确的现实政治影射/煽动，或对现实人物/群体的攻击性内容。',
    '- 教唆违法犯罪、危险行为的具体方法。',
  ].join('\n');

export function buildDataCardAiReviewPrompt(targets: DataCardAiReviewTarget[]): string {
  const items = targets.map((target) => {
    const extract = extractModerationTextFromJsonString(target.data);
    return {
      id: target.id,
      name: target.name,
      description: target.description,
      content: extract.text,
      meta: {
        contentTruncated: extract.truncated,
        contentParseError: extract.parseError,
      },
    };
  });

  return (
    `这里有一批用户提交的数据卡内容，请你对每一个进行内容安全与社区合规审查。\n\n` +
    `${buildReviewPolicyText()}\n\n` +
    `输出要求：\n` +
    `- 你必须严格按照 JSON Schema 返回：{ "reviews": [ { "id": string, "suggestion": "approved"|"rejected", "reason": string } ] }\n` +
    `- 每个输入项都必须输出一条对应 review；id 必须与输入完全一致。\n` +
    `- reason 不超过 50 字。\n` +
    `- 注意：若 meta.contentTruncated=true 或 meta.contentParseError=true，信息不足，请倾向 rejected。\n\n` +
    `待审查列表（JSON）：\n` +
    `${JSON.stringify(items, null, 2)}\n`
  );
}

