import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, Gauge, RefreshCw, ShieldAlert, Users } from 'lucide-react';

type AdminArenaRiskAuditSummary = {
  applied24h: number;
  skipped24h: number;
  failed24h: number;
  applied7d: number;
  skipped7d: number;
  failed7d: number;
  applied30d: number;
  skipped30d: number;
  failed30d: number;
  distinctUsers30d: number;
  distinctPairs30d: number;
};

type AdminArenaRiskAuditSkipReasonRow = {
  skipReason: string;
  count24h: number;
  count7d: number;
  count30d: number;
};

type AdminArenaRiskAuditTopUserRow = {
  userId: number;
  username: string | null;
  applied24h: number;
  applied7d: number;
  applied30d: number;
  skipped30d: number;
  pairCount30d: number;
  dedupSkips30d: number;
  pairDailyLimitSkips30d: number;
  dailyLimitSkips30d: number;
  outOfRangeSkips30d: number;
};

type AdminArenaRiskAuditTopPairRow = {
  pairKey: string;
  aEntityType: string;
  aEntityId: string;
  bEntityType: string;
  bEntityId: string;
  applied24h: number;
  applied7d: number;
  applied30d: number;
  skipped30d: number;
  distinctUsers30d: number;
  lastEventAt: string | null;
  dedupSkips30d: number;
  pairDailyLimitSkips30d: number;
  dailyLimitSkips30d: number;
  outOfRangeSkips30d: number;
};

type AdminArenaRiskAuditRecentRow = {
  id: string;
  generationId: string;
  createdAt: string;
  skipReason: string | null;
  status: string;
  userId: number | null;
  username: string | null;
  pairKey: string;
  aEntityType: string;
  aEntityId: string;
  bEntityType: string;
  bEntityId: string;
};

type ApiResponse =
  | {
      success: true;
      summary: AdminArenaRiskAuditSummary;
      skipReasonDistribution: AdminArenaRiskAuditSkipReasonRow[];
      topUsers: AdminArenaRiskAuditTopUserRow[];
      topPairs: AdminArenaRiskAuditTopPairRow[];
      recentSamples: AdminArenaRiskAuditRecentRow[];
    }
  | { success: false; error?: string };

const formatNumber = (value: number): string => value.toLocaleString('zh-CN');

const formatDateTime = (value: string | null | undefined): string => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
};

function SummaryCard(props: {
  title: string;
  value: string;
  note: string;
  icon: React.ElementType;
  color: string;
}) {
  const { title, value, note, icon: Icon, color } = props;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm backdrop-blur">
      <div className="mb-3 flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-full ${color}`}>
          <Icon className="h-5 w-5 text-white" />
        </div>
        <div>
          <div className="text-sm font-medium text-slate-600">{title}</div>
          <div className="text-2xl font-semibold text-slate-900">{value}</div>
        </div>
      </div>
      <div className="text-xs leading-5 text-slate-500">{note}</div>
    </div>
  );
}

function RiskCountBar(props: {
  label: string;
  value: number;
  max: number;
  tone: string;
  suffix?: string;
}) {
  const widthPercent = props.max > 0 ? Math.max(8, Math.round((props.value / props.max) * 100)) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="truncate text-slate-700">{props.label}</span>
        <span className="font-medium text-slate-900">
          {formatNumber(props.value)}
          {props.suffix ?? ''}
        </span>
      </div>
      <div className="h-2 rounded-full bg-slate-100">
        <div className={`h-2 rounded-full ${props.tone}`} style={{ width: `${widthPercent}%` }} />
      </div>
    </div>
  );
}

export default function AdminArenaRiskAuditPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (isRefreshing = false) => {
    if (isRefreshing) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/arena-risk-audit');
      const json = (await response.json()) as ApiResponse;
      if (!response.ok || json.success !== true) {
        throw new Error(json.success === false ? json.error || '读取 strict 风控审计失败' : '读取 strict 风控审计失败');
      }
      setData(json);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取 strict 风控审计失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const successData = data?.success === true ? data : null;
  const skipReasonMax = useMemo(() => {
    const rows = successData?.skipReasonDistribution ?? [];
    return rows.reduce((max, row) => Math.max(max, row.count30d), 0);
  }, [successData]);

  return (
    <>
      <Head>
        <title>Strict 风控审计 - Admin</title>
      </Head>

      <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(251,146,60,0.14),_transparent_32%),linear-gradient(180deg,_#fff7ed_0%,_#f8fafc_100%)] p-4 sm:p-6">
        <div className="mx-auto max-w-7xl">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <Link href="/admin" className="text-sm text-orange-700 hover:underline">
                ← 返回管理后台主页
              </Link>
              <h1 className="mt-3 text-3xl font-semibold text-slate-900">Strict 风控审计</h1>
              <p className="mt-1 text-sm text-slate-600">
                聚合 `arena_rating_events(queue=strict)` 的计分、跳过与失败信号。当前仅覆盖已落库事件，不包含 strict preflight 的未持久化拒绝。
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/admin/arena-rating-events" className="text-sm text-orange-700 hover:underline">
                打开原始事件表
              </Link>
              <button
                type="button"
                onClick={() => void load(true)}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                刷新
              </button>
            </div>
          </div>

          <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            当前后台能审计的是“结算阶段已写入的 strict 事件”。`/api/arena/strict-preflight.ts` 的拒绝原因暂未落库，因此这里不会显示“开打前就被拒”的样本。
          </div>

          {error ? (
            <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          ) : null}

          {loading && !data ? (
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">正在读取 strict 风控审计数据…</div>
          ) : null}

          {successData ? (
            <>
              <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <SummaryCard
                  title="近 24h strict 计分"
                  value={formatNumber(successData.summary.applied24h)}
                  note={`跳过 ${formatNumber(successData.summary.skipped24h)} · 失败 ${formatNumber(successData.summary.failed24h)}`}
                  icon={Gauge}
                  color="bg-emerald-600"
                />
                <SummaryCard
                  title="近 7 天 strict 计分"
                  value={formatNumber(successData.summary.applied7d)}
                  note={`跳过 ${formatNumber(successData.summary.skipped7d)} · 失败 ${formatNumber(successData.summary.failed7d)}`}
                  icon={Activity}
                  color="bg-cyan-700"
                />
                <SummaryCard
                  title="近 30 天 strict 计分"
                  value={formatNumber(successData.summary.applied30d)}
                  note={`跳过 ${formatNumber(successData.summary.skipped30d)} · 失败 ${formatNumber(successData.summary.failed30d)}`}
                  icon={ShieldAlert}
                  color="bg-orange-600"
                />
                <SummaryCard
                  title="近 30 天涉及用户"
                  value={formatNumber(successData.summary.distinctUsers30d)}
                  note="仅统计写入 strict 事件的用户"
                  icon={Users}
                  color="bg-indigo-700"
                />
                <SummaryCard
                  title="近 30 天 pair 数"
                  value={formatNumber(successData.summary.distinctPairs30d)}
                  note="用于观察计分是否过度集中在少数对手组合"
                  icon={AlertTriangle}
                  color="bg-rose-700"
                />
              </div>

              <div className="grid gap-6 xl:grid-cols-[1.1fr_1fr]">
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex items-center gap-2">
                    <ShieldAlert className="h-5 w-5 text-orange-600" />
                    <h2 className="text-lg font-semibold text-slate-900">skip_reason 分布</h2>
                  </div>
                  <div className="space-y-4">
                    {successData.skipReasonDistribution.length ? (
                      successData.skipReasonDistribution.map((row) => (
                        <div key={row.skipReason} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                          <RiskCountBar label={row.skipReason} value={row.count30d} max={skipReasonMax} tone="bg-orange-500" />
                          <div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-3">
                            <div>24h: {formatNumber(row.count24h)}</div>
                            <div>7d: {formatNumber(row.count7d)}</div>
                            <div>30d: {formatNumber(row.count30d)}</div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-slate-500">近 30 天没有 strict skip_reason 样本。</div>
                    )}
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-rose-600" />
                    <h2 className="text-lg font-semibold text-slate-900">最近异常样本</h2>
                  </div>
                  <div className="space-y-3">
                    {successData.recentSamples.length ? (
                      successData.recentSamples.map((row) => (
                        <div key={row.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="text-sm font-medium text-slate-900">
                              {row.skipReason ?? row.status}
                              <span className="ml-2 rounded-full bg-white px-2 py-0.5 text-xs text-slate-500">{row.status}</span>
                            </div>
                            <div className="text-xs text-slate-500">{formatDateTime(row.createdAt)}</div>
                          </div>
                          <div className="mt-2 text-xs text-slate-600">
                            user: {row.username ?? '匿名'} {row.userId != null ? `#${row.userId}` : ''}
                          </div>
                          <div className="mt-1 text-xs text-slate-600 break-all">
                            pair: {row.aEntityType}:{row.aEntityId} vs {row.bEntityType}:{row.bEntityId}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-3 text-xs">
                            <Link href={`/admin/arena-rating-events?generationId=${encodeURIComponent(row.generationId)}`} className="text-orange-700 hover:underline">
                              查看事件
                            </Link>
                            <Link href={`/admin/battle-report-generations?id=${encodeURIComponent(row.generationId)}`} className="text-orange-700 hover:underline">
                              查看战报
                            </Link>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-slate-500">暂无异常样本。</div>
                    )}
                  </div>
                </section>
              </div>

              <div className="mt-6 grid gap-6 xl:grid-cols-2">
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex items-center gap-2">
                    <Users className="h-5 w-5 text-indigo-600" />
                    <h2 className="text-lg font-semibold text-slate-900">用户 strict 计分集中度</h2>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-4 py-3">用户</th>
                          <th className="px-4 py-3">24h</th>
                          <th className="px-4 py-3">7d</th>
                          <th className="px-4 py-3">30d</th>
                          <th className="px-4 py-3">30d 跳过</th>
                          <th className="px-4 py-3">风控命中</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {successData.topUsers.length ? (
                          successData.topUsers.map((row) => (
                            <tr key={row.userId}>
                              <td className="px-4 py-3 align-top">
                                <div className="font-medium text-slate-900">{row.username ?? '匿名用户'}</div>
                                <div className="mt-1 text-xs text-slate-500">userId: {row.userId}</div>
                                <div className="mt-1 text-xs text-slate-500">30d pair: {formatNumber(row.pairCount30d)}</div>
                              </td>
                              <td className="px-4 py-3 align-top text-slate-700">{formatNumber(row.applied24h)}</td>
                              <td className="px-4 py-3 align-top text-slate-700">{formatNumber(row.applied7d)}</td>
                              <td className="px-4 py-3 align-top text-slate-700">{formatNumber(row.applied30d)}</td>
                              <td className="px-4 py-3 align-top text-slate-700">{formatNumber(row.skipped30d)}</td>
                              <td className="px-4 py-3 align-top text-xs text-slate-600">
                                <div>dedup: {formatNumber(row.dedupSkips30d)}</div>
                                <div>pair daily: {formatNumber(row.pairDailyLimitSkips30d)}</div>
                                <div>daily: {formatNumber(row.dailyLimitSkips30d)}</div>
                                <div>range: {formatNumber(row.outOfRangeSkips30d)}</div>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                              近 30 天没有可展示的 strict 用户样本
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex items-center gap-2">
                    <Activity className="h-5 w-5 text-cyan-700" />
                    <h2 className="text-lg font-semibold text-slate-900">pair 风险排行</h2>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-4 py-3">pair</th>
                          <th className="px-4 py-3">24h</th>
                          <th className="px-4 py-3">7d</th>
                          <th className="px-4 py-3">30d</th>
                          <th className="px-4 py-3">30d 跳过</th>
                          <th className="px-4 py-3">风控命中</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {successData.topPairs.length ? (
                          successData.topPairs.map((row) => (
                            <tr key={row.pairKey}>
                              <td className="px-4 py-3 align-top">
                                <div className="font-mono text-xs text-slate-900 break-all">{row.pairKey}</div>
                                <div className="mt-1 text-xs text-slate-500">
                                  {row.aEntityType}:{row.aEntityId}
                                </div>
                                <div className="text-xs text-slate-500">
                                  {row.bEntityType}:{row.bEntityId}
                                </div>
                                <div className="mt-1 text-xs text-slate-500">
                                  最近事件 {formatDateTime(row.lastEventAt)}
                                </div>
                              </td>
                              <td className="px-4 py-3 align-top text-slate-700">{formatNumber(row.applied24h)}</td>
                              <td className="px-4 py-3 align-top text-slate-700">{formatNumber(row.applied7d)}</td>
                              <td className="px-4 py-3 align-top text-slate-700">
                                <div>{formatNumber(row.applied30d)}</div>
                                <div className="mt-1 text-xs text-slate-500">用户数 {formatNumber(row.distinctUsers30d)}</div>
                              </td>
                              <td className="px-4 py-3 align-top text-slate-700">{formatNumber(row.skipped30d)}</td>
                              <td className="px-4 py-3 align-top text-xs text-slate-600">
                                <div>dedup: {formatNumber(row.dedupSkips30d)}</div>
                                <div>pair daily: {formatNumber(row.pairDailyLimitSkips30d)}</div>
                                <div>daily: {formatNumber(row.dailyLimitSkips30d)}</div>
                                <div>range: {formatNumber(row.outOfRangeSkips30d)}</div>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                              近 30 天没有可展示的 pair 样本
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
