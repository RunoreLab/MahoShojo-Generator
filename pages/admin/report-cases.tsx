import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import type { AdminReportCaseDetailDto, AdminReportCaseListItem } from '@/lib/admin/governance';

const formatDateTime = (value: string | null | undefined): string => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const formatList = (items: string[]): string => (items.length > 0 ? items.join('；') : '—');

export default function AdminReportCasesPage() {
  const [items, setItems] = useState<AdminReportCaseListItem[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminReportCaseDetailDto | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [sendMessage, setSendMessage] = useState(true);
  const [notifyReason, setNotifyReason] = useState('');
  const [notifySubmitting, setNotifySubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams();
    if (status) params.set('status', status);

    (async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/admin/report-cases?${params.toString()}`);
        const payload = (await response.json()) as { items?: AdminReportCaseListItem[] };
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
    if (!selectedCaseId) {
      setDetail(null);
      return;
    }

    let active = true;
    (async () => {
      setDetailLoading(true);
      setFeedback(null);
      try {
        const response = await fetch(`/api/admin/report-cases/${encodeURIComponent(selectedCaseId)}`);
        if (!response.ok) {
          if (!active) return;
          setDetail(null);
          return;
        }
        const payload = (await response.json()) as AdminReportCaseDetailDto;
        if (!active) return;
        setDetail(payload);
        setNotifyReason(payload.aggregatedSummary.detailsPreview ?? payload.aggregatedSummary.reasonLabels.join('；'));
      } finally {
        if (active) setDetailLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [selectedCaseId]);

  const handleNotifyCreator = async () => {
    if (!selectedCaseId) return;

    setNotifySubmitting(true);
    setFeedback(null);
    try {
      const response = await fetch(`/api/admin/report-cases/${encodeURIComponent(selectedCaseId)}/notify-creator`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sendMessage,
          reason: notifyReason,
        }),
      });
      const payload = (await response.json()) as
        | { error?: string }
        | {
            creatorNotifiedAt: string | null;
            sentMessage: boolean;
            messageId: number | null;
          };

      if (!response.ok) {
        setFeedback((payload as { error?: string }).error ?? '发送创作者通知失败');
        return;
      }

      const notifyPayload = payload as {
        creatorNotifiedAt: string | null;
        sentMessage: boolean;
        messageId: number | null;
      };

      setItems((current) =>
        current.map((item) =>
          item.reportCaseId === selectedCaseId
            ? {
                ...item,
                creatorNotifiedAt: notifyPayload.creatorNotifiedAt,
              }
            : item,
        ),
      );
      setDetail((current) =>
        current && current.reportCaseId === selectedCaseId
          ? {
              ...current,
              creatorNotifiedAt: notifyPayload.creatorNotifiedAt,
            }
          : current,
      );
      setFeedback(
        notifyPayload.sentMessage
          ? `已发送创作者通知消息${notifyPayload.messageId ? ` #${notifyPayload.messageId}` : ''}`
          : '已记录创作者通知时间',
      );
    } finally {
      setNotifySubmitting(false);
    }
  };

  return (
    <>
      <Head>
        <title>举报案件 - Admin</title>
      </Head>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="mx-auto max-w-7xl space-y-4">
          <Link href="/admin" className="text-sm text-purple-600 hover:underline">
            &larr; 返回管理后台主页
          </Link>
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h1 className="text-2xl font-bold text-gray-900">举报案件</h1>
            <p className="mt-3 text-sm leading-6 text-gray-600">
              查看案件状态、举报材料快照、当前卡版本、众查与申诉联动，并可直接给作者发送处理说明。
            </p>
            <div className="mt-4 w-full max-w-xs">
              <label className="mb-1 block text-sm font-medium text-gray-700">状态筛选</label>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              >
                <option value="">全部状态</option>
                <option value="open">open</option>
                <option value="under_review">under_review</option>
                <option value="resolved">resolved</option>
                <option value="dismissed">dismissed</option>
              </select>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
            <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-4 py-3">案件 / 目标</th>
                    <th className="px-4 py-3">状态</th>
                    <th className="px-4 py-3">有效举报</th>
                    <th className="px-4 py-3">治理联动</th>
                    <th className="px-4 py-3">时间</th>
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
                        暂无案件
                      </td>
                    </tr>
                  ) : (
                    items.map((item) => (
                      <tr
                        key={item.reportCaseId}
                        className={`border-t ${selectedCaseId === item.reportCaseId ? 'bg-violet-50/60' : ''}`}
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{item.targetCardName ?? item.targetCardId ?? '未知目标'}</div>
                          <div className="mt-1 text-xs text-gray-500">
                            case #{item.reportCaseId}
                            {item.targetUsername ? ` · 作者 ${item.targetUsername}` : ''}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div>{item.status}</div>
                          <div className="mt-1 text-xs text-gray-500">{item.resolutionCode ?? '—'}</div>
                        </td>
                        <td className="px-4 py-3">{item.activeReportCount}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {item.hasActiveCrowdReview ? (
                              <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] text-violet-700">众查中</span>
                            ) : null}
                            {item.hasActiveAppeal ? (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-700">活跃申诉</span>
                            ) : null}
                            {item.isSelfRemediationCandidate ? (
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-700">自整改候选</span>
                            ) : null}
                            {item.creatorNotifiedAt ? (
                              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] text-sky-700">已通知作者</span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-500">{formatDateTime(item.updatedAt)}</td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => setSelectedCaseId(item.reportCaseId)}
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
              {!selectedCaseId ? (
                <div className="rounded-xl border border-dashed border-gray-200 p-6 text-sm text-gray-500">
                  从左侧列表选择案件后，可查看举报材料、当前卡版本、众查/申诉摘要，并向作者发送治理说明。
                </div>
              ) : detailLoading ? (
                <div className="rounded-xl border border-dashed border-gray-200 p-6 text-sm text-gray-500">
                  正在加载案件详情...
                </div>
              ) : !detail ? (
                <div className="rounded-xl border border-dashed border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
                  案件详情加载失败或已不存在。
                </div>
              ) : (
                <>
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">
                      {detail.targetCardName ?? detail.targetCardId ?? detail.reportCaseId}
                    </h2>
                    <p className="mt-1 text-xs text-gray-500">
                      case #{detail.reportCaseId} · 作者 {detail.targetUsername ?? '未知'} · 最近举报 {formatDateTime(detail.latestReportedAt)}
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl bg-gray-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-gray-500">案件状态</div>
                      <div className="mt-2 text-sm text-gray-900">
                        {detail.status} / {detail.resolutionCode ?? '未结案'}
                      </div>
                      <div className="mt-2 text-xs text-gray-500">
                        作者通知：{formatDateTime(detail.creatorNotifiedAt)}
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        结案通知：{formatDateTime(detail.resolutionNotifiedAt)}
                      </div>
                    </div>
                    <div className="rounded-xl bg-gray-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-gray-500">治理摘要</div>
                      <div className="mt-2 text-sm text-gray-900">理由：{formatList(detail.aggregatedSummary.reasonLabels)}</div>
                      <div className="mt-2 text-xs text-gray-500">引用：{formatList(detail.aggregatedSummary.referenceSummary)}</div>
                      <div className="mt-2 text-xs text-gray-500">
                        补充说明：{detail.aggregatedSummary.detailsPreview ?? '—'}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-gray-900">作者通知</h3>
                      <label className="flex items-center gap-2 text-xs text-gray-600">
                        <input
                          type="checkbox"
                          checked={sendMessage}
                          onChange={(event) => setSendMessage(event.target.checked)}
                        />
                        同时发送站内消息
                      </label>
                    </div>
                    <textarea
                      value={notifyReason}
                      onChange={(event) => setNotifyReason(event.target.value)}
                      rows={4}
                      className="mt-3 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                      placeholder="可直接复用 AI / 举报摘要，也可手动补充管理员说明。"
                    />
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <div className="text-xs text-gray-500">
                        若勾选发送消息，将把该说明写入给作者的处理通知中。
                      </div>
                      <button
                        type="button"
                        disabled={notifySubmitting}
                        onClick={handleNotifyCreator}
                        className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                      >
                        {notifySubmitting ? '处理中...' : sendMessage ? '发送并记录' : '仅记录已通知'}
                      </button>
                    </div>
                    {feedback ? <div className="mt-3 text-xs text-violet-700">{feedback}</div> : null}
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-xl border border-gray-200 p-4">
                      <h3 className="text-sm font-semibold text-gray-900">当前目标卡</h3>
                      <div className="mt-2 text-sm text-gray-700">
                        {detail.currentTargetCard.name ?? '未知'} · {detail.currentTargetCard.reviewStatus ?? '—'}
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        更新时间：{formatDateTime(detail.currentTargetCard.updatedAt)}
                      </div>
                      <pre className="mt-3 max-h-56 overflow-auto rounded-lg bg-gray-50 p-3 text-xs text-gray-700">
                        {detail.currentTargetCard.dataPreview ?? '暂无当前卡内容预览'}
                      </pre>
                    </div>
                    <div className="rounded-xl border border-gray-200 p-4">
                      <h3 className="text-sm font-semibold text-gray-900">最近举报快照</h3>
                      <div className="mt-2 text-sm text-gray-700">{detail.latestTargetSnapshot?.name ?? '暂无快照'}</div>
                      <div className="mt-1 text-xs text-gray-500">
                        快照时间：{formatDateTime(detail.latestTargetSnapshot?.updatedAt)}
                      </div>
                      <pre className="mt-3 max-h-56 overflow-auto rounded-lg bg-gray-50 p-3 text-xs text-gray-700">
                        {detail.latestTargetSnapshot?.dataPreview ?? '暂无快照内容预览'}
                      </pre>
                    </div>
                  </div>

                  <div className="rounded-xl border border-gray-200 p-4">
                    <h3 className="text-sm font-semibold text-gray-900">活跃举报材料</h3>
                    <div className="mt-3 space-y-3">
                      {detail.activeReports.length === 0 ? (
                        <div className="text-sm text-gray-500">暂无活跃举报。</div>
                      ) : (
                        detail.activeReports.map((report) => (
                          <div key={report.reportId} className="rounded-xl bg-gray-50 p-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-gray-900">{report.reasonLabel}</span>
                              <span className="text-xs text-gray-500">
                                reporter #{report.reporterUserId}
                                {report.reporterUsername ? ` · ${report.reporterUsername}` : ''}
                              </span>
                            </div>
                            <div className="mt-2 text-xs text-gray-500">
                              {formatDateTime(report.createdAt)} · {report.evidenceSummary.detailsPreview ?? '无补充说明'}
                            </div>
                            <div className="mt-2 text-xs text-gray-600">
                              引用：{formatList(report.evidenceSummary.referenceSummary)}
                            </div>
                            {report.references.length > 0 ? (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {report.references.map((reference) => (
                                  <span
                                    key={`${report.reportId}:${reference.referenceType}:${reference.referenceId}`}
                                    className="rounded-full bg-white px-2 py-1 text-[11px] text-gray-600"
                                  >
                                    {reference.labelSnapshot}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-xl border border-gray-200 p-4">
                      <h3 className="text-sm font-semibold text-gray-900">众查轮次</h3>
                      <div className="mt-3 space-y-2">
                        {detail.crowdReviewRounds.length === 0 ? (
                          <div className="text-sm text-gray-500">暂无众查轮次。</div>
                        ) : (
                          detail.crowdReviewRounds.map((round) => (
                            <div key={round.roundId} className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
                              <div className="font-medium">
                                round #{round.roundId} · {round.status}
                              </div>
                              <div className="mt-1 text-xs text-gray-500">
                                截止 {formatDateTime(round.deadlineAt)} · 结果 {round.resultCode ?? '—'}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                    <div className="rounded-xl border border-gray-200 p-4">
                      <h3 className="text-sm font-semibold text-gray-900">关联申诉</h3>
                      <div className="mt-3 space-y-2">
                        {detail.appeals.length === 0 ? (
                          <div className="text-sm text-gray-500">暂无申诉。</div>
                        ) : (
                          detail.appeals.map((appeal) => (
                            <div key={appeal.appealId} className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
                              <div className="font-medium">
                                appeal #{appeal.appealId} · {appeal.status}
                              </div>
                              <div className="mt-1 text-xs text-gray-500">
                                {appeal.appellantUsername ?? `user #${appeal.appellantUserId}`} · {appeal.appealReasonCode}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
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
