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
