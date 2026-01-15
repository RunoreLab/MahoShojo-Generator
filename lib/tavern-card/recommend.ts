import magicalQuestionnaire from '../../public/questionnaire.json';
import canshouQuestionnaire from '../../public/canshou_questionnaire.json';

export interface TavernExportRecommendations {
  tags: string[];
  firstMes?: string;
  mesExample?: string;
}

export interface TavernExportMeta {
  source?: 'database' | 'local';
  tags?: string[];
  isNative?: boolean | null;
  techLevel?: string | null;
  rankTier?: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
};

const safeString = (value: unknown): string => (typeof value === 'string' ? value : '');

const safeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
};

const uniqueStrings = (items: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
};

const limitTag = (value: string, maxChars: number) => value.trim().slice(0, maxChars);

const addTag = (tags: string[], value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return;
  tags.push(limitTag(trimmed, 32));
};

const collectText = (parts: string[]): string => parts.filter(Boolean).join('\n');

const findByKeywordRules = (text: string): string[] => {
  const rules: Array<{ tag: string; re: RegExp }> = [
    { tag: '竞技场', re: /(竞技场|a\.r\.e\.n\.a|arena)/i },
    { tag: '奇境', re: /(奇境|结界|wonderland)/i },
    { tag: '繁开', re: /(繁开|觉醒|blooming)/i },
    { tag: '校园向', re: /(校园|学校|社团|班级)/i },
    { tag: '日常向', re: /(日常|生活日常|碎片化日常)/i },
    { tag: '搞笑向', re: /(搞笑|喜剧|整活|沙雕)/i },
    { tag: '治愈向', re: /(治愈|疗愈|温暖)/i },
    { tag: '黑暗向', re: /(黑暗|绝望|残酷|压抑)/i },
    { tag: '悬疑向', re: /(悬疑|谜团|调查|线索)/i },
    { tag: '恐怖向', re: /(恐怖|惊悚|怪谈|诡异)/i },
    { tag: '百合向', re: /(百合|gl\b)/i },
    { tag: '赛博朋克', re: /(赛博|cyberpunk)/i },
    { tag: '科幻向', re: /(科幻|scifi|science fiction)/i },
    { tag: '奇幻向', re: /(奇幻|fantasy)/i },
    { tag: '时间系', re: /(时间|回溯|停滞|加速)/i },
    { tag: '治愈系能力', re: /(治愈系|治疗|净化|复原)/i },
    { tag: '精神系能力', re: /(精神|心灵|认知|幻觉|幻术)/i },
    { tag: '诅咒系能力', re: /(诅咒|侵蚀|腐蚀)/i },
  ];

  const hits: string[] = [];
  for (const rule of rules) {
    if (rule.re.test(text)) hits.push(rule.tag);
  }
  return hits;
};

const buildMagicalGirlDialogueFromUserAnswers = (answers: string[]): TavernExportRecommendations => {
  const stripLeadingQuestionNumber = (value: string, index: number): string => {
    const n = index + 1;
    const re = new RegExp(`^${n}\\s*[\\.．、\\)）\\]】:：\\-–—]\\s*`);
    return value.replace(re, '').trim();
  };

  const cleaned = answers.map((answer, idx) => stripLeadingQuestionNumber(answer.trim(), idx));
  const first = cleaned[0] ? cleaned[0] : '';

  const questions: string[] = Array.isArray(magicalQuestionnaire.questions) ? magicalQuestionnaire.questions : [];
  const pairs: string[] = [];
  const maxPairs = Math.min(cleaned.length, questions.length);
  for (let i = 0; i < maxPairs; i += 1) {
    const answer = cleaned[i];
    if (!answer) continue;
    const rawQuestion = questions[i] ? String(questions[i]) : `问题 ${i + 1}`;
    const question = stripLeadingQuestionNumber(rawQuestion.trim(), i) || rawQuestion.trim();
    pairs.push(`{{user}}: ${question}\n{{char}}: ${answer}`);
  }

  const mesExample = pairs.length > 0 ? pairs.join('\n\n') : '';
  return {
    tags: [],
    firstMes: first || undefined,
    mesExample: mesExample || undefined,
  };
};

const getMagicalGirlStructuredTags = (card: Record<string, unknown>): string[] => {
  const tags: string[] = [];

  const magicConstruct = isRecord(card.magicConstruct) ? card.magicConstruct : null;
  const magicConstructName = magicConstruct ? safeString(magicConstruct.name) : '';
  if (magicConstructName) addTag(tags, magicConstructName);

  const wonderlandRule = isRecord(card.wonderlandRule) ? card.wonderlandRule : null;
  const wonderlandRuleName = wonderlandRule ? safeString(wonderlandRule.name) : '';
  if (wonderlandRuleName) addTag(tags, wonderlandRuleName);

  const blooming = isRecord(card.blooming) ? card.blooming : null;
  const bloomingName = blooming ? safeString(blooming.name) : '';
  if (bloomingName) addTag(tags, bloomingName);

  return tags;
};

const getCanshouStructuredTags = (card: Record<string, unknown>): string[] => {
  const tags: string[] = [];
  const stage = safeString(card.evolutionStage);
  if (stage) addTag(tags, stage);
  const coreConcept = safeString(card.coreConcept);
  if (coreConcept) addTag(tags, coreConcept);
  return tags;
};

const buildTextCorpus = (template: string, card: Record<string, unknown>): string => {
  if (template === 'magical-girl') {
    const appearance = isRecord(card.appearance) ? card.appearance : null;
    const analysis = isRecord(card.analysis) ? card.analysis : null;
    const magicConstruct = isRecord(card.magicConstruct) ? card.magicConstruct : null;
    const wonderlandRule = isRecord(card.wonderlandRule) ? card.wonderlandRule : null;
    const blooming = isRecord(card.blooming) ? card.blooming : null;

    return collectText([
      safeString(card.codename),
      safeString(card.name),
      appearance ? safeString(appearance.overallLook) : '',
      appearance ? safeString(appearance.outfit) : '',
      appearance ? safeString(appearance.accessories) : '',
      appearance ? safeString(appearance.colorScheme) : '',
      magicConstruct ? safeString(magicConstruct.name) : '',
      magicConstruct ? safeString(magicConstruct.form) : '',
      magicConstruct ? safeString(magicConstruct.description) : '',
      magicConstruct ? safeStringArray(magicConstruct.basicAbilities).join(' ') : '',
      wonderlandRule ? safeString(wonderlandRule.name) : '',
      wonderlandRule ? safeString(wonderlandRule.description) : '',
      wonderlandRule ? safeString(wonderlandRule.tendency) : '',
      wonderlandRule ? safeString(wonderlandRule.activation) : '',
      blooming ? safeString(blooming.name) : '',
      blooming ? safeString(blooming.evolvedForm) : '',
      blooming ? safeString(blooming.evolvedOutfit) : '',
      blooming ? safeString(blooming.powerLevel) : '',
      blooming ? safeStringArray(blooming.evolvedAbilities).join(' ') : '',
      analysis ? safeString(analysis.personalityAnalysis) : '',
      analysis ? safeString(analysis.abilityReasoning) : '',
      analysis ? safeString(analysis.predictionBasis) : '',
      safeStringArray(card.userAnswers).join('\n'),
    ]);
  }

  if (template === 'canshou') {
    const userAnswers = (() => {
      const value = card.userAnswers;
      if (Array.isArray(value)) return safeStringArray(value).join('\n');
      if (isRecord(value)) return collectText(Object.values(value).map((item) => safeString(item)));
      return '';
    })();

    return collectText([
      safeString(card.name),
      safeString(card.appearance),
      safeString(card.materialAndSkin),
      safeString(card.featuresAndAppendages),
      safeString(card.coreConcept),
      safeString(card.coreEmotion),
      safeString(card.evolutionStage),
      safeString(card.attackMethod),
      safeString(card.specialAbility),
      safeString(card.origin),
      safeString(card.birthEnvironment),
      safeString(card.researcherNotes),
      userAnswers,
    ]);
  }

  return collectText([
    safeString(card.name),
    safeString(card.codename),
    safeString(card.description),
    safeString(card.content),
  ]);
};

export function recommendTavernExportFields(
  template: string,
  dataCard: unknown,
  existingTags: string[] = [],
  meta?: TavernExportMeta | null
): TavernExportRecommendations {
  const tagList: string[] = [...existingTags];

  const isFromDatabase = meta?.source === 'database';
  if (isFromDatabase) {
    const metaTags = safeStringArray(meta?.tags);
    metaTags.forEach((tag) => addTag(tagList, tag));
  }

  if (typeof meta?.isNative === 'boolean') {
    addTag(tagList, meta.isNative ? '原生' : '非原生');
  }

  const techLevel = safeString(meta?.techLevel);
  if (techLevel) {
    addTag(tagList, `技术等级-${techLevel}`);
  }

  if (isFromDatabase) {
    const rankTier = safeString(meta?.rankTier);
    if (rankTier) {
      addTag(tagList, `段位-${rankTier}`);
    }
  }

  addTag(tagList, 'MahoShojo-Generator');

  if (!isRecord(dataCard)) {
    return { tags: uniqueStrings(tagList).slice(0, 50) };
  }

  if (template === 'magical-girl') {
    addTag(tagList, '魔法少女');
    getMagicalGirlStructuredTags(dataCard).forEach((tag) => addTag(tagList, tag));
  } else if (template === 'canshou') {
    addTag(tagList, '残兽');
    getCanshouStructuredTags(dataCard).forEach((tag) => addTag(tagList, tag));
  } else {
    addTag(tagList, '其他角色卡');
  }

  const corpus = buildTextCorpus(template, dataCard).toLowerCase();
  findByKeywordRules(corpus).forEach((tag) => addTag(tagList, tag));

  const recommendations: TavernExportRecommendations = { tags: uniqueStrings(tagList).slice(0, 50) };

  if (template === 'magical-girl') {
    const userAnswers = safeStringArray(dataCard.userAnswers);
    const derived = userAnswers.length > 0 ? buildMagicalGirlDialogueFromUserAnswers(userAnswers) : null;
    if (derived?.firstMes) recommendations.firstMes = derived.firstMes;
    if (derived?.mesExample) recommendations.mesExample = derived.mesExample;
  }

  return recommendations;
}

export const getCanshouQuestionPairs = (): Array<{ id: string; question: string }> => {
  const questions = Array.isArray(canshouQuestionnaire.questions) ? canshouQuestionnaire.questions : [];
  return questions
    .map((item) => ({
      id: typeof item?.id === 'string' ? item.id : '',
      question: typeof item?.question === 'string' ? item.question : '',
    }))
    .filter((item: { id: string; question: string }) => item.id && item.question);
};
