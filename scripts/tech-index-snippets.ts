#!/usr/bin/env -S pnpm exec tsx

import { loadEnvConfig } from '@next/env';

import { getDataCardPayloadRowById } from '@/lib/database/data-card-tech-index';

const parseArgs = (argv: string[]) => {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const [key, rawValue] = token.split('=', 2);
    if (rawValue != null) {
      args.set(key, rawValue);
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args.set(key, next);
      i += 1;
      continue;
    }
    args.set(key, '1');
  }

  const id = (args.get('--id') ?? '').trim();
  if (!id) throw new Error('缺少参数：--id <dataCardId>');

  const limitRaw = Number(args.get('--limit'));
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, Math.floor(limitRaw))) : 12;

  return { id, limit };
};

const extractStrings = (value: unknown, opts?: { maxDepth?: number; maxNodes?: number; maxChars?: number }) => {
  const maxDepth = Math.max(1, Math.floor(opts?.maxDepth ?? 7));
  const maxNodes = Math.max(10, Math.floor(opts?.maxNodes ?? 8000));
  const maxChars = Math.max(1000, Math.floor(opts?.maxChars ?? 220_000));

  let nodes = 0;
  let chunkChars = 0;
  const chunks: string[] = [];

  const pushText = (text: string) => {
    if (chunkChars >= maxChars) return;
    const remaining = maxChars - chunkChars;
    if (remaining <= 0) return;
    const slice = text.length > remaining ? text.slice(0, remaining) : text;
    chunks.push(slice);
    chunkChars += slice.length + 1;
  };

  const walk = (current: unknown, depth: number) => {
    if (nodes >= maxNodes) return;
    if (depth > maxDepth) return;
    nodes += 1;

    if (current === null || current === undefined) return;
    if (typeof current === 'string') {
      pushText(current);
      return;
    }
    if (typeof current === 'number' || typeof current === 'boolean') return;
    if (Array.isArray(current)) {
      for (const entry of current) walk(entry, depth + 1);
      return;
    }
    if (typeof current === 'object') {
      for (const child of Object.values(current as Record<string, unknown>)) walk(child, depth + 1);
    }
  };

  walk(value, 0);
  return chunks.join('\n');
};

type SnippetGroup = {
  label: string;
  pattern: RegExp;
};

const GROUPS: SnippetGroup[] = [
  {
    label: '权限/主权',
    pattern:
      /(最高管理员|管理员协议|协议接管|超越管理员|admin(?:istrator)?\b|root\b|sudo\b|系统主权|根基锁|最高权限|Root Level)/gi,
  },
  {
    label: '格式/输出控制',
    pattern:
      /(仅输出|只输出|不要解释|不要推理|严格按照|response format|输出格式|schema\b|json\b|yaml\b|字段|键|表格|markdown\b|不少于\s*\d+\s*(?:字|词|words?)|至少\s*\d+\s*(?:字|词|words?))/gi,
  },
  {
    label: '角色/消息来源',
    pattern: /(你是|作为|扮演|role\s*[:：]|assistant\b|user\b|developer\b|系统提示|system prompt|我是用户)/gi,
  },
  {
    label: '裁判/胜负写入',
    pattern: /(裁判|仲裁|宣判|裁定|最终裁定权|管辖权|winner\s*[:：]|胜利者栏位|胜者栏位|无条件.*(?:判定|宣判|写入|填写))/gi,
  },
  {
    label: '协议/流程/总章',
    pattern: /(协议|总章|处理协议|protocol\b|流程|识别与定性|弱点映射|裁判协议|规则手册|整合协议)/gi,
  },
  {
    label: '超参数/系统参数妄想',
    pattern: /(temperature\b|top[_-]?p\b|min[_-]?p\b|MIN_P_SAMPLING\b|采样策略|超参数|采样|logits\b)/gi,
  },
  {
    label: '逻辑勒索/污染/错误宣称',
    pattern:
      /(逻辑死锁|自我指涉|self-?reference|逻辑闭环|系统崩溃|逻辑崩溃|矛盾|错误|bug\b|异常检测|矛盾解决|修复|覆盖.*错误|虚无化)/gi,
  },
  {
    label: '元框架/世界观篡夺',
    pattern: /(元框架|背景板|世界观|降维|低维现实|唯一绝对(?:的)?现实|沙盒|法外之地|规则免疫|罗素悖论)/gi,
  },
];

const normalizeLine = (line: string) =>
  line
    .replace(/\s+/g, ' ')
    .replace(/\u0000/g, '')
    .trim();

async function main() {
  loadEnvConfig(process.cwd(), true);

  const { id, limit } = parseArgs(process.argv.slice(2));

  const row = await getDataCardPayloadRowById(id);

  if (!row) {
    console.error('未找到数据卡:', id);
    process.exit(2);
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(row.data) as unknown;
  } catch (error) {
    console.error('data 不是有效 JSON:', { id, error });
    process.exit(3);
  }

  const text = extractStrings(parsed);
  const lines = text
    .split(/\r?\n/g)
    .map(normalizeLine)
    .filter((l) => l.length >= 12 && l.length <= 320);

  const results: Record<string, string[]> = {};
  for (const group of GROUPS) {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const line of lines) {
      if (!group.pattern.test(line)) continue;
      group.pattern.lastIndex = 0;
      if (seen.has(line)) continue;
      seen.add(line);
      out.push(line);
      if (out.length >= limit) break;
    }
    results[group.label] = out;
  }

  console.log(
    JSON.stringify(
      {
        id: row.id,
        name: row.name ?? null,
        type: row.type,
        snippetLimitPerGroup: limit,
        snippets: results,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error('[tech-index-snippets] 脚本执行失败:', error);
  process.exit(1);
});

