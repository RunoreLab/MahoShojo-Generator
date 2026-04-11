type TemplateRenderInput = {
  templateKey: string;
  payload: Record<string, unknown>;
  titleText: string | null;
  bodyText: string | null;
};

type TemplateRenderOutput = {
  title: string;
  body: string;
};

const toDisplayString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const pick = (payload: Record<string, unknown>, ...keys: string[]): string | null => {
  for (const key of keys) {
    const value = toDisplayString(payload[key]);
    if (value) {
      return value;
    }
  }

  return null;
};

const pickStringList = (payload: Record<string, unknown>, key: string): string[] => {
  const value = payload[key];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
};

const withFallback = (
  rendered: Partial<TemplateRenderOutput>,
  input: TemplateRenderInput,
  defaults: TemplateRenderOutput,
): TemplateRenderOutput => ({
  title: rendered.title ?? toDisplayString(input.titleText) ?? defaults.title,
  body: rendered.body ?? toDisplayString(input.bodyText) ?? defaults.body,
});

const templateRenderers: Record<string, (input: TemplateRenderInput) => TemplateRenderOutput> = {
  'site.service.degraded': (input) =>
    withFallback(
      {
        title: '服务降级通知',
        body: `当前服务状态：${pick(input.payload, 'statusText', 'summary') ?? '部分功能可能受影响，请稍后重试。'}`,
      },
      input,
      { title: '服务降级通知', body: '部分功能可能受影响，请稍后重试。' },
    ),
  'site.maintenance.notice': (input) =>
    withFallback(
      {
        title: '维护通知',
        body: `维护说明：${pick(input.payload, 'maintenanceWindow', 'summary', 'statusText') ?? '系统将进行维护，请留意恢复时间。'}`,
      },
      input,
      { title: '维护通知', body: '系统将进行维护，请留意恢复时间。' },
    ),
  'site.activity.notice': (input) =>
    withFallback(
      {
        title: pick(input.payload, 'activityTitle') ?? '活动通知',
        body: pick(input.payload, 'summary', 'body') ?? '站内有新的活动或运营提醒。' ,
      },
      input,
      { title: '活动通知', body: '站内有新的活动或运营提醒。' },
    ),
  'site.policy.notice': (input) =>
    withFallback(
      {
        title: '规则说明更新',
        body: pick(input.payload, 'summary', 'policySummary', 'reason') ?? '请查看最新规则或处理口径说明。',
      },
      input,
      { title: '规则说明更新', body: '请查看最新规则或处理口径说明。' },
    ),
  'site.issue.update': (input) => {
    const issueTitle = pick(input.payload, 'issueTitle', 'title');
    const statusText = pick(input.payload, 'statusText', 'status');
    return withFallback(
      {
        title: issueTitle ? `问题处理进展：${issueTitle}` : '问题处理进展',
        body: [issueTitle, statusText].filter(Boolean).join('，') || '问题状态已有更新，请留意最新处理进展。',
      },
      input,
      { title: '问题处理进展', body: '问题状态已有更新，请留意最新处理进展。' },
    );
  },
  'site.generic.notice': (input) =>
    withFallback({}, input, { title: '站内通知', body: '你有一条新的站内通知。' }),
  'user.moderation.data_card_rejected': (input) => {
    const cardName = pick(input.payload, 'dataCardName');
    const reason = pick(input.payload, 'reason');
    return withFallback(
      {
        title: cardName ? `审核未通过：${cardName}` : '审核未通过',
        body: reason ? `未通过原因：${reason}` : '你的数据卡未通过审核，请修改后重新提交。',
      },
      input,
      { title: '审核未通过', body: '你的数据卡未通过审核，请修改后重新提交。' },
    );
  },
  'user.moderation.data_card_banned': (input) =>
    withFallback(
      {
        title: '数据卡已封禁',
        body: pick(input.payload, 'reason', 'summary') ?? '你的数据卡因违规已被封禁。' ,
      },
      input,
      { title: '数据卡已封禁', body: '你的数据卡因违规已被封禁。' },
    ),
  'user.moderation.user_banned': (input) =>
    withFallback(
      {
        title: '账号处理通知',
        body: pick(input.payload, 'reason', 'summary') ?? '你的账号当前受到限制，请查看详情。' ,
      },
      input,
      { title: '账号处理通知', body: '你的账号当前受到限制，请查看详情。' },
    ),
  'user.reputation.badge_awarded': (input) =>
    withFallback(
      {
        title: pick(input.payload, 'badgeName') ? `获得徽章：${pick(input.payload, 'badgeName')}` : '获得新徽章',
        body: pick(input.payload, 'summary', 'body') ?? '恭喜你获得了新的徽章。' ,
      },
      input,
      { title: '获得新徽章', body: '恭喜你获得了新的徽章。' },
    ),
  'user.reputation.card_trending': (input) =>
    withFallback(
      {
        title: '公开卡获得推荐',
        body: pick(input.payload, 'dataCardName')
          ? `${pick(input.payload, 'dataCardName')} 已进入热门或推荐列表。`
          : '你的公开卡已进入热门或推荐列表。',
      },
      input,
      { title: '公开卡获得推荐', body: '你的公开卡已进入热门或推荐列表。' },
    ),
  'user.moderation.data_card_reported': (input) => {
    const cardName = pick(input.payload, 'dataCardName');
    const reasons = pickStringList(input.payload, 'reasonLabels');
    const references = pickStringList(input.payload, 'referenceSummary');
    const details = pick(input.payload, 'detailsPreview');
    const reportCount = input.payload.reportCount;
    const reportCountText =
      typeof reportCount === 'number' && Number.isFinite(reportCount) && reportCount > 0
        ? `当前累计有效举报 ${Math.trunc(reportCount)} 条。`
        : null;

    return withFallback(
      {
        title: cardName ? `数据卡被举报：${cardName}` : '数据卡被举报',
        body: [
          '你的公开数据卡收到举报，请自查并按需修订。',
          reasons.length > 0 ? `理由：${reasons.join('；')}` : null,
          references.length > 0 ? references.join('；') : null,
          details ? `补充说明：${details}` : null,
          reportCountText,
        ]
          .filter(Boolean)
          .join('\n'),
      },
      input,
      { title: '数据卡被举报', body: '你的公开数据卡收到举报，请自查并按需修订。' },
    );
  },
  'user.moderation.report_case_resolved': (input) => {
    const cardName = pick(input.payload, 'dataCardName');
    const resolutionLabel = pick(input.payload, 'resolutionLabel', 'resolutionCode');
    const reason = pick(input.payload, 'reason', 'summary');
    return withFallback(
      {
        title: cardName ? `处理结果通知：${cardName}` : '处理结果通知',
        body: [
          resolutionLabel ? `当前处理结果：${resolutionLabel}` : '你的公开数据卡已完成处理。',
          reason ? `补充说明：${reason}` : null,
          '如对处理结果有异议，可前往申诉页提交说明。',
        ]
          .filter(Boolean)
          .join('\n'),
      },
      input,
      { title: '处理结果通知', body: '你的公开数据卡已完成处理，可前往申诉页查看并提交说明。' },
    );
  },
  'user.moderation.report_appeal_resolved': (input) => {
    const cardName = pick(input.payload, 'dataCardName');
    const resolutionLabel = pick(input.payload, 'resolutionLabel', 'resolutionCode');
    return withFallback(
      {
        title: cardName ? `申诉处理完成：${cardName}` : '申诉处理完成',
        body: resolutionLabel
          ? `你的申诉已处理，复核结论：${resolutionLabel}。`
          : '你的申诉已处理，请查看最新复核结论。',
      },
      input,
      { title: '申诉处理完成', body: '你的申诉已处理，请查看最新复核结论。' },
    );
  },
  'user.generic.notice': (input) =>
    withFallback({}, input, { title: '系统通知', body: '你有一条新的定向通知。' }),
};

export function renderMessageTemplate(input: TemplateRenderInput): TemplateRenderOutput {
  const renderer = templateRenderers[input.templateKey];
  if (renderer) {
    return renderer(input);
  }

  return withFallback({}, input, {
    title: '系统通知',
    body: '你有一条新的系统通知。',
  });
}
