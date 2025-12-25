export type PvpWinnerCandidate = {
  token: string; // P1/P2/...
  name: string;  // 参战角色名（用于兜底匹配）
};

export type PvpWinnerParseResult =
  | { kind: 'draw'; source: string; raw: string | null }
  | { kind: 'index'; source: string; raw: string; index: number }
  | { kind: 'invalid'; source: string; raw: string | null; matchedTokens: string[]; matchedNameIndexes: number[] };

const stripWinnerText = (text: string): string => {
  return text
    .trim()
    // 注意：不要把小括号剥离掉（PVP 流式胜者行可能用 “角色名（P1）” 表示 token）
    .replace(/^[\s"'“”‘’【】\[\]<>《》]+/g, '')
    .replace(/[\s"'“”‘’【】\[\]<>《》]+$/g, '')
    .trim();
};

const stripMarkdownDecorations = (text: string): string => {
  // 仅用于“winner 一行”的轻量清理，避免误伤正文内容
  return text
    .replace(/^[>\-\*\+\s]+/g, '')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const isDrawText = (raw: string): boolean => {
  const s = raw.trim();
  if (!s) return false;
  const lowered = s.toLowerCase();
  return (
    s.includes('平局') ||
    s.includes('平手') ||
    s.includes('打平') ||
    lowered === 'draw' ||
    lowered === 'tie' ||
    lowered === 'tied'
  );
};

const extractWinnerTokens = (raw: string): string[] => {
  const hits = Array.from(raw.matchAll(/\bP(\d{1,2})\b/gi))
    .map((m) => `P${m[1]}`)
    .filter(Boolean);
  return Array.from(new Set(hits));
};

export const extractWinnerLineFromMarkdown = (markdown: string): string | null => {
  if (typeof markdown !== 'string' || !markdown.trim()) return null;
  const lines = markdown.split(/\r?\n/);
  const findIndex = lines.findIndex((line) => /^##\s*胜利者(?:\s|$)/.test(line.trim()));
  if (findIndex < 0) return null;
  for (let i = findIndex + 1; i < lines.length; i++) {
    const raw = (lines[i] ?? '').trim();
    if (!raw) continue;
    if (/^#{1,6}\s+/.test(raw)) return null;
    return stripWinnerText(stripMarkdownDecorations(raw)).slice(0, 120) || null;
  }
  return null;
};

export const parsePvpWinnerFromText = (params: {
  raw: string | null | undefined;
  candidates: PvpWinnerCandidate[];
  source: string;
}): PvpWinnerParseResult => {
  const raw = typeof params.raw === 'string' ? params.raw : null;
  if (!raw || !raw.trim()) {
    return { kind: 'invalid', source: params.source, raw: raw ?? null, matchedTokens: [], matchedNameIndexes: [] };
  }

  if (isDrawText(raw)) {
    return { kind: 'draw', source: params.source, raw: raw.trim().slice(0, 120) };
  }

  const candidates = Array.isArray(params.candidates) ? params.candidates : [];
  const tokenToIndex = new Map<string, number>();
  const nameToIndexes = new Map<string, number[]>();
  for (let i = 0; i < candidates.length; i++) {
    const token = typeof candidates[i]?.token === 'string' ? candidates[i]!.token.trim() : '';
    const name = typeof candidates[i]?.name === 'string' ? candidates[i]!.name.trim() : '';
    if (token) tokenToIndex.set(token, i);
    if (name) nameToIndexes.set(name, [...(nameToIndexes.get(name) ?? []), i]);
  }

  const stripped = stripWinnerText(stripMarkdownDecorations(raw));

  // 1) token 精确/提取匹配：优先级最高（可处理 “xxx（P1）” / “P2” 等）
  const tokens = extractWinnerTokens(stripped);
  const matchedTokens = tokens.filter((t) => tokenToIndex.has(t));
  if (matchedTokens.length === 1) {
    return { kind: 'index', source: params.source, raw: stripped, index: tokenToIndex.get(matchedTokens[0]!)! };
  }
  if (matchedTokens.length > 1) {
    return { kind: 'invalid', source: params.source, raw: stripped, matchedTokens, matchedNameIndexes: [] };
  }

  // 2) 角色名精确匹配（要求名称唯一）
  const exactIndexes = nameToIndexes.get(stripped) ?? null;
  if (exactIndexes && exactIndexes.length === 1) {
    return { kind: 'index', source: params.source, raw: stripped, index: exactIndexes[0]! };
  }

  // 3) 角色名包含式匹配（要求仅命中一个候选，并且名称唯一）
  const matchedNameIndexes = candidates
    .map((c, index) => {
      const name = typeof c?.name === 'string' ? c.name.trim() : '';
      if (!name) return -1;
      if (!raw.includes(name)) return -1;
      const indexes = nameToIndexes.get(name) ?? [];
      return indexes.length === 1 ? index : -1;
    })
    .filter((i) => i >= 0);

  const uniqueMatched = Array.from(new Set(matchedNameIndexes));
  if (uniqueMatched.length === 1) {
    return { kind: 'index', source: params.source, raw: stripped, index: uniqueMatched[0]! };
  }

  return {
    kind: 'invalid',
    source: params.source,
    raw: stripped,
    matchedTokens: [],
    matchedNameIndexes: uniqueMatched,
  };
};
