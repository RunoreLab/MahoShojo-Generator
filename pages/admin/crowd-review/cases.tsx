import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import type { AdminCrowdReviewCaseDetailDto, AdminCrowdReviewCaseListItem } from '@/lib/admin/governance';

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

export default function AdminCrowdReviewCasesPage() {
  const [items, setItems] = useState<AdminCrowdReviewCaseListItem[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminCrowdReviewCaseDetailDto | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams();
    if (status) params.set('status', status);

    (async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/admin/crowd-review/cases?${params.toString()}`);
        const payload = (await response.json()) as { items?: AdminCrowdReviewCaseListItem[] };
        if (!active) return;
        setItems(Array.isArray(payload.items) ? payload.items : []);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [status]);

  useEffect(() => {
    if (!selectedRoundId) {
      setDetail(null);
      return;
    }

    let active = true;
    (async () => {
      setDetailLoading(true);
      try {
        const response = await fetch(`/api/admin/crowd-review/cases/${encodeURIComponent(selectedRoundId)}`);
        if (!response.ok) {
          if (!active) return;
          setDetail(null);
          return;
        }
        const payload = (await response.json()) as AdminCrowdReviewCaseDetailDto;
        if (active) setDetail(payload);
      } finally {
        if (active) setDetailLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [selectedRoundId]);

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
              查看众查轮次状态、投票/派单明细、目标卡和案件联动。管理员接管、撤销轮次和改判动作已预留入口。
            </p>
            <div className="mt-4 w-full max-w-xs">
              <label className="mb-1 block text-sm font-medium text-gray-700">轮次状态</label>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              >
                <option value="">全部状态</option>
                <option value="pending_dispatch">pending_dispatch</option>
                <option value="active">active</option>
                <option value="waiting_more_votes">waiting_more_votes</option>
                <option value="concluded">concluded</option>
                <option value="escalated">escalated</option>
                <option value="cancelled">cancelled</option>
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
                        <td className="px-4 py-3">{item.status}</td>
                        <td className="px-4 py-3">
                          已投 {item.votedCount} / 总派单 {item.assignmentCount} / 进行中 {item.activeAssignmentCount}
                        </td>
                        <td className="px-4 py-3 text-gray-500">{formatDateTime(item.deadlineAt)}</td>
                        <td className="px-4 py-3">
                          <div>{item.resultCode ?? '—'}</div>
                          <div className="mt-1 text-xs text-gray-500">minValidVotes={item.minValidVotes}</div>
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
              ) : !detail ? (
                <div className="rounded-xl border border-dashed border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
                  轮次详情加载失败或已不存在。
                </div>
              ) : (
                <>
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">
                      {detail.targetCardName ?? detail.targetCardId ?? detail.roundId}
                    </h2>
                    <p className="mt-1 text-xs text-gray-500">
                      round #{detail.roundId} · case #{detail.reportCaseId} · 作者 {detail.targetUsername ?? '未知'}
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl bg-gray-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-gray-500">轮次状态</div>
                      <div className="mt-2 text-sm text-gray-900">{detail.status}</div>
                      <div className="mt-2 text-xs text-gray-500">开始：{formatDateTime(detail.openedAt)}</div>
                      <div className="mt-1 text-xs text-gray-500">截止：{formatDateTime(detail.deadlineAt)}</div>
                    </div>
                    <div className="rounded-xl bg-gray-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-gray-500">投票统计</div>
                      <div className="mt-2 text-sm text-gray-900">
                        已投 {detail.votedCount} / 派单 {detail.assignmentCount}
                      </div>
                      <div className="mt-2 text-xs text-gray-500">进行中：{detail.activeAssignmentCount}</div>
                      <div className="mt-1 text-xs text-gray-500">
                        结果：{detail.resultCode ?? '—'} · minValidVotes={detail.minValidVotes}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <h3 className="text-sm font-semibold text-amber-900">管理员动作入口</h3>
                    <p className="mt-2 text-xs text-amber-800">
                      管理员接管、撤销轮次、改判和留痕 API 尚未在本轮完全开放；当前页面先提供详情视图和后续动作位置。
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" disabled className="rounded-lg bg-white px-3 py-1.5 text-xs text-amber-700 opacity-70">
                        接管轮次（待接入）
                      </button>
                      <button type="button" disabled className="rounded-lg bg-white px-3 py-1.5 text-xs text-amber-700 opacity-70">
                        撤销轮次（待接入）
                      </button>
                      <button type="button" disabled className="rounded-lg bg-white px-3 py-1.5 text-xs text-amber-700 opacity-70">
                        改判留痕（待接入）
                      </button>
                    </div>
                  </div>

                  <div className="rounded-xl border border-gray-200 p-4">
                    <h3 className="text-sm font-semibold text-gray-900">结果摘要</h3>
                    <pre className="mt-3 max-h-52 overflow-auto rounded-lg bg-gray-50 p-3 text-xs text-gray-700">
                      {stringifySummary(detail.resultSummary)}
                    </pre>
                  </div>

                  <div className="rounded-xl border border-gray-200 p-4">
                    <h3 className="text-sm font-semibold text-gray-900">派单与投票</h3>
                    <div className="mt-3 overflow-x-auto">
                      <table className="min-w-full text-left text-xs">
                        <thead className="text-gray-500">
                          <tr>
                            <th className="py-2 pr-3">巡查使</th>
                            <th className="py-2 pr-3">状态</th>
                            <th className="py-2 pr-3">投票</th>
                            <th className="py-2 pr-3">完成</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.assignments.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="py-6 text-center text-gray-500">
                                暂无派单。
                              </td>
                            </tr>
                          ) : (
                            detail.assignments.map((assignment) => (
                              <tr key={assignment.assignmentId} className="border-t border-gray-100">
                                <td className="py-2 pr-3">
                                  {assignment.inspectorUsername ?? `user #${assignment.inspectorUserId}`}
                                  <div className="text-[11px] text-gray-400">#{assignment.assignmentId}</div>
                                </td>
                                <td className="py-2 pr-3">{assignment.status}</td>
                                <td className="py-2 pr-3">
                                  <div>{assignment.decision ?? '—'}</div>
                                  {assignment.decisionNote ? (
                                    <div className="mt-1 max-w-[180px] text-[11px] text-gray-500">{assignment.decisionNote}</div>
                                  ) : null}
                                </td>
                                <td className="py-2 pr-3">{formatDateTime(assignment.completedAt)}</td>
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
