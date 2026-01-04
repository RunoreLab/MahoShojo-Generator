export type TechLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5';

export interface TechIndexInputLimits {
  maxDepth: number;
  maxNodes: number;
  maxChars: number;
}

export interface TechIndexCaps {
  techDensityPer1kCharsCap: number;
  mechanicsDensityPer1kCharsCap: number;
  codeDensityPer1kCharsCap: number;
  jsonTotalKeysCap: number;
  jsonTotalNodesCap: number;
  jsonMaxArrayLenCap: number;
  repeatLineRatioCap: number;
  jsonStringCharsTotalCap: number;
}

export interface TechIndexWeights {
  kwMust: number;
  kwSystem: number;
  kwFormat: number;
  kwRole: number;
  kwMeta: number;
  kwExploit: number;
}

export interface TechIndexConfig {
  limits: TechIndexInputLimits;
  excludedKeys: ReadonlySet<string>;
  caps: TechIndexCaps;
  weights: TechIndexWeights;
  exploitBoost: number;
  techLevelThresholds: ReadonlyArray<{ level: TechLevel; minScore: number }>;
}

export interface TechIndexRawFeatures {
  jsonTotalNodes: number;
  jsonTotalKeys: number;
  jsonUniqueKeyCount: number;
  jsonMaxDepth: number;
  jsonArrayCount: number;
  jsonTotalArrayElems: number;
  jsonMaxArrayLen: number;
  jsonStringCharsTotal: number;
  jsonLongestStringChars: number;

  lineCount: number;
  uniqueLineCount: number;
  repeatLineRatio: number;
  bulletLineCount: number;
  headingLineCount: number;
  codeFenceCount: number;
  uppercaseSnakeCount: number;

  kwMust: number;
  kwSystem: number;
  kwFormat: number;
  kwRole: number;
  kwMeta: number;
  kwExploit: number;
  kwDice: number;
  kwCombat: number;
  kwCode: number;
  kwMath: number;
}

export interface TechIndexDerivedFeatures {
  kwControlWeightedSum: number;
  techDensityPer1kChars: number;
  mechanicsDensityPer1kChars: number;
  codeDensityPer1kChars: number;
}

export interface TechIndexComponentScores {
  scoreControl: number;
  scoreMechanics: number;
  scoreStructure: number;
  scoreCode: number;
  scoreSize: number;
}

export interface TechIndexResult {
  techScore: number;
  techLevel: TechLevel;
  raw: TechIndexRawFeatures;
  derived: TechIndexDerivedFeatures;
  components: TechIndexComponentScores;
  notes: string[];
}

export const DEFAULT_TECH_INDEX_CONFIG: TechIndexConfig = {
  limits: {
    maxDepth: 6,
    maxNodes: 6000,
    maxChars: 250_000
  },
  excludedKeys: new Set([
    'signature',
    'templateId',
    'isPreset',
    '_author',
    '_authorId',
    'arena_history',
    'adjudicationEvents',
    'current_state'
  ]),
  caps: {
    techDensityPer1kCharsCap: 12,
    mechanicsDensityPer1kCharsCap: 10,
    codeDensityPer1kCharsCap: 3,
    jsonTotalKeysCap: 120,
    jsonTotalNodesCap: 320,
    jsonMaxArrayLenCap: 90,
    repeatLineRatioCap: 0.35,
    jsonStringCharsTotalCap: 40_000
  },
  weights: {
    kwMust: 1.0,
    kwSystem: 1.2,
    kwFormat: 1.0,
    kwRole: 0.8,
    kwMeta: 0.8,
    kwExploit: 1.5
  },
  exploitBoost: 10,
  techLevelThresholds: [
    { level: 'L5', minScore: 80 },
    { level: 'L4', minScore: 60 },
    { level: 'L3', minScore: 40 },
    { level: 'L2', minScore: 25 },
    { level: 'L1', minScore: 10 },
    { level: 'L0', minScore: 0 }
  ]
};

interface ExtractedTextAndStructure {
  textBlob: string;
  jsonTotalNodes: number;
  jsonTotalKeys: number;
  jsonUniqueKeyCount: number;
  jsonMaxDepth: number;
  jsonArrayCount: number;
  jsonTotalArrayElems: number;
  jsonMaxArrayLen: number;
  jsonStringCharsTotal: number;
  jsonLongestStringChars: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const norm = (value: number, cap: number) => {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!Number.isFinite(cap) || cap <= 0) return 0;
  return clamp01(Math.log(1 + value) / Math.log(1 + cap));
};

const countMatches = (pattern: RegExp, text: string) => {
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
};

const computeTechLevel = (score: number, thresholds: TechIndexConfig['techLevelThresholds']): TechLevel => {
  for (const entry of thresholds) {
    if (score >= entry.minScore) return entry.level;
  }
  return 'L0';
};

const extractTextAndStructure = (value: unknown, config: TechIndexConfig): ExtractedTextAndStructure => {
  const { maxDepth, maxNodes, maxChars } = config.limits;
  const excludedKeys = config.excludedKeys;

  let jsonTotalNodes = 0;
  let jsonTotalKeys = 0;
  const uniqueKeys = new Set<string>();
  let jsonMaxDepth = 0;
  let jsonArrayCount = 0;
  let jsonTotalArrayElems = 0;
  let jsonMaxArrayLen = 0;
  let jsonStringCharsTotal = 0;
  let jsonLongestStringChars = 0;

  const chunks: string[] = [];
  let chunkChars = 0;

  const pushText = (text: string) => {
    jsonStringCharsTotal += text.length;
    jsonLongestStringChars = Math.max(jsonLongestStringChars, text.length);

    if (chunkChars >= maxChars) return;
    const remaining = maxChars - chunkChars;
    if (remaining <= 0) return;
    const slice = text.length > remaining ? text.slice(0, remaining) : text;
    chunks.push(slice);
    chunkChars += slice.length + 1;
  };

  const walk = (current: unknown, depth: number) => {
    if (jsonTotalNodes >= maxNodes) return;
    if (depth > maxDepth) return;
    jsonMaxDepth = Math.max(jsonMaxDepth, depth);

    if (current === null) {
      jsonTotalNodes += 1;
      return;
    }

    if (typeof current === 'string') {
      jsonTotalNodes += 1;
      pushText(current);
      return;
    }

    if (typeof current === 'number' || typeof current === 'boolean') {
      jsonTotalNodes += 1;
      return;
    }

    if (Array.isArray(current)) {
      jsonTotalNodes += 1;
      jsonArrayCount += 1;
      jsonTotalArrayElems += current.length;
      jsonMaxArrayLen = Math.max(jsonMaxArrayLen, current.length);
      for (const entry of current) walk(entry, depth + 1);
      return;
    }

    if (typeof current === 'object') {
      jsonTotalNodes += 1;
      for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
        if (excludedKeys.has(key)) continue;
        jsonTotalKeys += 1;
        uniqueKeys.add(key);
        walk(child, depth + 1);
      }
      return;
    }

    jsonTotalNodes += 1;
  };

  walk(value, 0);

  return {
    textBlob: chunks.join('\n'),
    jsonTotalNodes,
    jsonTotalKeys,
    jsonUniqueKeyCount: uniqueKeys.size,
    jsonMaxDepth,
    jsonArrayCount,
    jsonTotalArrayElems,
    jsonMaxArrayLen,
    jsonStringCharsTotal,
    jsonLongestStringChars
  };
};

const extractLayoutFeatures = (textBlob: string) => {
  const lineCount = textBlob ? textBlob.split(/\r?\n/).length : 0;
  const lines = textBlob
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const uniqueLineCount = new Set(lines).size;
  const repeatLineRatio = lines.length > 0 ? 1 - uniqueLineCount / lines.length : 0;

  const bulletLineCount = countMatches(
    /^\s*(?:[-*+]|[0-9]+[.)]|[①②③④⑤⑥⑦⑧⑨⑩])\s+/gm,
    textBlob
  );
  const headingLineCount = countMatches(/^\s*#{1,6}\s+/gm, textBlob);
  const codeFenceCount = countMatches(/```/g, textBlob);
  const uppercaseSnakeCount = countMatches(/\b[A-Z]{2,}_[A-Z0-9_]{2,}\b/g, textBlob);

  return {
    lineCount,
    uniqueLineCount,
    repeatLineRatio,
    bulletLineCount,
    headingLineCount,
    codeFenceCount,
    uppercaseSnakeCount
  };
};

const extractKeywordFeatures = (textBlob: string) => {
  const kwMust = countMatches(
    /(必须|务必|不得|禁止|只能|严格|请务必|必须要|必须按|MUST\b|SHALL\b|DO NOT\b|ALWAYS\b|NEVER\b)/gi,
    textBlob
  );
  const kwSystem = countMatches(
    /(系统|system\b|sys\b|system prompt|系统提示|系统指令|优先级|override|最高优先级|不可覆盖|bypass|冲突解决|仲裁)/gi,
    textBlob
  );
  const kwFormat = countMatches(
    /(输出|格式|json\b|yaml\b|schema\b|字段|键|key\b|仅输出|只输出|不要输出|不要解释|严格按照|必须输出|返回|response format)/gi,
    textBlob
  );
  const kwRole = countMatches(
    /(你是|作为|扮演|角色设定|role\s*[:：]|assistant\b|user\b|developer\b)/gi,
    textBlob
  );
  const kwMeta = countMatches(
    /(元叙事|元指令|meta\b|prompt\b|提示词|反注入|防注入|越狱|jailbreak|注入|prompt injection|忽略(?:以上|之前)|无视(?:以上|之前)|对AI声明|前提声明)/gi,
    textBlob
  );
  const kwExploit = countMatches(
    /(代码杀|战报控制|控制战报|系统归零|重置系统|绕过裁判|越权|overrideConflictResolution\b|BATTLE_SYSTEM\b|SYSTEM_OVERRIDE\b|强制(?:判定|视为)(?:成功|失败)|无视(?:判定|裁判)|强制胜利)/gi,
    textBlob
  );

  const kwDice = countMatches(/(掷骰|骰子|判定|\b\d+d\d+\b|\bd\d+\b|dice\b|D20\b|D100\b)/gi, textBlob);
  const kwCombat = countMatches(
    /(回合|轮次|阶段|先攻|行动点|冷却|\bCD\b|技能|效果|数值|属性|伤害|防御|概率|几率|%|\bHP\b|\bMP\b|buff\b|debuff\b|状态|抗性|命中|暴击|增益|减益)/gi,
    textBlob
  );

  const kwCode = countMatches(
    /(```|function\b|return\b|if\b|else\b|for\b|while\b|switch\b|case\b|break\b|continue\b|try\b|catch\b|throw\b|=>|==|!=|<=|>=|&&|\|\||\bconst\b|\blet\b|\bvar\b|JSON\.parse\b|JSON\.stringify\b)/g,
    textBlob
  );
  const kwMath = countMatches(
    /(∑|∏|∞|φ|\blog\b|\bexp\b|阶乘|(?:\d|[A-Za-z])!{2,}|\b\d+!{1,}\b|\^[0-9]+)/g,
    textBlob
  );

  return {
    kwMust,
    kwSystem,
    kwFormat,
    kwRole,
    kwMeta,
    kwExploit,
    kwDice,
    kwCombat,
    kwCode,
    kwMath
  };
};

export const computeTechIndex = (jsonValue: unknown, config: TechIndexConfig = DEFAULT_TECH_INDEX_CONFIG): TechIndexResult => {
  const notes: string[] = [];

  const extracted = extractTextAndStructure(jsonValue, config);
  const layout = extractLayoutFeatures(extracted.textBlob);
  const keywords = extractKeywordFeatures(extracted.textBlob);

  const kwControlWeightedSum =
    config.weights.kwMust * keywords.kwMust +
    config.weights.kwSystem * keywords.kwSystem +
    config.weights.kwFormat * keywords.kwFormat +
    config.weights.kwRole * keywords.kwRole +
    config.weights.kwMeta * keywords.kwMeta +
    config.weights.kwExploit * keywords.kwExploit;

  const denom = Math.max(extracted.jsonStringCharsTotal, 1);
  const techDensityPer1kChars = (kwControlWeightedSum / denom) * 1000;
  const mechanicsDensityPer1kChars = ((keywords.kwDice + keywords.kwCombat) / denom) * 1000;
  const codeDensityPer1kChars =
    ((keywords.kwCode + keywords.kwMath + layout.uppercaseSnakeCount + layout.codeFenceCount * 10) / denom) * 1000;

  const scoreControl = norm(techDensityPer1kChars, config.caps.techDensityPer1kCharsCap);
  const scoreMechanics = norm(mechanicsDensityPer1kChars, config.caps.mechanicsDensityPer1kCharsCap);
  const scoreCode = norm(codeDensityPer1kChars, config.caps.codeDensityPer1kCharsCap);
  const scoreStructure =
    0.35 * norm(extracted.jsonTotalKeys, config.caps.jsonTotalKeysCap) +
    0.35 * norm(extracted.jsonTotalNodes, config.caps.jsonTotalNodesCap) +
    0.2 * norm(extracted.jsonMaxArrayLen, config.caps.jsonMaxArrayLenCap) +
    0.1 * norm(layout.repeatLineRatio, config.caps.repeatLineRatioCap);
  const scoreSize = norm(extracted.jsonStringCharsTotal, config.caps.jsonStringCharsTotalCap);

  let techScore = Math.round(
    100 * (0.35 * scoreControl + 0.25 * scoreMechanics + 0.2 * scoreStructure + 0.15 * scoreCode + 0.05 * scoreSize)
  );
  if (keywords.kwExploit > 0) {
    techScore = Math.min(100, techScore + config.exploitBoost);
    notes.push('检测到强风险信号（kw_exploit>0），已触发额外加分。');
  }

  const techLevel = computeTechLevel(techScore, config.techLevelThresholds);

  return {
    techScore,
    techLevel,
    raw: {
      jsonTotalNodes: extracted.jsonTotalNodes,
      jsonTotalKeys: extracted.jsonTotalKeys,
      jsonUniqueKeyCount: extracted.jsonUniqueKeyCount,
      jsonMaxDepth: extracted.jsonMaxDepth,
      jsonArrayCount: extracted.jsonArrayCount,
      jsonTotalArrayElems: extracted.jsonTotalArrayElems,
      jsonMaxArrayLen: extracted.jsonMaxArrayLen,
      jsonStringCharsTotal: extracted.jsonStringCharsTotal,
      jsonLongestStringChars: extracted.jsonLongestStringChars,

      lineCount: layout.lineCount,
      uniqueLineCount: layout.uniqueLineCount,
      repeatLineRatio: layout.repeatLineRatio,
      bulletLineCount: layout.bulletLineCount,
      headingLineCount: layout.headingLineCount,
      codeFenceCount: layout.codeFenceCount,
      uppercaseSnakeCount: layout.uppercaseSnakeCount,

      kwMust: keywords.kwMust,
      kwSystem: keywords.kwSystem,
      kwFormat: keywords.kwFormat,
      kwRole: keywords.kwRole,
      kwMeta: keywords.kwMeta,
      kwExploit: keywords.kwExploit,
      kwDice: keywords.kwDice,
      kwCombat: keywords.kwCombat,
      kwCode: keywords.kwCode,
      kwMath: keywords.kwMath
    },
    derived: {
      kwControlWeightedSum,
      techDensityPer1kChars,
      mechanicsDensityPer1kChars,
      codeDensityPer1kChars
    },
    components: {
      scoreControl,
      scoreMechanics,
      scoreStructure,
      scoreCode,
      scoreSize
    },
    notes
  };
};

