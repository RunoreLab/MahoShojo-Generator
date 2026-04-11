export type AdminMessageTemplateCatalogItem = {
  scope: 'site' | 'direct';
  messageType: string;
  templateKey: string;
  label: string;
  description: string;
  defaultPriority: 'low' | 'normal' | 'high';
  defaultActionUrl?: string;
  payloadHint: string;
};

export const ADMIN_MESSAGE_TEMPLATE_CATALOG: AdminMessageTemplateCatalogItem[] = [
  {
    scope: 'site',
    messageType: 'generic',
    templateKey: 'site.generic.notice',
    label: '全站通用通知',
    description: '面向全站用户的通用站内通知。',
    defaultPriority: 'normal',
    payloadHint: '{"title":"标题","body":"正文"}',
  },
  {
    scope: 'site',
    messageType: 'issue',
    templateKey: 'site.issue.update',
    label: '问题处理进展',
    description: '用于公告线上问题、故障或修复进展。',
    defaultPriority: 'high',
    payloadHint: '{"issueTitle":"问题标题","statusText":"当前进展"}',
  },
  {
    scope: 'direct',
    messageType: 'generic',
    templateKey: 'user.generic.notice',
    label: '定向通用通知',
    description: '发送给指定用户的通用通知。',
    defaultPriority: 'normal',
    payloadHint: '{"title":"标题","body":"正文"}',
  },
  {
    scope: 'direct',
    messageType: 'moderation',
    templateKey: 'user.moderation.data_card_rejected',
    label: '数据卡审核未通过',
    description: '通知作者数据卡审核被驳回，需要修改后重新提交。',
    defaultPriority: 'high',
    defaultActionUrl: '/character-manager',
    payloadHint: '{"dataCardName":"数据卡名","reason":"驳回原因"}',
  },
  {
    scope: 'direct',
    messageType: 'moderation',
    templateKey: 'user.moderation.data_card_banned',
    label: '数据卡封禁通知',
    description: '通知作者数据卡因违规被封禁或下架。',
    defaultPriority: 'high',
    defaultActionUrl: '/character-manager',
    payloadHint: '{"dataCardName":"数据卡名","reason":"封禁原因"}',
  },
  {
    scope: 'direct',
    messageType: 'moderation',
    templateKey: 'user.moderation.data_card_reported',
    label: '数据卡被举报通知',
    description: '通知作者公开数据卡被举报，提示其自查或修订。',
    defaultPriority: 'normal',
    defaultActionUrl: '/report-appeals',
    payloadHint:
      '{"dataCardName":"数据卡名","reasonLabels":["理由1"],"referenceSummary":["引用摘要"],"detailsPreview":"补充说明","reportCount":1}',
  },
  {
    scope: 'direct',
    messageType: 'moderation',
    templateKey: 'user.moderation.report_case_resolved',
    label: '举报案件处理结果',
    description: '通知作者举报案件的正式处理结果，并引导到申诉入口。',
    defaultPriority: 'high',
    defaultActionUrl: '/report-appeals',
    payloadHint: '{"dataCardName":"数据卡名","resolutionLabel":"确认违规"}',
  },
];

export function getAdminMessageTemplateCatalogItem(templateKey: string): AdminMessageTemplateCatalogItem | null {
  return ADMIN_MESSAGE_TEMPLATE_CATALOG.find((item) => item.templateKey === templateKey) ?? null;
}
