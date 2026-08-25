import type { DataCardReportReasonCode, DataCardReportReasonOption } from '@/lib/data-card-reports/types';

export const DATA_CARD_REPORT_REASONS: DataCardReportReasonOption[] = [
  {
    code: 'plagiarism',
    label: '疑似抄袭或高度近似搬运',
    description: '目标数据卡与既有公开内容高度近似，或存在疑似搬运、抄袭。',
  },
  {
    code: 'harassment_or_hate',
    label: '辱骂、仇恨、攻击性内容',
    description: '包含针对个人或群体的辱骂、仇恨、歧视或攻击性表达。',
  },
  {
    code: 'sexual_or_excessive_gore',
    label: '露骨性内容或过度血腥猎奇',
    description: '包含不适合公开展示的露骨性描写、过度血腥或猎奇内容。',
  },
  {
    code: 'illegal_or_dangerous',
    label: '违法、危险、鼓动现实伤害',
    description: '包含违法、危险行为或鼓动现实伤害的内容。',
  },
  {
    code: 'spam_or_malicious_noise',
    label: '刷屏、污染、恶意噪声内容',
    description: '包含刷屏、污染公开列表、恶意噪声或明显无意义内容。',
  },
  {
    code: 'rule_violation_other',
    label: '其他守则违规',
    description: '不属于以上类别，但可能违反社区守则或公开内容规范。',
  },
];

const reasonCodes = new Set(DATA_CARD_REPORT_REASONS.map((reason) => reason.code));

export function isDataCardReportReasonCode(value: unknown): value is DataCardReportReasonCode {
  return typeof value === 'string' && reasonCodes.has(value as DataCardReportReasonCode);
}

export function getDataCardReportReasonLabel(code: DataCardReportReasonCode | string): string {
  return DATA_CARD_REPORT_REASONS.find((reason) => reason.code === code)?.label ?? '未知举报理由';
}
