import type { GenerationRankingQueue, GenerationRankingQueueResult } from '@mahoshojo/contracts/arena-generation-ranking';

export type ArenaRankingQueueFeedbackProps = {
  queue: GenerationRankingQueue;
  result: Readonly<GenerationRankingQueueResult> | null;
  fallbackRating?: number | null;
};

const formatIneligibleReasons = (reasons: readonly string[]): string => {
  const map: Record<string, string> = {
    'free-disabled': '未开启自由排位',
    'status-not-completed': '战报未完成',
    'combatant-count-not-2': '需 2 人对战',
    'ip-missing': '无法获取 IP',
    'mode-not-classic': '需经典模式',
    'mode-not-season': '模式不符合赛季规则',
    'need-login': '需登录',
    'need-ranked-match': '需先进行排位匹配',
    'ranked-match-missing': '未进行排位匹配',
    'ranked-match-invalid': '排位匹配票据无效',
    'ranked-match-expired': '排位匹配已过期',
    'ranked-match-settings-changed': '匹配后修改了设置',
    'ranked-match-roster-changed': '匹配后修改了参战列表',
    'ranked-match-unrankable': '参战者未登记为数据卡/预设',
    'ranked-match-user-mismatch': '排位匹配票据与账号不匹配',
    'language-not-zh-cn': '需简体中文',
    'has-user-guidance': '存在故事引导',
    'season-user-guidance-missing': '缺少赛季故事引导',
    'season-user-guidance-mismatch': '故事引导不符合赛季规则',
    'season-questionnaire-lore-not-allowed': '存在问卷/设定卡 Lore（赛季规则不允许）',
    'season-questionnaire-lore-mismatch': '问卷/设定卡 Lore 不符合赛季规则',
    'season-scenario-missing': '缺少主情景（赛季规则）',
    'season-scenario-preset-mismatch': '主情景不是赛季指定预设',
    'season-aux-scenarios-not-allowed': '存在辅助情景（赛季规则不允许）',
    'has-adjudication-events': '存在随机判定器事件',
    'read-arena-history': '开启读取历战',
    'read-current-state': '开启读取当前状态',
    'read-narrative-history': '开启读取叙事历史',
    'has-character-guidance': '存在角色行动引导',
    'ai-model-blacklisted': '选择了不支持严格排位计分的模型',
  };
  return reasons.map((r) => Object.prototype.hasOwnProperty.call(map, r) ? map[r] : r).join('、') || '未返回原因';
};

const formatSkipReason = (reason: string | null): string => {
  if (!reason) return '未知原因';
  const map: Record<string, string> = {
    'winner-empty': '战报未给出胜者',
    'multi-winner': '胜者包含多人',
    'winner-ambiguous': '胜者无法匹配参战者',
    'daily-limit': '今日严格排位次数已达上限（按 UTC 00:00/北京时间 08:00 刷新）',
    'dedup-user-pair': '同一对手组合仍处于计分冷却期（严格去重）',
    'pair-daily-limit': '同一对手组合今日计分已达上限（严格去重）',
    'strict-card-missing': '数据卡不存在/已删除（严格排位不计分）',
    'entity-binding-missing': '缺少服务器角色来源校验，本局不计分',
    'entity-body-mismatch': '角色正文与所选来源不一致，本局不计分',
    'entity-reference-unavailable': '角色来源当前不可验证，本局不计分',
    'entity-version-changed': '生成后角色来源已更新，本局不计分',
    'strict-not-character': '仅“角色”数据卡可参与严格排位计分',
    'strict-not-public': '严格排位仅允许公开角色卡',
    'strict-not-approved': '严格排位仅允许已审核通过的公开角色卡',
    'strict-no-owned-combatant': '严格排位要求两名参战者中至少一名为当前账号的线上角色卡',
    'strict-out-of-range': '对手分差过大（不计严格排位）',
    'dedup-ip-pair': '短时间同 IP 重复对局（自由去重）',
    'ratings-missing': '排位记录缺失',
    'rating-conflict': '排位并发冲突',
  };
  return Object.prototype.hasOwnProperty.call(map, reason) ? map[reason] : reason;
};

const shortenReason = (text: string, maxChars = 18): string => {
  const chars = Array.from(text);
  if (chars.length <= maxChars) return text;
  return `${chars.slice(0, Math.max(0, maxChars)).join('')}…`;
};

const renderDeltaBadge = (delta: number) => {
  const text = delta >= 0 ? `+${delta}` : String(delta);
  const className =
    delta > 0
      ? 'text-emerald-700'
      : delta < 0
        ? 'text-red-700'
        : 'text-gray-600';
  return <span className={['font-mono font-semibold', className].join(' ')} title={`本局变化：${text}`}>本局变化：Δ{text}</span>;
};

const ReasonFeedback = ({ prefix, reason, suffix = '' }: { prefix: string; reason: string; suffix?: string }) => (
  <span className="ml-1 text-gray-500" title={reason}>
    <span aria-hidden="true">（{prefix}：{shortenReason(reason)}{suffix}）</span>
    <span className="sr-only">（{prefix}：{reason}{suffix}）</span>
  </span>
);

const queueStatusSuffix = (result: Readonly<GenerationRankingQueueResult>) => {
  // A recorded settlement outcome takes precedence over current eligibility.
  switch (result.eventStatus) {
    case 'applied':
      return <span className="ml-1">（已计分；{typeof result.delta === 'number'
        ? renderDeltaBadge(result.delta) : '本局变化未返回'}）</span>;
    case 'pending':
      return <span className="ml-1 text-gray-500">（结算中）</span>;
    case 'skipped':
      return <ReasonFeedback prefix="未计分" reason={formatSkipReason(result.skipReason)} />;
    case 'failed':
      return <ReasonFeedback prefix="结算失败" reason={formatSkipReason(result.skipReason)} />;
    case 'missing':
      return result.eligible
        ? <span className="ml-1 text-gray-500">（暂无结算记录，状态待确认）</span>
        : <ReasonFeedback prefix="不符合计分资格" reason={formatIneligibleReasons(result.ineligibleReasons)} suffix="；暂无结算记录" />;
  }
};

/** Pure feedback for one queue; hosts retain ownership of lookup and fallback data. */
export function ArenaRankingQueueFeedback({ queue, result, fallbackRating }: ArenaRankingQueueFeedbackProps) {
  return <span className="whitespace-normal break-words sm:whitespace-nowrap">
    {queue === 'strict' ? '严格' : '自由'}：{result?.rating ?? fallbackRating ?? '-'}
    {result ? queueStatusSuffix(result) : null}
  </span>;
}
