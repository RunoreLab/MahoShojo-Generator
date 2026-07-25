import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import type { AdminCrowdReviewInspectorListItem } from '@/lib/admin/governance';

const formatDateTime = (value: string | null | undefined): string => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

export default function AdminCrowdReviewInspectorsPage() {
  const [items, setItems] = useState<AdminCrowdReviewInspectorListItem[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [formUserId, setFormUserId] = useState('');
  const [nextStatus, setNextStatus] = useState<'active' | 'suspended' | 'revoked'>('active');
  const [reasonCode, setReasonCode] = useState('');
  const [reasonDetail, setReasonDetail] = useState('');
  const [suspendedUntil, setSuspendedUntil] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const refreshList = async (currentStatus: string) => {
    const params = new URLSearchParams();
    if (currentStatus) params.set('status', currentStatus);
    const response = await fetch(`/api/admin/crowd-review/inspectors?${params.toString()}`);
    const payload = (await response.json()) as { items?: AdminCrowdReviewInspectorListItem[] };
    setItems(Array.isArray(payload.items) ? payload.items : []);
  };

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (status) params.set('status', status);
        const response = await fetch(`/api/admin/crowd-review/inspectors?${params.toString()}`);
        const payload = (await response.json()) as { items?: AdminCrowdReviewInspectorListItem[] };
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

  const handleSubmit = async () => {
    const userId = Number.parseInt(formUserId, 10);
    if (!Number.isInteger(userId) || userId <= 0) {
      setFeedback('请填写有效的用户 ID。');
      return;
    }

    setSubmitting(true);
    setFeedback(null);
    try {
      const response = await fetch(`/api/admin/crowd-review/inspectors/${userId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nextStatus,
          reasonCode,
          reasonDetail,
          suspendedUntil: nextStatus === 'suspended' ? suspendedUntil : null,
        }),
      });
      const payload = (await response.json()) as { error?: string; status?: string };
      if (!response.ok) {
        setFeedback(payload.error ?? '巡查使状态更新失败');
        return;
      }

      await refreshList(status);
      setFeedback(`user #${userId} 已更新为 ${payload.status ?? nextStatus}`);
    } finally {
      setSubmitting(false);
    }
  };

  const prefillForm = (item: AdminCrowdReviewInspectorListItem) => {
    setFormUserId(String(item.userId));
    setNextStatus(item.status === 'active' ? 'suspended' : 'active');
    setReasonCode(item.statusReasonCode ?? '');
    setReasonDetail(item.statusReasonDetail ?? '');
    setSuspendedUntil(item.suspendedUntil ?? '');
    setFeedback(null);
  };

  return (
    <>
      <Head>
        <title>巡查使管理 - Admin</title>
      </Head>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="mx-auto max-w-7xl space-y-4">
          <Link href="/admin" className="text-sm text-purple-600 hover:underline">
            &larr; 返回管理后台主页
          </Link>
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h1 className="text-2xl font-bold text-gray-900">巡查使管理</h1>
            <p className="mt-3 text-sm leading-6 text-gray-600">
              支持授予、暂停、撤销、恢复巡查使资格，并为每次状态调整记录纪律原因。
            </p>
            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div className="w-full max-w-xs">
                <label className="mb-1 block text-sm font-medium text-gray-700">状态筛选</label>
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                >
                  <option value="">全部状态</option>
                  <option value="active">active</option>
                  <option value="suspended">suspended</option>
                  <option value="revoked">revoked</option>
                </select>
              </div>
              <div className="rounded-2xl border border-violet-100 bg-violet-50/60 p-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="text-sm text-gray-700">
                    <span className="mb-1 block font-medium">用户 ID</span>
                    <input
                      value={formUserId}
                      onChange={(event) => setFormUserId(event.target.value)}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2"
                      placeholder="例如 1024"
                    />
                  </label>
                  <label className="text-sm text-gray-700">
                    <span className="mb-1 block font-medium">目标状态</span>
                    <select
                      value={nextStatus}
                      onChange={(event) => setNextStatus(event.target.value as 'active' | 'suspended' | 'revoked')}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2"
                    >
                      <option value="active">active / 授予或恢复</option>
                      <option value="suspended">suspended / 暂停</option>
                      <option value="revoked">revoked / 撤销</option>
                    </select>
                  </label>
                  <label className="text-sm text-gray-700">
                    <span className="mb-1 block font-medium">原因代码</span>
                    <input
                      value={reasonCode}
                      onChange={(event) => setReasonCode(event.target.value)}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2"
                      placeholder="manual_pause / review_complete"
                    />
                  </label>
                  <label className="text-sm text-gray-700">
                    <span className="mb-1 block font-medium">暂停截止时间</span>
                    <input
                      value={suspendedUntil}
                      onChange={(event) => setSuspendedUntil(event.target.value)}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2"
                      placeholder="2026-04-20T00:00:00.000Z"
                    />
                  </label>
                </div>
                <label className="mt-3 block text-sm text-gray-700">
                  <span className="mb-1 block font-medium">原因说明</span>
                  <textarea
                    value={reasonDetail}
                    onChange={(event) => setReasonDetail(event.target.value)}
                    rows={3}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2"
                    placeholder="例如：等待当前案件复核结论后恢复资格。"
                  />
                </label>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <div className="text-xs text-gray-500">未出现在列表中的用户，也可直接通过用户 ID 授予巡查使资格。</div>
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={submitting}
                    className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                  >
                    {submitting ? '提交中...' : '提交状态变更'}
                  </button>
                </div>
                {feedback ? <div className="mt-3 text-xs text-violet-700">{feedback}</div> : null}
              </div>
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-3">用户</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3">原因</th>
                  <th className="px-4 py-3">派单负载</th>
                  <th className="px-4 py-3">更新时间</th>
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
                      暂无巡查使记录
                    </td>
                  </tr>
                ) : (
                  items.map((item) => (
                    <tr key={item.userId} className="border-t">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{item.username ?? `用户 ${item.userId}`}</div>
                        <div className="mt-1 text-xs text-gray-500">user #{item.userId}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div>{item.status}</div>
                        {item.suspendedUntil ? (
                          <div className="mt-1 text-xs text-gray-500">至 {formatDateTime(item.suspendedUntil)}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <div>{item.statusReasonCode ?? '—'}</div>
                        {item.statusReasonDetail ? <div className="mt-1 text-xs text-gray-500">{item.statusReasonDetail}</div> : null}
                      </td>
                      <td className="px-4 py-3">
                        活跃 {item.activeAssignments} · 累计完成 {item.completedAssignments}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{formatDateTime(item.updatedAt)}</td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => prefillForm(item)}
                          className="rounded-lg border border-violet-200 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-50"
                        >
                          填入表单
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
