'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

import { TechBadge } from '@/components/ranking/TechBadge';
import { TierBadge } from '@/components/ranking/TierBadge';

type Queue = 'strict' | 'free';

type QueueResult = {
  eligible: boolean;
  ineligibleReasons: string[];
  eventStatus: 'missing' | 'pending' | 'applied' | 'skipped' | 'failed';
  skipReason: string | null;
  rating: number | null;
  tier: string | null;
  delta: number | null;
  rank: number | null;
  total: number | null;
  rankDelta: number | null;
};

type GenerationRankingReady = {
  success: true;
  state: 'ready';
  generationId: string;
  snapshot?: { extraJson?: string | null } | null;
  participants: Array<{
    displayName: string;
    techScore: number | null;
    techLevel: string | null;
    queues: Record<Queue, QueueResult>;
  }>;
};

type GenerationRankingResponse =
  | { success: true; state: 'pending'; generationId: string; message: string }
  | GenerationRankingReady
  | { success: false; generationId: string; error: string };

const formatSigned = (value: number): string => (value >= 0 ? `+${value}` : String(value));

const formatRankDelta = (delta: number): { text: string; className: string; title: string } => {
  if (delta > 0) return { text: `↑${delta}`, className: 'text-emerald-300', title: `排名提升：${delta}` };
  if (delta < 0) return { text: `↓${Math.abs(delta)}`, className: 'text-red-300', title: `排名下降：${Math.abs(delta)}` };
  return { text: '—', className: 'text-gray-300', title: '排名无变化' };
};

const formatIneligibleReasons = (reasons: string[]): string => {
  const map: Record<string, string> = {
    'status-not-completed': '战报未完成',
    'combatant-count-not-2': '需 2 人对战',
    'ip-missing': '无法获取 IP',
    'mode-not-classic': '需经典模式',
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
    'level-not-default': '等级非默认',
    'has-user-guidance': '存在故事引导',
    'has-adjudication-events': '存在随机判定器事件',
    'read-arena-history': '开启读取历战',
    'read-current-state': '开启读取当前状态',
    'read-narrative-history': '开启读取叙事历史',
    'has-character-guidance': '存在角色行动引导',
    'ai-model-blacklisted': '选择了不支持严格排位计分的模型',
  };
  if (!Array.isArray(reasons) || reasons.length === 0) return '未知原因';
  return reasons.map((r) => map[r] ?? r).join('、');
};

const formatStrictEventStatus = (status: QueueResult['eventStatus'], skipReason: string | null): string => {
  if (status === 'applied') return '已计入天梯';
  if (status === 'pending' || status === 'missing') return '结算中…';
  if (status === 'failed') return '结算失败';
  if (status === 'skipped') {
    const map: Record<string, string> = {
      'winner-empty': '未给出胜者（跳过计分）',
      'multi-winner': '胜者包含多人（跳过计分）',
      'winner-ambiguous': '胜者无法匹配参战者（跳过计分）',
      'daily-limit': '今日严格排位次数已达上限（按 UTC 00:00/北京时间 08:00 刷新；跳过计分）',
      'dedup-user-pair': '短时间同对手重复对局（跳过计分）',
      'ratings-missing': '排位记录缺失（结算失败）',
      'rating-conflict': '并发冲突（结算失败）',
    };
    const reason = typeof skipReason === 'string' ? skipReason.trim() : '';
    return reason ? (map[reason] ?? `已跳过：${reason}`) : '已跳过计分';
  }
  return '结算状态未知';
};

export function RankedMatchReportPanel({ generationId }: { generationId?: string | null }) {
  const id = typeof generationId === 'string' ? generationId.trim() : '';
  const [data, setData] = useState<GenerationRankingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const attemptsRef = useRef(0);
  const startedAtRef = useRef<number>(0);
  const timeoutRef = useRef<number | null>(null);

  const shouldPoll = useMemo(() => {
    if (!data || data.success !== true) return false;
    if (data.state === 'pending') return true;
    if (data.state !== 'ready') return false;
    const strictQueue = data.participants.find((p) => p.queues.strict.eligible)?.queues.strict;
    if (!strictQueue) return false;
    return strictQueue.eventStatus === 'missing' || strictQueue.eventStatus === 'pending';
  }, [data]);

  const computePollDelayMs = (payload: GenerationRankingResponse | null, attempts: number): number => {
    // 流式战报的 battle_report_generations 往往在“流结束后”才落库；
    // 如果只短轮询几次，很容易在长战报（几十秒~数分钟）时错过结算信息。
    const exp = Math.min(6, Math.max(0, attempts));
    const base = payload?.success === true && payload.state === 'ready' ? 1200 : 2500;
    const max = payload?.success === true && payload.state === 'ready' ? 6000 : 15000;
    const jitter = Math.floor(Math.random() * 250);
    return Math.min(max, Math.floor(base * Math.pow(2, exp)) + jitter);
  };

  useEffect(() => {
    if (!id) return;

    const run = async () => {
      try {
        const res = await fetch(`/api/arena/generation-ranking?generationId=${encodeURIComponent(id)}`);
        const json = (await res.json()) as GenerationRankingResponse;
        if (!res.ok) throw new Error((json as any)?.error ?? `HTTP ${res.status}`);
        setData(json);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : '无法加载排位信息');
      }
    };

    attemptsRef.current = 0;
    startedAtRef.current = Date.now();
    void run();

    return () => {
      if (timeoutRef.current != null) window.clearTimeout(timeoutRef.current);
    };
  }, [id]);

  useEffect(() => {
    if (!id) return;
    if (!shouldPoll) return;
    // 最长轮询 15 分钟：覆盖长流式生成（最多 10 分钟）+ 异步落库 + 排位结算。
    if (startedAtRef.current > 0 && Date.now() - startedAtRef.current > 15 * 60_000) return;

    const delayMs = computePollDelayMs(data, attemptsRef.current);
    timeoutRef.current = window.setTimeout(() => {
      attemptsRef.current += 1;
      fetch(`/api/arena/generation-ranking?generationId=${encodeURIComponent(id)}`)
        .then((res) => res.json().then((json) => ({ res, json })))
        .then(({ res, json }) => {
          if (!res.ok) throw new Error((json as any)?.error ?? `HTTP ${res.status}`);
          setData(json as GenerationRankingResponse);
          setError(null);
        })
        .catch((e) => {
          setError(e instanceof Error ? e.message : '无法加载排位信息');
        });
    }, delayMs);

    return () => {
      if (timeoutRef.current != null) window.clearTimeout(timeoutRef.current);
    };
  }, [id, shouldPoll, data]);

  if (!id) return null;
  if (!data) return null;
  if (data.success !== true) return null;
  if (data.state !== 'ready') return null;

  const strictEligible = data.participants.some((p) => p.queues.strict.eligible);
  const strictHasRankedMatchIssue = data.participants.some((p) =>
    Array.isArray(p.queues.strict.ineligibleReasons) &&
    p.queues.strict.ineligibleReasons.some((r) => typeof r === 'string' && r.startsWith('ranked-match')),
  );
  const hasRankedMatchMeta = (() => {
    const raw = (data as any)?.snapshot?.extraJson;
    if (typeof raw !== 'string' || !raw.trim()) return false;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return Boolean(parsed && typeof parsed === 'object' && ('rankedMatchId' in parsed || 'rankedMatchOk' in parsed || 'rankedMatchReason' in parsed));
    } catch {
      return raw.includes('rankedMatch');
    }
  })();
  if (!strictEligible && !strictHasRankedMatchIssue && !hasRankedMatchMeta) return null;

  const strictQueue = data.participants.find((p) => p.queues.strict.eligible)?.queues.strict ?? null;
  const statusText = strictQueue ? formatStrictEventStatus(strictQueue.eventStatus, strictQueue.skipReason) : '结算中…';
  const ineligibleText = !strictEligible
    ? formatIneligibleReasons(Array.from(new Set(data.participants.flatMap((p) => p.queues.strict.ineligibleReasons ?? []))))
    : null;

  return (
    <div className="mt-4 rounded-xl border border-white/15 bg-black/15 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-gray-100">严格排位</div>
        <div className="text-xs text-gray-300">{strictEligible ? statusText : '不计分'}</div>
      </div>

      {error ? <div className="mt-2 text-xs text-red-200">排位信息加载失败：{error}</div> : null}
      {!strictEligible && ineligibleText ? (
        <div className="mt-2 text-xs text-gray-200">
          原因：<span className="text-gray-100">{ineligibleText}</span>
        </div>
      ) : null}
      <div className="mt-2 text-xs text-gray-200">
        查看百科：<Link href="/encyclopedia/ranking" className="text-blue-200 hover:underline">排位与排行榜</Link>
      </div>

      <div className="mt-3 grid gap-3">
        {data.participants.map((p, idx) => {
          const q = p.queues.strict;
          const ratingText = typeof q.rating === 'number' ? String(q.rating) : '—';
          const deltaText = typeof q.delta === 'number' ? formatSigned(q.delta) : null;
          const hasRank = typeof q.rank === 'number' && typeof q.total === 'number' && q.total > 0;
          const rankText = hasRank ? `#${q.rank}/${q.total}` : '—';
          const rankDelta = typeof q.rankDelta === 'number' ? formatRankDelta(q.rankDelta) : null;

          return (
            <div key={`${idx}-${p.displayName}`} className="rounded-lg border border-white/10 bg-black/10 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="font-semibold text-gray-100 truncate">{p.displayName}</div>
                <div className="flex items-center gap-2 shrink-0">
                  <TechBadge techScore={p.techScore} techLevel={p.techLevel} className="text-xs text-gray-100" />
                  {typeof q.tier === 'string' && q.tier.trim() ? <TierBadge tier={q.tier} /> : null}
                </div>
              </div>

              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-200">
                <span>
                  排位分：<span className="font-mono">{ratingText}</span>
                  {deltaText ? (
                    <span className={q.delta != null && q.delta >= 0 ? 'text-emerald-300' : 'text-red-300'} title="本局排位分变化">
                      {' '}
                      (Δ{deltaText})
                    </span>
                  ) : null}
                </span>
                <span>
                  排名：<span className="font-mono">{rankText}</span>
                  {rankDelta ? (
                    <span className={rankDelta.className} title={rankDelta.title}>
                      {' '}
                      ({rankDelta.text})
                    </span>
                  ) : null}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
