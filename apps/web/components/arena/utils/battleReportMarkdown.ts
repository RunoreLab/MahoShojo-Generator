'use client';

import type { NewsReport } from '@/components/BattleReportCard';

export const toBattleReportMarkdown = (report: NewsReport): string => {
  const headline = (report?.headline ?? '').toString().trim();
  const body = (report?.article?.body ?? '').toString().trim();
  const winner = (report?.officialReport?.winner ?? '').toString().trim();
  const conclusion = (report?.officialReport?.conclusion ?? '').toString().trim();

  const parts: string[] = [];
  if (headline) {
    parts.push(`# ${headline}`);
  } else {
    parts.push('# 战报');
  }

  if (body) {
    parts.push(body);
  }

  parts.push('## 胜利者');
  parts.push(winner ? `- ${winner}` : '- 未知');

  parts.push('## 最终结果');
  if (conclusion) {
    parts.push(conclusion);
  }

  return parts.join('\n\n');
};

