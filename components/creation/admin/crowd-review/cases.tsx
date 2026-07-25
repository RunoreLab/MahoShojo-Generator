import Head from 'next/head';
import Link from 'next/link';
import { usePagesRouterCompat as useRouter } from '@/lib/admin/pages-router-compat';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AdminCrowdReviewCaseDetailDto, AdminCrowdReviewCaseListItem } from '@/lib/admin/governance';
import {
  getCrowdReviewVoteAuditResult,
  summarizeCrowdReviewVotes,
  type CrowdReviewVoteAuditTone,
} from '@/lib/admin/crowd-review-audit';
import {
  getCrowdReviewAssignmentStatusLabel,
  getCrowdReviewDecisionLabel,
  getCrowdReviewResultCodeLabel,
  getCrowdReviewRoundStatusLabel,
} from '@/lib/admin/governance-labels';

const formatDateTime = (value: string | null | undefined): string => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const stringifySummary = (value: Record<string, unknown>): string => {
  const keys = Object.keys(value);
  if (keys.length === 0) return '{}';
  return JSON.stringify(value, null, 2);
};

const getVoteAuditToneClasses = (tone: CrowdReviewVoteAuditTone): string => {
  if (tone === 'positive') return 'bg-emerald-100 text-emerald-700';
  if (tone === 'negative') return 'bg-rose-100 text-rose-700';
  if (tone === 'warning') return 'bg-amber-100 text-amber-700';
  if (tone === 'pending') return 'bg-sky-100 text-sky-700';
  return 'bg-slate-100 text-slate-700';
};

const STATUS_FILTER_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'pending_dispatch', label: getCrowdReviewRoundStatusLabel('pending_dispatch') },
  { value: 'active', label: getCrowdReviewRoundStatusLabel('active') },
  { value: 'waiting_more_votes', label: getCrowdReviewRoundStatusLabel('waiting_more_votes') },
  { value: 'concluded', label: getCrowdReviewRoundStatusLabel('concluded') },
  { value: 'escalated', label: getCrowdReviewRoundStatusLabel('escalated') },
  { value: 'cancelled', label: getCrowdReviewRoundStatusLabel('cancelled') },
] as const;

export default function AdminCrowdReviewCasesPage() {
  const router = useRouter();
  const [items, setItems] = useState<AdminCrowdReviewCaseListItem[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminCrowdReviewCaseDetailDto | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const detailRequestIdRef = useRef(0);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [actionSubmitting, setActionSubmitting] = useState<'take-over' | 'cancel' | 'override' | null>(null);
  const [takeOverReason, setTakeOverReason] = useState('管理员接管处理');
  const [cancelReason, setCancelReason] = useState('管理员撤销当前众查轮次');
  const [overrideDecision, setOverrideDecision] = useState<'violation' | 'no_violation' | 'reopen_under_review'>(
    'violation',
  );
  const [overrideReason, setOverrideReason] = useState('管理员改判');

  const loadRoundList = useCallback(async () => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);

    setLoading(true);
    try {
      const response = await fetch(`/api/admin/crowd-review/cases?${params.toString()}`);
      const payload = (await response.json()) as { items?: AdminCrowdReviewCaseListItem[] };
      setItems(Array.isArray(payload.items) ? payload.items : []);
    } finally {
      setLoading(false);
    }
  }, [status]);

  const loadRoundDetail = useCallback(async (roundId: string) => {
    const requestId = detailRequestIdRef.current + 1;
    detailRequestIdRef.current = requestId;
    setDetailLoading(true);
    setActionFeedback(null);
    try {
      const response = await fetch(`/api/admin/crowd-review/cases/${encodeURIComponent(roundId)}`);
      if (detailRequestIdRef.current !== requestId) {
        return;
      }
      if (!response.ok) {
        setDetail(null);
        return;
      }
      const payload = (await response.json()) as AdminCrowdReviewCaseDetailDto;
      if (detailRequestIdRef.current !== requestId) {
        return;
      }
      setDetail(payload);
    } finally {
      if (detailRequestIdRef.current === requestId) {
        setDetailLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        await loadRoundList();
        if (!active) return;
      } finally {
        if (!active) return;
      }
    })();

    return () => {
      active = false;
    };
  }, [loadRoundList]);

  useEffect(() => {
    if (!selectedRoundId) {
      detailRequestIdRef.current += 1;
      setDetail(null);
      setActionFeedback(null);
      return;
    }

    setDetail(null);
    setActionFeedback(null);
    setTakeOverReason('管理员接管处理');
    setCancelReason('管理员撤销当前众查轮次');
    setOverrideDecision('violation');
    setOverrideReason('管理员改判');
    let active = true;
    (async () => {
      try {
        await loadRoundDetail(selectedRoundId);
      } finally {
        if (!active) return;
      }
    })();

    return () => {
      active = false;
    };
  }, [loadRoundDetail, selectedRoundId]);

  useEffect(() => {
    if (!router.isReady) return;
    const roundId = typeof router.query.roundId === 'string' ? router.query.roundId.trim() : '';
    if (!roundId || roundId === selectedRoundId) return;
    setSelectedRoundId(roundId);
  }, [router.isReady, router.query.roundId, selectedRoundId]);

  const activeDetail = detail && detail.roundId === selectedRoundId ? detail : null;
  const activeVoteSummary = useMemo(
    () => (activeDetail ? summarizeCrowdReviewVotes(activeDetail.assignments) : null),
    [activeDetail],
  );
  const activeAssignmentAudits = useMemo(
    () =>
      activeDetail
        ? activeDetail.assignments.map((assignment) => ({
            assignment,
            audit: getCrowdReviewVoteAuditResult({
              assignment,
              roundStatus: activeDetail.status,
              resultCode: activeDetail.resultCode,
              reportCaseResolutionCode: activeDetail.reportCaseResolutionCode,
            }),
          }))
        : [],
    [activeDetail],
  );

  const runRoundAction = async (
    action: 'take-over' | 'cancel' | 'override',
    payload: Record<string, unknown>,
  ) => {
    const roundId = activeDetail?.roundId;
    if (!roundId) return;

    setActionSubmitting(action);
    setActionFeedback(null);
    try {
      const response = await fetch(
        `/api/admin/crowd-review/cases/${encodeURIComponent(roundId)}/${action}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const result = (await response.json()) as {
        error?: string;
        roundStatus?: string;
        reportCaseStatus?: string;
        revokedAssignmentsCount?: number;
      };
      if (!response.ok) {
        setActionFeedback(result.error ?? '众查动作执行失败');
        return;
      }

      await Promise.all([loadRoundList(), loadRoundDetail(roundId)]);
      setActionFeedback(
        `操作已完成：轮次 ${result.roundStatus ?? '已更新'}，案件 ${result.reportCaseStatus ?? '已更新'}，撤销派单 ${result.revokedAssignmentsCount ?? 0} 条。`,
      );
    } finally {
      setActionSubmitting(null);
    }
  };

  return (
    <>
      <Head>
        <title>众查案件 - Admin</title>
      </Head>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="mx-auto max-w-7xl space-y-4">
          <Link href="/admin" className="text-sm text-purple-600 hover:underline">
            &larr; 返回管理后台主页
          </Link>
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h1 className="text-2xl font-bold text-gray-900">众查案件</h1>
            <p className="mt-3 text-sm leading-6 text-gray-600">
              查看众查轮次状态、投票/派单明细、目标卡和案件联动，并可直接执行接管、撤销和管理员改判。
            </p>
            <div className="mt-4 w-full max-w-xs">
              <label className="mb-1 block text-sm font-medium text-gray-700">轮次状态</label>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              >
                {STATUS_FILTER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(380px,0.95fr)]">
            <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-4 py-3">轮次 / 目标</th>
                    <th className="px-4 py-3">状态</th>
                    <th className="px-4 py-3">票数</th>
                    <th className="px-4 py-3">截止</th>
                    <th className="px-4 py-3">结果</th>
                    <th className="px-4 py-3">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                        加载中...
                      </td>
                    </tr>
                  ) : items.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                        暂无众查轮次
                      </td>
                    </tr>
                  ) : (
                    items.map((item) => (
                      <tr
                        key={item.roundId}
                        className={`border-t ${selectedRoundId === item.roundId ? 'bg-violet-50/60' : ''}`}
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{item.targetCardName ?? item.targetCardId ?? '未知目标'}</div>
                          <div className="mt-1 text-xs text-gray-500">
                            round #{item.roundId} · case #{item.reportCaseId}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div>{getCrowdReviewRoundStatusLabel(item.status)}</div>
                          <div className="mt-1 text-[11px] text-gray-400">{item.status}</div>
                        </td>
                        <td className="px-4 py-3">
                          已投 {item.votedCount} / 总派单 {item.assignmentCount} / 进行中 {item.activeAssignmentCount}
                        </td>
                        <td className="px-4 py-3 text-gray-500">{formatDateTime(item.deadlineAt)}</td>
                        <td className="px-4 py-3">
                          <div>{item.resultCode ? getCrowdReviewResultCodeLabel(item.resultCode) : '—'}</div>
                          <div className="mt-1 text-xs text-gray-500">minValidVotes={item.minValidVotes}</div>
                          <div className="mt-1 text-[11px] text-gray-400">{item.resultCode ?? '—'}</div>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => setSelectedRoundId(item.roundId)}
                            className="rounded-lg border border-violet-200 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-50"
                          >
                            查看详情
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="space-y-4 rounded-2xl bg-white p-5 shadow-sm">
              {!selectedRoundId ? (
                <div className="rounded-xl border border-dashed border-gray-200 p-6 text-sm text-gray-500">
                  选择一个众查轮次后，可查看派单明细、投票结果和管理员动作入口。
                </div>
              ) : detailLoading ? (
                <div className="rounded-xl border border-dashed border-gray-200 p-6 text-sm text-gray-500">
                  正在加载轮次详情...
                </div>
              ) : !activeDetail ? (
                <div className="rounded-xl border border-dashed border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
                  轮次详情加载失败或已不存在。
                </div>
              ) : (
                <>
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">
                      {activeDetail.targetCardName ?? activeDetail.targetCardId ?? activeDetail.roundId}
                    </h2>
                    <p className="mt-1 text-xs text-gray-500">
                      round #{activeDetail.roundId} · case #{activeDetail.reportCaseId} · 作者 {activeDetail.targetUsername ?? '未知'}
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl bg-gray-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-gray-500">轮次状态</div>
                      <div className="mt-2 text-sm text-gray-900">{getCrowdReviewRoundStatusLabel(activeDetail.status)}</div>
                      <div className="mt-1 text-xs text-gray-400">{activeDetail.status}</div>
                      <div className="mt-2 text-xs text-gray-500">开始：{formatDateTime(activeDetail.openedAt)}</div>
                      <div className="mt-1 text-xs text-gray-500">截止：{formatDateTime(activeDetail.deadlineAt)}</div>
                    </div>
                    <div className="rounded-xl bg-gray-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-gray-500">投票统计</div>
                      <div className="mt-2 text-sm text-gray-900">
                        已投 {activeDetail.votedCount} / 派单 {activeDetail.assignmentCount}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-rose-700">
                          违规票 {activeVoteSummary?.violationVoteCount ?? 0}
                        </span>
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700">
                          不违规票 {activeVoteSummary?.noViolationVoteCount ?? 0}
                        </span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">
                          弃权 {activeVoteSummary?.abstainCount ?? 0}
                        </span>
                        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-sky-700">
                          待处理 {activeVoteSummary?.pendingCount ?? 0}
                        </span>
                      </div>
                      <div className="mt-2 text-xs text-gray-500">进行中：{activeDetail.activeAssignmentCount}</div>
                      <div className="mt-1 text-xs text-gray-500">
                        结果：{activeDetail.resultCode ? getCrowdReviewResultCodeLabel(activeDetail.resultCode) : '—'} · minValidVotes={activeDetail.minValidVotes}
                      </div>
                      <div className="mt-1 text-[11px] text-gray-400">{activeDetail.resultCode ?? '—'}</div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <h3 className="text-sm font-semibold text-amber-900">管理员动作入口</h3>
                    <p className="mt-2 text-xs text-amber-800">
                      接管会将轮次升级为管理员处理；撤销会终止当前众查；改判会以管理员结论覆盖本轮结果。
                    </p>
                    <div className="mt-3 grid gap-3">
                      <div className="rounded-lg border border-amber-200 bg-white p-3">
                        <div className="text-sm font-medium text-amber-900">接管轮次</div>
                        <textarea
                          value={takeOverReason}
                          onChange={(event) => setTakeOverReason(event.target.value)}
                          rows={2}
                          className="mt-2 w-full rounded-lg border border-amber-200 px-3 py-2 text-sm"
                          placeholder="填写管理员接管说明"
                        />
                        <button
                          type="button"
                          onClick={() => void runRoundAction('take-over', { reasonDetail: takeOverReason })}
                          disabled={actionSubmitting !== null}
                          className="mt-3 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                        >
                          {actionSubmitting === 'take-over' ? '处理中...' : '接管轮次'}
                        </button>
                      </div>
                      <div className="rounded-lg border border-amber-200 bg-white p-3">
                        <div className="text-sm font-medium text-amber-900">撤销轮次</div>
                        <textarea
                          value={cancelReason}
                          onChange={(event) => setCancelReason(event.target.value)}
                          rows={2}
                          className="mt-2 w-full rounded-lg border border-amber-200 px-3 py-2 text-sm"
                          placeholder="填写撤销原因"
                        />
                        <button
                          type="button"
                          onClick={() => void runRoundAction('cancel', { reasonDetail: cancelReason })}
                          disabled={actionSubmitting !== null}
                          className="mt-3 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-amber-800 ring-1 ring-amber-300 disabled:opacity-60"
                        >
                          {actionSubmitting === 'cancel' ? '处理中...' : '撤销轮次'}
                        </button>
                      </div>
                      <div className="rounded-lg border border-amber-200 bg-white p-3">
                        <div className="text-sm font-medium text-amber-900">管理员改判</div>
                        <div className="mt-2 grid gap-2 md:grid-cols-2">
                          <select
                            value={overrideDecision}
                            onChange={(event) =>
                              setOverrideDecision(
                                event.target.value as 'violation' | 'no_violation' | 'reopen_under_review',
                              )
                            }
                            className="rounded-lg border border-amber-200 px-3 py-2 text-sm"
                          >
                            <option value="violation">改判：违规成立</option>
                            <option value="no_violation">改判：不构成违规</option>
                            <option value="reopen_under_review">改判：转回人工复核</option>
                          </select>
                          <input
                            value={overrideReason}
                            onChange={(event) => setOverrideReason(event.target.value)}
                            className="rounded-lg border border-amber-200 px-3 py-2 text-sm"
                            placeholder="管理员改判说明"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            void runRoundAction('override', {
                              caseDecision: overrideDecision,
                              reasonDetail: overrideReason,
                            })
                          }
                          disabled={actionSubmitting !== null}
                          className="mt-3 rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                        >
                          {actionSubmitting === 'override' ? '处理中...' : '提交管理员改判'}
                        </button>
                      </div>
                    </div>
                    {actionFeedback ? <div className="mt-3 text-xs text-amber-900">{actionFeedback}</div> : null}
                  </div>

                  <div className="rounded-xl border border-gray-200 p-4">
                    <h3 className="text-sm font-semibold text-gray-900">结果摘要</h3>
                    <pre className="mt-3 max-h-52 overflow-auto rounded-lg bg-gray-50 p-3 text-xs text-gray-700">
                      {stringifySummary(activeDetail.resultSummary)}
                    </pre>
                  </div>

                  <div className="rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900">投票审计明细</h3>
                        <p className="mt-1 text-xs text-gray-500">
                          可直接查看每位巡查使的派单状态、投票方向、备注与是否和本轮最终方向一致。
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 overflow-x-auto">
                      <table className="min-w-full text-left text-xs">
                        <thead className="text-gray-500">
                          <tr>
                            <th className="py-2 pr-3">巡查使</th>
                            <th className="py-2 pr-3">状态</th>
                            <th className="py-2 pr-3">投票</th>
                            <th className="py-2 pr-3">审计结论</th>
                            <th className="py-2 pr-3">时间</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeAssignmentAudits.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="py-6 text-center text-gray-500">
                                暂无派单。
                              </td>
                            </tr>
                          ) : (
                            activeAssignmentAudits.map(({ assignment, audit }) => (
                              <tr key={assignment.assignmentId} className="border-t border-gray-100">
                                <td className="py-2 pr-3">
                                  {assignment.inspectorUsername ?? `user #${assignment.inspectorUserId}`}
                                  <div className="text-[11px] text-gray-400">user #{assignment.inspectorUserId}</div>
                                  {assignment.inspectorEmail ? (
                                    <div className="text-[11px] text-gray-400">{assignment.inspectorEmail}</div>
                                  ) : null}
                                  <div className="text-[11px] text-gray-400">#{assignment.assignmentId}</div>
                                </td>
                                <td className="py-2 pr-3">
                                  <div>{getCrowdReviewAssignmentStatusLabel(assignment.status)}</div>
                                  <div className="mt-1 text-[11px] text-gray-400">{assignment.status}</div>
                                  <div className="mt-2 text-[11px] text-gray-500">
                                    派单 {formatDateTime(assignment.assignedAt)}
                                  </div>
                                  <div className="mt-1 text-[11px] text-gray-500">
                                    截止 {formatDateTime(assignment.expiresAt)}
                                  </div>
                                </td>
                                <td className="py-2 pr-3">
                                  <div>{assignment.decision ? getCrowdReviewDecisionLabel(assignment.decision) : '—'}</div>
                                  {assignment.decisionNote ? (
                                    <div className="mt-1 max-w-[220px] text-[11px] text-gray-500">{assignment.decisionNote}</div>
                                  ) : null}
                                  {typeof assignment.postVoteSummary.summaryText === 'string' ? (
                                    <div className="mt-1 max-w-[220px] text-[11px] text-gray-400">
                                      {assignment.postVoteSummary.summaryText}
                                    </div>
                                  ) : null}
                                </td>
                                <td className="py-2 pr-3">
                                  <div
                                    className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${getVoteAuditToneClasses(audit.tone)}`}
                                  >
                                    {audit.label}
                                  </div>
                                  <div className="mt-1 max-w-[220px] text-[11px] text-gray-500">{audit.detail}</div>
                                </td>
                                <td className="py-2 pr-3">
                                  <div>完成 {formatDateTime(assignment.completedAt)}</div>
                                  <div className="mt-1 text-[11px] text-gray-500">
                                    已读回执 {formatDateTime(assignment.postVoteSummarySeenAt)}
                                  </div>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
