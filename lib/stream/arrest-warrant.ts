import { STREAM_TRUNCATED_BY_SENSITIVE_MARKER } from '@/lib/arena/redo-updates';

export const buildStreamSensitiveArrestWarrantMarkdown = (reason?: string): string => {
  const safeReason = reason?.trim() ? `（原因：${reason.trim()}）` : '';
  return [
    '',
    '',
    '---',
    '',
    '<!-- ' + STREAM_TRUNCATED_BY_SENSITIVE_MARKER + ' -->',
    '',
    '## 逮捕令',
    '',
    '**批 准 逮 捕**',
    '',
    `内容违反调查院规定${safeReason}，系统已自动截断。`,
    '',
    '⚠️ **金绿猫眼权杖严正声明** ⚠️',
    '',
    '城际网络并非法外之地！',
    '',
  ].join('\n');
};
