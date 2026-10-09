import type { TavernCardNormalized } from './types';

export const buildGeneralMarkdown = (normalized: TavernCardNormalized): string => {
  const lines: string[] = [];
  lines.push(`# 角色：${normalized.name}`);
  if (normalized.description?.trim()) {
    lines.push('');
    lines.push('## 描述');
    lines.push(normalized.description.trim());
  }
  if (normalized.personality?.trim()) {
    lines.push('');
    lines.push('## 性格');
    lines.push(normalized.personality.trim());
  }
  if (normalized.scenario?.trim()) {
    lines.push('');
    lines.push('## 场景');
    lines.push(normalized.scenario.trim());
  }
  if (normalized.firstMes?.trim()) {
    lines.push('');
    lines.push('## 开场白');
    lines.push(normalized.firstMes.trim());
  }
  if (normalized.mesExample?.trim()) {
    lines.push('');
    lines.push('## 对话样例');
    lines.push(normalized.mesExample.trim());
  }
  if (normalized.tags && normalized.tags.length > 0) {
    lines.push('');
    lines.push('## 标签');
    lines.push(normalized.tags.join('、'));
  }
  return lines.join('\n');
};

