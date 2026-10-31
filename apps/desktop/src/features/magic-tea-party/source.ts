import { SafeJsonValueSchema } from '@mahoshojo/contracts/json-value';
import { MAX_DESKTOP_LOCAL_CARD_DOCUMENT_BYTES } from '@mahoshojo/contracts/desktop-ipc';
import { exceedsUtf8ByteLimit } from '@mahoshojo/domain/data-card-size';
import { inferDataCardTemplate, type DataCardTemplate } from '@mahoshojo/domain/data-cards';
import { CanshouSchema, MagicalGirlSchema, parseDataCardByTemplate } from '@mahoshojo/domain/data-card-schemas';
import { convertTavernToGeneralCard, isLikelyTavernCard, type TavernCardCandidate } from '@mahoshojo/domain/tavern-card';
import type { MagicTeaPartyRole, MagicTeaPartyScenario } from '@mahoshojo/domain/magic-tea-party/types';

type Card = Record<string, unknown>;
const error = (message: string): never => { throw new Error(message); };
const isRecord = (value: unknown): value is Card => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const invalidCard = () => error('数据卡的已知字段格式不正确，请保留原件并检查后重试。');

// Native UTF-8 cannot preserve isolated UTF-16 surrogates. Reject rather than silently replace them.
const checkUnicode = (value: unknown): void => {
  const pending = [value];
  while (pending.length) {
    const next = pending.pop();
    if (typeof next === 'string' && /[\uD800-\uDFFF]/u.test(next)) error('数据卡包含不完整的 Unicode 字符，请修复原件后重试。');
    if (next && typeof next === 'object') for (const [key, child] of Object.entries(next)) {
      if (/[\uD800-\uDFFF]/u.test(key)) error('数据卡包含不完整的 Unicode 字符，请修复原件后重试。');
      pending.push(child);
    }
  }
};

/** Accept card payloads, including LocalCardRecordV1.data, never a guessed document/data envelope. */
const parseCards = (text: string): Card[] => {
  if (exceedsUtf8ByteLimit(text, MAX_DESKTOP_LOCAL_CARD_DOCUMENT_BYTES)) error('导入内容超过本地数据卡的 4 MiB 上限。');
  let value: unknown;
  try { value = JSON.parse(text); } catch { return error('内容不是合法的 JSON，请选择角色或情景卡 JSON 文件。'); }
  if (!SafeJsonValueSchema.safeParse(value).success) error('数据卡包含不安全的字段或过深、过大的 JSON 结构。');
  checkUnicode(value);
  const cards = Array.isArray(value) ? value : [value];
  if (!cards.length || cards.some(card => !isRecord(card))) error('请提供单张数据卡对象或非空的数据卡数组。');
  return cards as Card[];
};

const knownFields = {
  'magical-girl': Object.keys(MagicalGirlSchema.innerType().shape),
  canshou: Object.keys(CanshouSchema.innerType().shape),
};

const validatedCard = (original: Card, template: Exclude<DataCardTemplate, 'scenario' | 'general-scenario'>): Card => {
  // Validate the shared known schema, but keep the original nested objects instead of Zod's
  // stripping/defaulted output. Unknown extensions are data, not new runtime options.
  const card = { ...original };
  const keys = template === 'magical-girl' || template === 'canshou' ? knownFields[template] : null;
  const validation = keys ? Object.fromEntries(keys.filter(key => Object.hasOwn(card, key)).map(key => [key, card[key]])) : card;
  try { parseDataCardByTemplate(template, validation); } catch { return invalidCard(); }
  return card;
};

const allocateIds = (count: number, createId: () => string): string[] => {
  const ids: string[] = [];
  for (let index = 0; index < count; index++) {
    const id = createId();
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(id) || ids.includes(id)) error('无法分配唯一有效的茶会角色或情景 ID，请重试。');
    ids.push(id);
  }
  return ids;
};

export const parseDesktopTeaRoles = (text: string, createId: () => string): MagicTeaPartyRole[] => {
  const prepared = parseCards(text).map(original => {
    const template = inferDataCardTemplate({ ...original });
    const nativeCharacter = template === 'magical-girl' || template === 'canshou'
      || original.templateId === '通用角色' || (template === 'general' && typeof original.content === 'string');
    if (!nativeCharacter && isLikelyTavernCard(original)) {
      const candidate: TavernCardCandidate = { keyword: 'json', chunkType: 'tEXt', parseMethod: 'json', parsed: original };
      let card: ReturnType<typeof convertTavernToGeneralCard>;
      try { card = convertTavernToGeneralCard(candidate); } catch { return invalidCard(); }
      return { name: card.name, template: 'general' as const, templateId: card.templateId, source: 'tavern' as const, isNative: false, card };
    }
    if (template !== 'magical-girl' && template !== 'canshou' && template !== 'general') return error('未识别到角色卡，请使用角色卡 JSON；情景卡应从情景入口导入。');
    const card = validatedCard(original, template);
    const name = String(template === 'magical-girl' ? card.codename : card.name).trim();
    if (!name) return invalidCard();
    return {
      name, template, ...(typeof card.templateId === 'string' ? { templateId: card.templateId } : {}),
      source: 'local' as const, isNative: false, card,
    };
  });
  const ids = allocateIds(prepared.length, createId);
  return prepared.map((role, index) => ({ id: ids[index], ...role }));
};

export const parseDesktopTeaScenarios = (text: string, createId: () => string): MagicTeaPartyScenario[] => {
  const prepared = parseCards(text).map(original => {
    const template = inferDataCardTemplate({ ...original });
    if (template !== 'scenario' && template !== 'general-scenario') return error('未识别到情景卡，请使用结构化情景或通用情景 JSON。');
    // Tea consumes the same identifiable scenario payloads as Web. The editor schema
    // describes new structured cards, not every historical shape used as prompt data.
    const card = { ...original };
    if (template === 'general-scenario' && typeof card.title !== 'string' && typeof card.name === 'string') card.title = card.name;
    const title = String(card.title).trim();
    if (!title) return invalidCard();
    return { title, ...(typeof card.templateId === 'string' ? { templateId: card.templateId } : {}), source: 'local' as const, isNative: false, card };
  });
  const ids = allocateIds(prepared.length, createId);
  return prepared.map((scenario, index) => ({ id: ids[index], ...scenario }));
};
