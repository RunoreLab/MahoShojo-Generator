import phrasesConfigRaw from '@/config/pvp-chat-phrases.json';
import emotesConfigRaw from '@/config/pvp-chat-emotes.json';

type PhraseOption = { id: string; text: string };
type PhraseSlot = { key: string; label: string; optionsKey: string };
type PhrasePattern = { id: string; label: string; template: string; slots: PhraseSlot[] };

export type PvpChatPhrasesConfig = {
  version: number;
  patterns: PhrasePattern[];
  options: Record<string, PhraseOption[]>;
};

export type PvpChatEmotesConfig = {
  version: number;
  items: { id: string; label: string; src: string }[];
};

export type PvpChatPhraseSelection = {
  patternId: string;
  selections: Record<string, string>;
};

export type PvpChatSendBody = {
  phrase?: PvpChatPhraseSelection | null;
  stickerId?: string | null;
  emoji?: string | null;
};

export type PvpChatNormalizedMessage = {
  phrase: PvpChatPhraseSelection | null;
  stickerId: string | null;
  emoji: string | null;
  renderedText: string | null;
  contentJson: string;
};

const asSafeNumber = (value: unknown, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const asTrimmedString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const sanitizePhraseOption = (value: any): PhraseOption | null => {
  if (!value || typeof value !== 'object') return null;
  const id = asTrimmedString(value.id);
  const text = typeof value.text === 'string' ? value.text : '';
  if (!id) return null;
  const safeText = text.trim().slice(0, 64);
  if (!safeText) return null;
  return { id, text: safeText };
};

const sanitizePhraseSlot = (value: any): PhraseSlot | null => {
  if (!value || typeof value !== 'object') return null;
  const key = asTrimmedString(value.key);
  const label = typeof value.label === 'string' ? value.label.trim().slice(0, 32) : '';
  const optionsKey = asTrimmedString(value.optionsKey);
  if (!key || !optionsKey) return null;
  return { key, label: label || key, optionsKey };
};

const sanitizePhrasePattern = (value: any): PhrasePattern | null => {
  if (!value || typeof value !== 'object') return null;
  const id = asTrimmedString(value.id);
  const label = typeof value.label === 'string' ? value.label.trim().slice(0, 32) : '';
  const template = typeof value.template === 'string' ? value.template.trim().slice(0, 128) : '';
  const slotsRaw = Array.isArray(value.slots) ? value.slots : [];
  const slots = slotsRaw.map(sanitizePhraseSlot).filter(Boolean) as PhraseSlot[];
  if (!id || !template || slots.length === 0) return null;
  return { id, label: label || id, template, slots };
};

export const getPvpChatPhrasesConfig = (): PvpChatPhrasesConfig => {
  const raw: any = phrasesConfigRaw as any;
  const version = asSafeNumber(raw?.version, 1);
  const patterns = (Array.isArray(raw?.patterns) ? raw.patterns : []).map(sanitizePhrasePattern).filter(Boolean) as PhrasePattern[];
  const optionsRaw = raw?.options && typeof raw.options === 'object' ? raw.options : {};
  const options: Record<string, PhraseOption[]> = {};
  for (const [k, v] of Object.entries(optionsRaw as Record<string, unknown>)) {
    const key = asTrimmedString(k);
    if (!key) continue;
    const list = Array.isArray(v) ? (v as any[]).map(sanitizePhraseOption).filter(Boolean) : [];
    if (list.length > 0) options[key] = list as PhraseOption[];
  }
  return { version, patterns, options };
};

export const getPvpChatEmotesConfig = (): PvpChatEmotesConfig => {
  const raw: any = emotesConfigRaw as any;
  const version = asSafeNumber(raw?.version, 1);
  const itemsRaw = Array.isArray(raw?.items) ? raw.items : [];
  const items = itemsRaw
    .map((it: any) => {
      if (!it || typeof it !== 'object') return null;
      const id = asTrimmedString(it.id);
      const label = typeof it.label === 'string' ? it.label.trim().slice(0, 32) : '';
      const src = typeof it.src === 'string' ? it.src.trim() : '';
      if (!id || !src.startsWith('/')) return null;
      return { id, label: label || id, src };
    })
    .filter(Boolean) as { id: string; label: string; src: string }[];
  return { version, items };
};

const PHRASES = getPvpChatPhrasesConfig();
const EMOTES = getPvpChatEmotesConfig();

const buildOptionsIndex = (): Record<string, Map<string, PhraseOption>> => {
  const idx: Record<string, Map<string, PhraseOption>> = {};
  for (const [k, list] of Object.entries(PHRASES.options)) {
    idx[k] = new Map(list.map((o) => [o.id, o]));
  }
  return idx;
};

const OPTIONS_INDEX = buildOptionsIndex();
const PATTERN_INDEX = new Map(PHRASES.patterns.map((p) => [p.id, p]));
const EMOTE_IDS = new Set(EMOTES.items.map((e) => e.id));

const renderTemplate = (template: string, values: Record<string, string>): string | null => {
  const rendered = template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = values[key];
    return typeof v === 'string' ? v : '';
  });
  if (!rendered.trim()) return null;
  if (/\{\w+\}/.test(rendered)) return null;
  return rendered;
};

export const renderPvpChatPhrase = (selection: PvpChatPhraseSelection): string | null => {
  const pattern = PATTERN_INDEX.get(selection.patternId);
  if (!pattern) return null;
  const selections = selection.selections && typeof selection.selections === 'object' ? selection.selections : {};
  const values: Record<string, string> = {};
  for (const slot of pattern.slots) {
    const chosenId = asTrimmedString((selections as any)[slot.key]);
    if (!chosenId) return null;
    const optionsMap = OPTIONS_INDEX[slot.optionsKey];
    if (!optionsMap) return null;
    const option = optionsMap.get(chosenId);
    if (!option) return null;
    values[slot.key] = option.text;
  }
  const rendered = renderTemplate(pattern.template, values);
  if (!rendered) return null;
  return rendered.trim().slice(0, 120);
};

const stripAllowedEmojiJoiners = (raw: string): string =>
  raw
    .replace(/\uFE0F/g, '') // VS16
    .replace(/\uFE0E/g, '') // VS15
    .replace(/\u200D/g, '') // ZWJ
    .replace(/[\u{1F3FB}-\u{1F3FF}]/gu, ''); // 肤色修饰

export const isSafeEmojiString = (raw: string): boolean => {
  const s = raw.trim();
  if (!s) return false;
  if (s.length > 24) return false;
  const stripped = stripAllowedEmojiJoiners(s);
  if (!stripped) return false;
  return /^[\p{Extended_Pictographic}\s]+$/u.test(stripped);
};

export const normalizePvpChatSendBody = (raw: unknown): PvpChatSendBody => {
  if (!raw || typeof raw !== 'object') return {};
  const obj: any = raw as any;

  const phraseRaw = obj.phrase;
  let phrase: PvpChatPhraseSelection | null = null;
  if (phraseRaw && typeof phraseRaw === 'object') {
    const patternId = asTrimmedString((phraseRaw as any).patternId);
    const selectionsRaw = (phraseRaw as any).selections;
    const selections: Record<string, string> = {};
    if (selectionsRaw && typeof selectionsRaw === 'object') {
      for (const [k, v] of Object.entries(selectionsRaw as Record<string, unknown>)) {
        const key = asTrimmedString(k);
        const value = asTrimmedString(v);
        if (key && value) selections[key] = value;
      }
    }
    if (patternId && Object.keys(selections).length > 0) {
      phrase = { patternId, selections };
    }
  }

  const stickerId = asTrimmedString(obj.stickerId) || null;
  const emoji = asTrimmedString(obj.emoji) || null;

  return { phrase, stickerId, emoji };
};

export const validateAndBuildPvpChatMessage = (body: PvpChatSendBody): { ok: true; value: PvpChatNormalizedMessage } | { ok: false; error: string; code: string } => {
  const phrase = body.phrase ?? null;
  const stickerId = body.stickerId ? body.stickerId.trim() : '';
  const emoji = body.emoji ? body.emoji.trim() : '';

  const renderedText = phrase ? renderPvpChatPhrase(phrase) : null;
  if (phrase && !renderedText) {
    return { ok: false, error: '文字组合不合法，请重新选择', code: 'INVALID_PHRASE' };
  }

  const normalizedSticker = stickerId ? (EMOTE_IDS.has(stickerId) ? stickerId : null) : null;
  if (stickerId && !normalizedSticker) {
    return { ok: false, error: '表情包不合法', code: 'INVALID_STICKER' };
  }

  const normalizedEmoji = emoji ? (isSafeEmojiString(emoji) ? emoji : null) : null;
  if (emoji && !normalizedEmoji) {
    return { ok: false, error: '仅允许发送通用表情符号（emoji）', code: 'INVALID_EMOJI' };
  }

  if (!renderedText && !normalizedSticker && !normalizedEmoji) {
    return { ok: false, error: '请至少选择一条文字组合或一个表情', code: 'EMPTY_MESSAGE' };
  }

  const content: any = {
    v: 1,
    phrasesVersion: PHRASES.version,
    emotesVersion: EMOTES.version,
    phrase: phrase ? { patternId: phrase.patternId, selections: phrase.selections } : null,
    stickerId: normalizedSticker,
    emoji: normalizedEmoji,
    renderedText,
  };

  return {
    ok: true,
    value: {
      phrase,
      stickerId: normalizedSticker,
      emoji: normalizedEmoji,
      renderedText,
      contentJson: JSON.stringify(content),
    },
  };
};

