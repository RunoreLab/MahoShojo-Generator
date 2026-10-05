/**
 * 问卷答案备份文本构造。
 *
 * 与 `questionnaire-bulk-parser` 配对使用：导出的 `Q{n}/A:` 段落可被
 * `parseBulkQuestionnaireAnswers` 的 `qa` 格式重新识别，双端（Web 三页与
 * Desktop /details）共用同一文本格式，避免导出/回灌口径漂移。
 */

export interface QuestionnaireAnswerExportItem {
  index: number;
  question: string;
  answer: string;
  questionnaireTitle?: string;
}

export interface QuestionnaireAnswerExportTextOptions {
  /** 文件头标题，如「魔法少女问卷答案备份」。 */
  title: string;
  /** 已按题序收集的非空答案项。 */
  items: QuestionnaireAnswerExportItem[];
  /** 当前问卷合并后的总题数（含未答）。 */
  total: number;
  /** 已选问卷名（多问卷以「 + 」连接）；空则不输出该行。 */
  questionnaireLabel?: string;
  now?: Date;
}

export const buildQuestionnaireAnswerExportText = ({
  title,
  items,
  total,
  questionnaireLabel,
  now = new Date(),
}: QuestionnaireAnswerExportTextOptions): string => {
  const lines: string[] = [];
  lines.push(`【${title}】`);
  lines.push(`导出时间：${now.toLocaleString()}`);
  lines.push(`已填写：${items.length} / ${total}`);
  if (questionnaireLabel) lines.push(`问卷：${questionnaireLabel}`);
  lines.push('');

  for (const item of items) {
    const questionnaireTitle = item.questionnaireTitle ? `（${item.questionnaireTitle}）` : '';
    lines.push(`Q${item.index + 1}${questionnaireTitle}: ${item.question}`);
    lines.push(`A: ${item.answer}`);
    lines.push('');
  }

  return lines.join('\n').trimEnd();
};

/**
 * 从按题序排列的匹配目标与按键回答中收集已填写的导出项；
 * 与 Web 三页 `buildAnswerExportText` 的 flatMap 语义一致（只导出非空答案）。
 */
export const collectQuestionnaireAnswerExportItems = <
  T extends { key: string; question: string; questionnaireTitle?: string },
>(
  targets: T[],
  answersByKey: Record<string, string>,
): QuestionnaireAnswerExportItem[] =>
  targets.flatMap((target, index) => {
    const raw = answersByKey[target.key];
    if (typeof raw !== 'string' || !raw.trim()) return [];
    return [{
      index,
      question: target.question,
      answer: raw,
      ...(target.questionnaireTitle ? { questionnaireTitle: target.questionnaireTitle } : {}),
    }];
  });
