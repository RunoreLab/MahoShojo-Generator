import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import type { ReportAppealResolutionCode, ReportAppealStatus } from '@/lib/db/schema';
import type {
  ReportAppealAdminDetailDto,
  ReportAppealAdminListItemDto,
} from '@/lib/report-appeals/types';

type AppealListResponse = {
  items: ReportAppealAdminListItemDto[];
  fetchedAt: string;
};

const STATUS_OPTIONS: Array<{ value: '' | ReportAppealStatus; label: string }> = [
  { value: '', label: '全部状态' },
  { value: 'submitted', label: '待复核' },
  { value: 'under_review', label: '复核中' },
  { value: 'resolved', label: '已处理' },
  { value: 'withdrawn', label: '已撤回' },
];

const RESOLUTION_OPTIONS: Array<{ value: ReportAppealResolutionCode; label: string }> = [
  { value: 'upheld', label: '维持原结论' },
  { value: 'overturned_no_violation', label: '改判为无违规' },
  { value: 'reopened_under_review', label: '退回案件复核' },
];

export function AdminReportAppealsPage() {
  const [status, setStatus] = useState<'' | ReportAppealStatus>('');
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ReportAppealAdminListItemDto[]>([]);
  const [selectedAppealId, setSelectedAppealId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReportAppealAdminDetailDto | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolutionCode, setResolutionCode] = useState<ReportAppealResolutionCode>('upheld');
  const [resolutionNote, setResolutionNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canReview = useMemo(() => detail?.status === 'submitted' || detail?.status === 'under_review', [detail]);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      const response = await fetch(`/api/admin/report-appeals?${params.toString()}`);
      const payload = (await response.json()) as AppealListResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || '获取申诉列表失败');
      }
      setItems(payload.items);
      if (!selectedAppealId && payload.items[0]) {
        setSelectedAppealId(payload.items[0].appealId);
      }
      if (selectedAppealId && !payload.items.find((item) => item.appealId === selectedAppealId)) {
        setSelectedAppealId(payload.items[0]?.appealId ?? null);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '获取申诉列表失败');
    } finally {
      setLoading(false);
    }
  }, [selectedAppealId, status]);

  const loadDetail = useCallback(async (appealId: string) => {
    setDetailLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/report-appeals/${encodeURIComponent(appealId)}`);
      const payload = (await response.json()) as ReportAppealAdminDetailDto & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || '获取申诉详情失败');
      }
      setDetail(payload);
      setResolutionCode('upheld');
      setResolutionNote(payload.resolutionNote ?? '');
    } catch (nextError) {
      setDetail(null);
      setError(nextError instanceof Error ? nextError.message : '获取申诉详情失败');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (selectedAppealId) {
      void loadDetail(selectedAppealId);
    } else {
      setDetail(null);
    }
  }, [loadDetail, selectedAppealId]);

  const handleSubmitReview = async () => {
    if (!detail) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/report-appeals/${encodeURIComponent(detail.appealId)}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resolutionCode,
          resolutionNote: resolutionNote.trim() || null,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || '提交复核失败');
      }
      await loadList();
      await loadDetail(detail.appealId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '提交复核失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="mx-auto max-w-7xl space-y-4">
        <div>
          <Link href="/admin" className="text-sm text-purple-600 hover:underline">
            &larr; 返回管理后台主页
          </Link>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">申诉复核</h1>
              <p className="mt-2 text-sm text-gray-500">查看公开数据卡处理结果申诉，执行复核结论并回写案件状态。</p>
            </div>

            <div className="w-full md:w-56">
              <label className="mb-1 block text-sm font-medium text-gray-700">状态筛选</label>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as '' | ReportAppealStatus)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value || 'all'} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]">
          <div className="rounded-2xl bg-white shadow-sm">
            <div className="border-b px-5 py-4">
              <h2 className="text-lg font-semibold text-gray-900">申诉列表</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-4 py-3">目标卡 / 发起人</th>
                    <th className="px-4 py-3">原因</th>
                    <th className="px-4 py-3">状态</th>
                    <th className="px-4 py-3">更新时间</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                        加载中...
                      </td>
                    </tr>
                  ) : items.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                        当前筛选下没有申诉记录
                      </td>
                    </tr>
                  ) : (
                    items.map((item) => (
                      <tr
                        key={item.appealId}
                        onClick={() => setSelectedAppealId(item.appealId)}
                        className={`cursor-pointer border-t ${selectedAppealId === item.appealId ? 'bg-purple-50' : 'hover:bg-gray-50'}`}
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{item.targetCardName}</div>
                          <div className="mt-1 text-xs text-gray-500">
                            appeal #{item.appealId} · 用户 {item.appellantUserId}
                            {item.appellantUsername ? ` (${item.appellantUsername})` : ''}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-600">{item.appealReasonCode}</td>
                        <td className="px-4 py-3 text-gray-600">{item.status}</td>
                        <td className="px-4 py-3 text-gray-500">{new Date(item.updatedAt).toLocaleString()}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">申诉详情</h2>
            {detailLoading ? <p className="mt-4 text-sm text-gray-500">加载详情中...</p> : null}
            {!detailLoading && !detail ? <p className="mt-4 text-sm text-gray-500">请选择左侧申诉记录。</p> : null}
            {detail ? (
              <div className="mt-4 space-y-4 text-sm text-gray-700">
                <section className="space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <div className="font-medium text-gray-900">{detail.targetCardName}</div>
                  <div>案件：{detail.reportCaseId}</div>
                  <div>发起人：用户 {detail.appellantUserId}</div>
                  <div>被处理人：用户 {detail.targetUserId}</div>
                  <div>状态：{detail.status}</div>
                  <div>申诉原因：{detail.appealReasonCode}</div>
                </section>

                <section className="space-y-2 rounded-xl border border-gray-200 p-4">
                  <h3 className="font-medium text-gray-900">申诉说明</h3>
                  <p className="whitespace-pre-wrap leading-6 text-gray-700">{detail.details}</p>
                </section>

                <section className="space-y-2 rounded-xl border border-gray-200 p-4">
                  <h3 className="font-medium text-gray-900">案件快照 vs 当前状态</h3>
                  <div>快照状态：{detail.caseSnapshot.status}</div>
                  <div>快照结论：{detail.caseSnapshot.resolutionCode ?? '—'}</div>
                  <div>当前状态：{detail.currentCase.status}</div>
                  <div>当前结论：{detail.currentCase.resolutionCode ?? '—'}</div>
                </section>

                <section className="space-y-2 rounded-xl border border-gray-200 p-4">
                  <h3 className="font-medium text-gray-900">补充引用</h3>
                  {detail.references.length === 0 ? (
                    <p className="text-gray-500">无补充引用</p>
                  ) : (
                    <ul className="space-y-2">
                      {detail.references.map((reference) => (
                        <li key={`${reference.referenceType}-${reference.referenceId}`} className="rounded-lg bg-gray-50 px-3 py-2">
                          <div className="font-medium text-gray-900">{reference.labelSnapshot}</div>
                          <div className="text-xs text-gray-500">{reference.referenceType}</div>
                          {reference.note ? <div className="mt-1 text-gray-700">{reference.note}</div> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="space-y-3 rounded-xl border border-gray-200 p-4">
                  <h3 className="font-medium text-gray-900">管理员复核</h3>
                  {canReview ? (
                    <>
                      <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700">复核结论</label>
                        <select
                          value={resolutionCode}
                          onChange={(event) => setResolutionCode(event.target.value as ReportAppealResolutionCode)}
                          className="w-full rounded-xl border border-gray-200 px-3 py-2"
                        >
                          {RESOLUTION_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700">复核备注</label>
                        <textarea
                          value={resolutionNote}
                          onChange={(event) => setResolutionNote(event.target.value)}
                          className="min-h-28 w-full rounded-xl border border-gray-200 px-3 py-2"
                          placeholder="可选，写给后台留痕或用户消息说明。"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleSubmitReview()}
                        disabled={submitting}
                        className="rounded-xl bg-purple-700 px-4 py-2 text-sm font-medium text-white hover:bg-purple-800 disabled:opacity-60"
                      >
                        {submitting ? '提交中...' : '提交复核结果'}
                      </button>
                    </>
                  ) : (
                    <p className="text-gray-500">当前申诉状态不可复核。</p>
                  )}
                </section>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
