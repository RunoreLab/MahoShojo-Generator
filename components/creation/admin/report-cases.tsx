import Head from 'next/head';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AdminReportCaseDetailDto, AdminReportCaseListItem } from '@/lib/admin/governance';
import {
  getCrowdReviewResultCodeLabel,
  getCrowdReviewRoundStatusLabel,
  getReportCaseStatusLabel,
  getReportResolutionCodeLabel,
} from '@/lib/admin/governance-labels';

const formatDateTime = (value: string | null | undefined): string => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const formatList = (items: string[]): string => (items.length > 0 ? items.join('；') : '—');

const STATUS_FILTER_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'open', label: getReportCaseStatusLabel('open') },
  { value: 'under_review', label: getReportCaseStatusLabel('under_review') },
  { value: 'resolved', label: getReportCaseStatusLabel('resolved') },
  { value: 'dismissed', label: getReportCaseStatusLabel('dismissed') },
] as const;

const DECISION_STATUS_OPTIONS = [
  { value: 'resolved', label: '正式结案：违规成立' },
  { value: 'dismissed', label: '正式结案：不构成违规 / 恶意举报' },
  { value: 'under_review', label: '转回人工复核' },
] as const;

const RESOLVED_RESOLUTION_OPTIONS = [
  { value: 'confirmed_violation', label: getReportResolutionCodeLabel('confirmed_violation') },
  { value: 'content_removed', label: getReportResolutionCodeLabel('content_removed') },
  { value: 'self_remediated', label: getReportResolutionCodeLabel('self_remediated') },
] as const;

const DISMISSED_RESOLUTION_OPTIONS = [
  { value: 'no_violation', label: getReportResolutionCodeLabel('no_violation') },
  { value: 'malicious_report', label: getReportResolutionCodeLabel('malicious_report') },
] as const;

type DecisionFormState = {
  nextStatus: 'resolved' | 'dismissed' | 'under_review';
  resolutionCode: string;
  resolutionNote: string;
  notifyCreator: boolean;
  creatorMessageReason: string;
  enableCardModeration: boolean;
  cardModerationAction: 'reject' | 'set_public_status';
  cardModerationValue: 0 | -1;
  sendCardMessage: boolean;
  cardMessageReason: string;
};

const buildDecisionFormState = (creatorMessageReason: string): DecisionFormState => ({
  nextStatus: 'resolved',
  resolutionCode: 'confirmed_violation',
  resolutionNote: '',
  notifyCreator: true,
  creatorMessageReason,
  enableCardModeration: true,
  cardModerationAction: 'set_public_status',
  cardModerationValue: -1,
  sendCardMessage: true,
  cardMessageReason: '公开卡违规封禁',
});

export default function AdminReportCasesPage() {
  const [items, setItems] = useState<AdminReportCaseListItem[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminReportCaseDetailDto | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const detailRequestIdRef = useRef(0);
  const [sendMessage, setSendMessage] = useState(true);
  const [notifyReason, setNotifyReason] = useState('');
  const [notifySubmitting, setNotifySubmitting] = useState(false);
  const [decisionSubmitting, setDecisionSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [decisionForm, setDecisionForm] = useState<DecisionFormState>(() => buildDecisionFormState(''));

  const decisionResolutionOptions = useMemo(() => {
    if (decisionForm.nextStatus === 'resolved') return RESOLVED_RESOLUTION_OPTIONS;
    if (decisionForm.nextStatus === 'dismissed') return DISMISSED_RESOLUTION_OPTIONS;
    return [];
  }, [decisionForm.nextStatus]);

  const canApplyCardModeration =
    decisionForm.nextStatus === 'resolved' &&
    (decisionForm.resolutionCode === 'confirmed_violation' ||
      decisionForm.resolutionCode === 'content_removed' ||
      decisionForm.resolutionCode === 'self_remediated');

  const loadCaseList = useCallback(async () => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);

    setLoading(true);
    try {
      const response = await fetch(`/api/admin/report-cases?${params.toString()}`);
      const payload = (await response.json()) as { items?: AdminReportCaseListItem[] };
      setItems(Array.isArray(payload.items) ? payload.items : []);
    } finally {
      setLoading(false);
    }
  }, [status]);

  const loadCaseDetail = useCallback(async (caseId: string) => {
    const requestId = detailRequestIdRef.current + 1;
    detailRequestIdRef.current = requestId;
    setDetailLoading(true);
    setFeedback(null);
    try {
      const response = await fetch(`/api/admin/report-cases/${encodeURIComponent(caseId)}`);
      if (detailRequestIdRef.current !== requestId) {
        return;
      }
      if (!response.ok) {
        setDetail(null);
        return;
      }
      const payload = (await response.json()) as AdminReportCaseDetailDto;
      if (detailRequestIdRef.current !== requestId) {
        return;
      }
      setDetail(payload);
      const summaryReason = payload.aggregatedSummary.detailsPreview ?? payload.aggregatedSummary.reasonLabels.join('；');
      setNotifyReason(summaryReason);
      setDecisionForm(buildDecisionFormState(summaryReason));
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
        await loadCaseList();
        if (!active) return;
      } finally {
        if (!active) return;
      }
    })();

    return () => {
      active = false;
    };
  }, [loadCaseList]);

  useEffect(() => {
    if (!selectedCaseId) {
      detailRequestIdRef.current += 1;
      setDetail(null);
      setNotifyReason('');
      setDecisionForm(buildDecisionFormState(''));
      setFeedback(null);
      return;
    }

    setDetail(null);
    setNotifyReason('');
    setDecisionForm(buildDecisionFormState(''));
    setFeedback(null);
    let active = true;
    (async () => {
      try {
        await loadCaseDetail(selectedCaseId);
        if (!active) return;
      } finally {
        if (!active) return;
      }
    })();

    return () => {
      active = false;
    };
  }, [loadCaseDetail, selectedCaseId]);

  const activeDetail = detail && detail.reportCaseId === selectedCaseId ? detail : null;

  const handleNotifyCreator = async () => {
    const caseId = activeDetail?.reportCaseId;
    if (!caseId) return;

    setNotifySubmitting(true);
    setFeedback(null);
    try {
      const response = await fetch(`/api/admin/report-cases/${encodeURIComponent(caseId)}/notify-creator`, {
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
          item.reportCaseId === caseId
            ? {
                ...item,
                creatorNotifiedAt: notifyPayload.creatorNotifiedAt,
              }
            : item,
        ),
      );
      setDetail((current) =>
        current && current.reportCaseId === caseId
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

  const handleSubmitDecision = async () => {
    const caseId = activeDetail?.reportCaseId;
    if (!caseId) return;

    setDecisionSubmitting(true);
    setFeedback(null);
    try {
      const payload = {
        nextStatus: decisionForm.nextStatus,
        resolutionCode: decisionForm.nextStatus === 'under_review' ? null : decisionForm.resolutionCode,
        resolutionNote: decisionForm.resolutionNote || null,
        notifyCreator: decisionForm.notifyCreator,
        creatorMessageReason: decisionForm.notifyCreator ? decisionForm.creatorMessageReason || null : null,
        cardModerationAction:
          decisionForm.enableCardModeration && canApplyCardModeration
            ? {
                action: decisionForm.cardModerationAction,
                value:
                  decisionForm.cardModerationAction === 'set_public_status'
                    ? decisionForm.cardModerationValue
                    : undefined,
                messageOptions: {
                  send: decisionForm.sendCardMessage,
                  defaultReason: decisionForm.cardMessageReason || null,
                },
              }
            : null,
      };

      const response = await fetch(`/api/admin/report-cases/${encodeURIComponent(caseId)}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as { error?: string; closedAt?: string | null };
      if (!response.ok) {
        setFeedback(result.error ?? '正式处理失败');
        return;
      }

      await Promise.all([loadCaseList(), loadCaseDetail(caseId)]);
      setFeedback(`正式处理已提交${result.closedAt ? `，结案时间 ${formatDateTime(result.closedAt)}` : ''}`);
    } finally {
      setDecisionSubmitting(false);
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
                {STATUS_FILTER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
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
                          <div>{getReportCaseStatusLabel(item.status)}</div>
                          <div className="mt-1 text-xs text-gray-500">
                            {item.resolutionCode ? getReportResolutionCodeLabel(item.resolutionCode) : '未结案'}
                          </div>
                          <div className="mt-1 text-[11px] text-gray-400">
                            {item.status}
                            {item.resolutionCode ? ` · ${item.resolutionCode}` : ''}
                          </div>
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
              ) : !activeDetail ? (
                <div className="rounded-xl border border-dashed border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
                  案件详情加载失败或已不存在。
                </div>
              ) : (
                <>
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">
                      {activeDetail.targetCardName ?? activeDetail.targetCardId ?? activeDetail.reportCaseId}
                    </h2>
                    <p className="mt-1 text-xs text-gray-500">
                      case #{activeDetail.reportCaseId} · 作者 {activeDetail.targetUsername ?? '未知'} · 最近举报 {formatDateTime(activeDetail.latestReportedAt)}
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl bg-gray-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-gray-500">案件状态</div>
                      <div className="mt-2 text-sm text-gray-900">
                        {getReportCaseStatusLabel(activeDetail.status)}
                        {activeDetail.resolutionCode ? ` / ${getReportResolutionCodeLabel(activeDetail.resolutionCode)}` : ' / 未结案'}
                      </div>
                      <div className="mt-1 text-xs text-gray-400">
                        {activeDetail.status}
                        {activeDetail.resolutionCode ? ` · ${activeDetail.resolutionCode}` : ''}
                      </div>
                      <div className="mt-2 text-xs text-gray-500">
                        作者通知：{formatDateTime(activeDetail.creatorNotifiedAt)}
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        结案通知：{formatDateTime(activeDetail.resolutionNotifiedAt)}
                      </div>
                    </div>
                    <div className="rounded-xl bg-gray-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-gray-500">治理摘要</div>
                      <div className="mt-2 text-sm text-gray-900">理由：{formatList(activeDetail.aggregatedSummary.reasonLabels)}</div>
                      <div className="mt-2 text-xs text-gray-500">引用：{formatList(activeDetail.aggregatedSummary.referenceSummary)}</div>
                      <div className="mt-2 text-xs text-gray-500">
                        补充说明：{activeDetail.aggregatedSummary.detailsPreview ?? '—'}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-gray-900">正式处理</h3>
                      <span className="text-xs text-gray-500">支持正式结案、改判与数据卡处罚</span>
                    </div>
                    <div className="mt-3 grid gap-3">
                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="grid gap-1 text-sm text-gray-700">
                          <span className="font-medium">处理动作</span>
                          <select
                            value={decisionForm.nextStatus}
                            onChange={(event) => {
                              const nextStatus = event.target.value as 'resolved' | 'dismissed' | 'under_review';
                              setDecisionForm((current) => ({
                                ...current,
                                nextStatus,
                                resolutionCode:
                                  nextStatus === 'dismissed'
                                    ? 'no_violation'
                                    : nextStatus === 'under_review'
                                      ? ''
                                      : 'confirmed_violation',
                                enableCardModeration: nextStatus === 'resolved',
                              }));
                            }}
                            className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
                          >
                            {DECISION_STATUS_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="grid gap-1 text-sm text-gray-700">
                          <span className="font-medium">处理结论</span>
                          <select
                            value={decisionForm.resolutionCode}
                            onChange={(event) =>
                              setDecisionForm((current) => ({ ...current, resolutionCode: event.target.value }))
                            }
                            disabled={decisionForm.nextStatus === 'under_review'}
                            className="rounded-xl border border-gray-200 px-3 py-2 text-sm disabled:bg-gray-100"
                          >
                            {decisionForm.nextStatus === 'under_review' ? (
                              <option value="">重新打开后不附带结论</option>
                            ) : (
                              decisionResolutionOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))
                            )}
                          </select>
                        </label>
                      </div>
                      <textarea
                        value={decisionForm.resolutionNote}
                        onChange={(event) =>
                          setDecisionForm((current) => ({ ...current, resolutionNote: event.target.value }))
                        }
                        rows={3}
                        className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                        placeholder="管理员备注，会随本次动作一起提交给后端。"
                      />
                      <label className="flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={decisionForm.notifyCreator}
                          onChange={(event) =>
                            setDecisionForm((current) => ({ ...current, notifyCreator: event.target.checked }))
                          }
                        />
                        正式处理后通知作者
                      </label>
                      {decisionForm.notifyCreator ? (
                        <textarea
                          value={decisionForm.creatorMessageReason}
                          onChange={(event) =>
                            setDecisionForm((current) => ({ ...current, creatorMessageReason: event.target.value }))
                          }
                          rows={3}
                          className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                          placeholder="写给作者的补充说明，可单独补充整改要求。"
                        />
                      ) : null}
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                        <label className="flex items-center gap-2 text-sm font-medium text-amber-900">
                          <input
                            type="checkbox"
                            checked={decisionForm.enableCardModeration && canApplyCardModeration}
                            onChange={(event) =>
                              setDecisionForm((current) => ({
                                ...current,
                                enableCardModeration: event.target.checked,
                              }))
                            }
                            disabled={!canApplyCardModeration}
                          />
                          同步执行数据卡处罚
                        </label>
                        <p className="mt-2 text-xs text-amber-800">
                          仅在“违规成立”结案时可用，复用内容管理后台的现有处罚链路。
                        </p>
                        {decisionForm.enableCardModeration && canApplyCardModeration ? (
                          <div className="mt-3 grid gap-3">
                            <div className="grid gap-3 md:grid-cols-2">
                              <select
                                value={decisionForm.cardModerationAction}
                                onChange={(event) =>
                                  setDecisionForm((current) => ({
                                    ...current,
                                    cardModerationAction: event.target.value as 'reject' | 'set_public_status',
                                  }))
                                }
                                className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm"
                              >
                                <option value="set_public_status">封禁公开卡</option>
                                <option value="reject">标记审核未通过</option>
                              </select>
                              {decisionForm.cardModerationAction === 'set_public_status' ? (
                                <select
                                  value={decisionForm.cardModerationValue}
                                  onChange={(event) =>
                                    setDecisionForm((current) => ({
                                      ...current,
                                      cardModerationValue: Number(event.target.value) as 0 | -1,
                                    }))
                                  }
                                  className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm"
                                >
                                  <option value={-1}>封禁公开卡（-1）</option>
                                  <option value={0}>下架为私有（0）</option>
                                </select>
                              ) : null}
                            </div>
                            <label className="flex items-center gap-2 text-sm text-amber-900">
                              <input
                                type="checkbox"
                                checked={decisionForm.sendCardMessage}
                                onChange={(event) =>
                                  setDecisionForm((current) => ({ ...current, sendCardMessage: event.target.checked }))
                                }
                              />
                              同时给作者发送处罚消息
                            </label>
                            <input
                              value={decisionForm.cardMessageReason}
                              onChange={(event) =>
                                setDecisionForm((current) => ({ ...current, cardMessageReason: event.target.value }))
                              }
                              className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm"
                              placeholder="处罚消息默认原因"
                            />
                          </div>
                        ) : null}
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs text-gray-500">
                          成功后会刷新左侧列表和当前详情。
                        </p>
                        <button
                          type="button"
                          disabled={decisionSubmitting}
                          onClick={() => void handleSubmitDecision()}
                          className="rounded-xl bg-rose-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                        >
                          {decisionSubmitting ? '提交中...' : '提交正式处理'}
                        </button>
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
                        {activeDetail.currentTargetCard.name ?? '未知'} · {activeDetail.currentTargetCard.reviewStatus ?? '—'}
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        更新时间：{formatDateTime(activeDetail.currentTargetCard.updatedAt)}
                      </div>
                      <pre className="mt-3 max-h-56 overflow-auto rounded-lg bg-gray-50 p-3 text-xs text-gray-700">
                        {activeDetail.currentTargetCard.dataPreview ?? '暂无当前卡内容预览'}
                      </pre>
                    </div>
                    <div className="rounded-xl border border-gray-200 p-4">
                      <h3 className="text-sm font-semibold text-gray-900">最近举报快照</h3>
                      <div className="mt-2 text-sm text-gray-700">{activeDetail.latestTargetSnapshot?.name ?? '暂无快照'}</div>
                      <div className="mt-1 text-xs text-gray-500">
                        快照时间：{formatDateTime(activeDetail.latestTargetSnapshot?.updatedAt)}
                      </div>
                      <pre className="mt-3 max-h-56 overflow-auto rounded-lg bg-gray-50 p-3 text-xs text-gray-700">
                        {activeDetail.latestTargetSnapshot?.dataPreview ?? '暂无快照内容预览'}
                      </pre>
                    </div>
                  </div>

                  <div className="rounded-xl border border-gray-200 p-4">
                    <h3 className="text-sm font-semibold text-gray-900">活跃举报材料</h3>
                    <div className="mt-3 space-y-3">
                      {activeDetail.activeReports.length === 0 ? (
                        <div className="text-sm text-gray-500">暂无活跃举报。</div>
                      ) : (
                        activeDetail.activeReports.map((report) => (
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
                        {activeDetail.crowdReviewRounds.length === 0 ? (
                          <div className="text-sm text-gray-500">暂无众查轮次。</div>
                        ) : (
                          activeDetail.crowdReviewRounds.map((round) => (
                            <div key={round.roundId} className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
                              <div className="font-medium">
                                round #{round.roundId} · {getCrowdReviewRoundStatusLabel(round.status)}
                              </div>
                              <div className="mt-1 text-xs text-gray-500">
                                截止 {formatDateTime(round.deadlineAt)} · 结果{' '}
                                {round.resultCode ? getCrowdReviewResultCodeLabel(round.resultCode) : '—'}
                              </div>
                              <div className="mt-1 text-[11px] text-gray-400">
                                {round.status}
                                {round.resultCode ? ` · ${round.resultCode}` : ''}
                              </div>
                              <div className="mt-3">
                                <Link
                                  href={`/admin/crowd-review/cases?roundId=${encodeURIComponent(round.roundId)}`}
                                  className="inline-flex rounded-lg border border-violet-200 px-2.5 py-1 text-[11px] font-medium text-violet-700 hover:bg-violet-50"
                                >
                                  查看投票明细
                                </Link>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                    <div className="rounded-xl border border-gray-200 p-4">
                      <h3 className="text-sm font-semibold text-gray-900">关联申诉</h3>
                      <div className="mt-3 space-y-2">
                        {activeDetail.appeals.length === 0 ? (
                          <div className="text-sm text-gray-500">暂无申诉。</div>
                        ) : (
                          activeDetail.appeals.map((appeal) => (
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
