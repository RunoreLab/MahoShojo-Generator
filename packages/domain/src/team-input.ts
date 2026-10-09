import { SafeJsonValueSchema, type JsonValue } from '@mahoshojo/contracts/json-value';
import { exceedsUtf8ByteLimit, getUtf8ByteLength } from './data-card-size';
import { inferDataCardTemplate } from './data-cards';

export const MAX_TEAM_INPUT_BYTES = 1024 * 1024;
export const MAX_TEAM_MEMBERS = 32;
export const MAX_TEAM_TOTAL_BYTES = 3 * 1024 * 1024;

/** Top-level authority only; nested and unknown underscore extensions remain source data. */
const TRUST_FIELDS = new Set(['signature', 'isPreset', '_native', '_isNative', 'isNative']);
export function projectUnsignedTeamData(value: Record<string, JsonValue>): Record<string, JsonValue> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !TRUST_FIELDS.has(key)));
}

export function parseTeamInput(text: string): Record<string, unknown>[] {
  if (exceedsUtf8ByteLimit(text, MAX_TEAM_INPUT_BYTES)) throw new Error('单次 JSON 输入不能超过 1 MiB。');
  const parsed = SafeJsonValueSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error('JSON 包含不安全键、过深结构或过多节点。');
  const entries = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
  if (entries.length === 0 || entries.length > MAX_TEAM_MEMBERS) throw new Error('单次请添加 1–32 个角色。');
  return entries.map((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw new Error('每个队员必须是 JSON 对象。');
    const template = inferDataCardTemplate(entry);
    if (template === 'unknown' || template === 'scenario' || template === 'general-scenario') throw new Error('请添加本项目角色卡，不能使用情景或未知模板。');
    return entry;
  });
}

export function checkTeamBudget(data: Record<string, unknown>[]): void {
  if (data.length > MAX_TEAM_MEMBERS) throw new Error('队伍最多包含 32 个角色。');
  if (exceedsUtf8ByteLimit(JSON.stringify(data), MAX_TEAM_TOTAL_BYTES)) throw new Error('队伍源数据总量不能超过 3 MiB。');
}

export function teamMemberName(data: Record<string, unknown>): string {
  for (const key of ['codename', 'name']) {
    if (typeof data[key] === 'string' && data[key].trim()) return data[key].trim();
  }
  return '未命名角色';
}

export function checkTeamResult(data: Record<string, unknown>): void {
  if (exceedsUtf8ByteLimit(JSON.stringify(data), MAX_TEAM_TOTAL_BYTES) || !SafeJsonValueSchema.safeParse(data).success) {
    throw new Error('合并结果超过本地安全大小或结构上限，请减少队员或精简源数据。');
  }
}

/** Conservative preflight before merge allocates repeated role prefixes/JSON blocks. */
export function checkTeamCompositionBudget(members: Array<{ label: string; data: Record<string, unknown> }>): void {
  checkTeamBudget(members.map((member) => member.data));
  let budget = 0;
  for (const member of members) {
    // Covers JSON escaping and structured-to-Markdown conversion, plus per-node prefixes.
    budget += getUtf8ByteLength(JSON.stringify(member.data)) * 4;
    const prefixBytes = getUtf8ByteLength(member.label.trim() || teamMemberName(member.data)) + 32;
    const stack: unknown[] = [member.data];
    while (stack.length) {
      const value = stack.pop();
      budget += prefixBytes;
      if (budget > MAX_TEAM_TOTAL_BYTES) throw new Error('预计合并结果超过安全预算，请减少队员、缩短标识或精简源数据。');
      if (Array.isArray(value)) stack.push(...value);
      else if (typeof value === 'object' && value !== null) stack.push(...Object.values(value));
    }
  }
}
