import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  AlertTriangle,
  Download,
  Eye,
  FileText,
  Filter,
  RefreshCw,
  Search,
  User,
  X,
} from 'lucide-react';

import { AdminTableScroll } from '@/components/admin/AdminTableScroll';

type BattleReportGenerationStatus = 'completed' | 'aborted' | 'failed';
type BattleReportGenerationMode = 'stream' | 'non-stream';

interface BattleReportGenerationListRow {
  id: string;
  started_at: string;
  ended_at: string;
  duration_ms: number;
  status: BattleReportGenerationStatus;
  generation_mode: BattleReportGenerationMode;
  endpoint: string;
  user_id: number | null;
  username: string | null;
  user_prefix: string | null;
  mode: string;
  scenario_title: string | null;
  scenario_data_card_id: string | null;
  combatant_count: number | null;
  headline: string | null;
  winner: string | null;
  ai_provider_type: string | null;
  ai_provider_name: string | null;
  ai_model: string | null;
  total_tokens: number | null;
  output_has_sensitive_words: number | null;
  output_has_shield_words: number | null;
  combatants_write_ok: number | null;
  combatants_row_count: number | null;
  combatants_write_error: string | null;
  combatant_names: string | null;
  combatant_card_ids: string | null;
}

interface BattleReportGenerationDetailResponse {
  success: boolean;
  generation: Record<string, unknown>;
  combatants: Array<Record<string, unknown>>;
  error?: string;
}

type BattleReportOutputCandidate = {
  format: 'json' | 'markdown';
  r2Key: string;
  downloadUrl: string;
};

type BattleReportOutputPresignResponse =
  | {
      success: true;
      generationId: string;
      indexed: boolean;
      expiresInSeconds: number;
      candidates: BattleReportOutputCandidate[];
    }
  | { success: false; error?: string };

function formatIso(iso: string | null | undefined) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().replace('T', ' ').replace('Z', ' UTC');
}

function formatDuration(ms: number | null | undefined) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function statusBadge(status: BattleReportGenerationStatus) {
  if (status === 'completed') return 'bg-green-100 text-green-700 border-green-200';
  if (status === 'aborted') return 'bg-yellow-100 text-yellow-700 border-yellow-200';
  return 'bg-red-100 text-red-700 border-red-200';
}

function formatStatus(status: BattleReportGenerationStatus) {
  if (status === 'completed') return '完成';
  if (status === 'aborted') return '中断';
  return '失败';
}

export default function BattleReportGenerationAdminPage() {
  const router = useRouter();
  const outputRequestIdRef = useRef<string | null>(null);

  const [records, setRecords] = useState<BattleReportGenerationListRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [filters, setFilters] = useState({
    search: '',
    status: 'all' as 'all' | BattleReportGenerationStatus,
    mode: '',
    generationMode: 'all' as 'all' | BattleReportGenerationMode,
    endpoint: '',
    username: '',
    scenarioDataCardId: '',
    dateFrom: '',
    dateTo: '',
    hasSensitiveWords: false,
    hasShieldWords: false,
    sortBy: 'started_at' as 'started_at' | 'duration_ms' | 'total_tokens' | 'created_at',
    sortOrder: 'desc' as 'asc' | 'desc',
  });

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailData, setDetailData] = useState<BattleReportGenerationDetailResponse | null>(null);
  const [outputLinksLoading, setOutputLinksLoading] = useState(false);
  const [outputLinksError, setOutputLinksError] = useState<string | null>(null);
  const [outputLinks, setOutputLinks] = useState<Extract<BattleReportOutputPresignResponse, { success: true }> | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportIncludeCombatants, setExportIncludeCombatants] = useState(true);
  const [exportMaxRows, setExportMaxRows] = useState(20000);

  const buildListParams = (page: number, f: typeof filters) => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', '20');
    params.set('sortBy', f.sortBy);
    params.set('sortOrder', f.sortOrder);

    if (f.search.trim()) params.set('search', f.search.trim());
    if (f.status !== 'all') params.set('status', f.status);
    if (f.mode.trim()) params.set('mode', f.mode.trim());
    if (f.generationMode !== 'all') params.set('generationMode', f.generationMode);
    if (f.endpoint.trim()) params.set('endpoint', f.endpoint.trim());
    if (f.username.trim()) params.set('username', f.username.trim());
    if (f.scenarioDataCardId.trim()) params.set('scenarioDataCardId', f.scenarioDataCardId.trim());
    if (f.dateFrom) params.set('dateFrom', f.dateFrom);
    if (f.dateTo) params.set('dateTo', f.dateTo);
    if (f.hasSensitiveWords) params.set('hasSensitiveWords', '1');
    if (f.hasShieldWords) params.set('hasShieldWords', '1');

    return params;
  };

  const fetchRecords = async (page = 1, f: typeof filters = filters) => {
    setLoading(true);
    try {
      const params = buildListParams(page, f);

      const res = await fetch(`/api/admin/battle-report-generations?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(data.error || '获取战报生成记录失败');
      }
      setRecords(data.records || []);
      setTotal(Number(data.total || 0));
      setCurrentPage(Number(data.currentPage || page));
      setTotalPages(Number(data.totalPages || 1));
      setSelectedIds(new Set());
    } catch (error) {
      setMessage({ type: 'error', text: `获取战报生成记录失败: ${error instanceof Error ? error.message : '未知错误'}` });
    } finally {
      setLoading(false);
    }
  };

  const openDetail = async (id: string) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailData(null);
    outputRequestIdRef.current = id;
    setOutputLinksLoading(true);
    setOutputLinksError(null);
    setOutputLinks(null);

    void (async () => {
      try {
        const res = await fetch(`/api/admin/battle-report-output?generationId=${encodeURIComponent(id)}`);
        const data = (await res.json().catch(() => ({}))) as BattleReportOutputPresignResponse;
        if (!res.ok || data.success === false) {
          throw new Error((data as any)?.error || '获取 R2 正文下载链接失败');
        }
        if (outputRequestIdRef.current !== id) return;
        setOutputLinks(data as Extract<BattleReportOutputPresignResponse, { success: true }>);
      } catch (error) {
        if (outputRequestIdRef.current !== id) return;
        setOutputLinksError(error instanceof Error ? error.message : '未知错误');
      } finally {
        if (outputRequestIdRef.current !== id) return;
        setOutputLinksLoading(false);
      }
    })();

    try {
      const res = await fetch(`/api/admin/battle-report-generations?id=${encodeURIComponent(id)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(data.error || '获取详情失败');
      }
      setDetailData(data as BattleReportGenerationDetailResponse);
    } catch (error) {
      setDetailData({ success: false, generation: {}, combatants: [], error: error instanceof Error ? error.message : '未知错误' });
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setDetailOpen(false);
    setDetailData(null);
    outputRequestIdRef.current = null;
    setOutputLinksLoading(false);
    setOutputLinksError(null);
    setOutputLinks(null);
  };

  const toggleSelected = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllCurrentPage = () => {
    const ids = records.map(r => r.id);
    setSelectedIds(prev => {
      const next = new Set(prev);
      const allSelected = ids.every(id => next.has(id));
      if (allSelected) {
        for (const id of ids) next.delete(id);
      } else {
        for (const id of ids) next.add(id);
      }
      return next;
    });
  };

  const downloadJson = (data: unknown, filename: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportSelected = async () => {
    if (selectedIds.size === 0) {
      alert('请至少选择一条记录进行导出');
      return;
    }

    setIsExporting(true);
    try {
      const res = await fetch('/api/admin/export-battle-report-generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          generationIds: Array.from(selectedIds),
          includeCombatants: exportIncludeCombatants,
          maxRows: exportMaxRows,
        }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || result.success === false) throw new Error(result.error || '导出失败');
      downloadJson(
        { meta: result.meta, data: result.data },
        `battle_report_generations_selected_${new Date().toISOString()}.json`
      );
    } catch (error) {
      alert(`导出失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsExporting(false);
    }
  };

  const exportFiltered = async () => {
    setIsExporting(true);
    try {
      const params = new URLSearchParams(buildListParams(1, filters));
      params.delete('page');
      params.delete('limit');
      params.set('includeCombatants', exportIncludeCombatants ? '1' : '0');
      params.set('maxRows', String(exportMaxRows));
      const res = await fetch(`/api/admin/export-battle-report-generations?${params.toString()}`);
      const result = await res.json().catch(() => ({}));
      if (!res.ok || result.success === false) throw new Error(result.error || '导出失败');
      downloadJson(
        { meta: result.meta, filters, data: result.data },
        `battle_report_generations_filtered_${new Date().toISOString()}.json`
      );
      if (result.meta?.truncated) {
        alert(`已导出前 ${exportMaxRows} 条记录（总计 ${result.meta?.total || '未知'} 条）。建议收窄筛选条件后再次导出。`);
      }
    } catch (error) {
      alert(`导出失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsExporting(false);
    }
  };

  useEffect(() => {
    fetchRecords(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!router.isReady) return;
    const { username, userId, scenarioDataCardId, id } = router.query;
    let changed = false;
    const nextFilters = { ...filters };
    if (typeof username === 'string' && username.trim()) {
      nextFilters.username = username.trim();
      changed = true;
    }
    if (typeof scenarioDataCardId === 'string' && scenarioDataCardId.trim()) {
      nextFilters.scenarioDataCardId = scenarioDataCardId.trim();
      changed = true;
    }
    if (typeof userId === 'string' && userId.trim()) {
      nextFilters.search = userId.trim();
      changed = true;
    }
    if (changed) setFilters(nextFilters);

    if (typeof id === 'string' && id.trim()) {
      openDetail(id.trim());
    }

    if (changed) {
      fetchRecords(1, nextFilters);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 5000);
    return () => clearTimeout(timer);
  }, [message]);

  const allSelectedOnPage = records.length > 0 && records.every(r => selectedIds.has(r.id));

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-purple-50">
      <div className="w-full px-8 pt-8">
        <div className="mb-6 flex items-center justify-between">
          <Link href="/admin">
            <span className="text-sm text-purple-600 hover:underline cursor-pointer">&larr; 返回管理后台主页</span>
          </Link>
          <button
            onClick={() => fetchRecords(currentPage)}
            disabled={loading}
            className="px-3 py-2 rounded-lg bg-white border border-gray-200 hover:border-purple-300 text-gray-700 text-sm flex items-center gap-2 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </div>

      <div className="w-full px-8 pb-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2 flex items-center justify-center gap-2">
            <FileText className="w-8 h-8 text-orange-600" />
            战报生成记录
          </h1>
          <p className="text-gray-600">浏览、筛选、检索并导出战报生成记录</p>
        </div>

        {message && (
          <div className={`mb-6 p-4 rounded-lg ${message.type === 'success' ? 'bg-green-100 text-green-700 border border-green-200' : 'bg-red-100 text-red-700 border border-red-200'}`}>
            {message.text}
          </div>
        )}

        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
              <Filter className="w-5 h-5 text-orange-600" />
              筛选与检索
            </h2>
            <div className="text-sm text-gray-500">
              当前：{total} 条（第 {currentPage} / {totalPages} 页）
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            <div className="lg:col-span-2">
              <label className="block text-sm text-gray-600 mb-1">关键词（ID / 用户 / 情景 / 标题 / 胜者 / 角色名等）</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
	                <input
	                  value={filters.search}
	                  onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
	                  placeholder="例如：用户名 / generationId / 情景 / 胜者 / 角色名…"
	                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
	                />
              </div>
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-1">状态</label>
              <select
                value={filters.status}
                onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value as any }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-500"
              >
                <option value="all">全部</option>
                <option value="completed">完成</option>
                <option value="aborted">中断</option>
                <option value="failed">失败</option>
              </select>
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-1">生成方式</label>
              <select
                value={filters.generationMode}
                onChange={(e) => setFilters(prev => ({ ...prev, generationMode: e.target.value as any }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-500"
              >
                <option value="all">全部</option>
                <option value="stream">流式</option>
                <option value="non-stream">非流式</option>
              </select>
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-1">模式（classic / kizuna / daily / scenario）</label>
              <input
                value={filters.mode}
                onChange={(e) => setFilters(prev => ({ ...prev, mode: e.target.value }))}
                placeholder="可留空"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-1">用户（用户名包含）</label>
              <input
                value={filters.username}
                onChange={(e) => setFilters(prev => ({ ...prev, username: e.target.value }))}
                placeholder="例如：小圆"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-1">情景卡ID（精确）</label>
              <input
                value={filters.scenarioDataCardId}
                onChange={(e) => setFilters(prev => ({ ...prev, scenarioDataCardId: e.target.value }))}
                placeholder="例如：xxxxxxxx"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-1">端点（包含）</label>
              <input
                value={filters.endpoint}
                onChange={(e) => setFilters(prev => ({ ...prev, endpoint: e.target.value }))}
                placeholder="例如：api/arena/generate"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-1">日期（从）</label>
              <input
                type="date"
                value={filters.dateFrom}
                onChange={(e) => setFilters(prev => ({ ...prev, dateFrom: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-1">日期（到）</label>
              <input
                type="date"
                value={filters.dateTo}
                onChange={(e) => setFilters(prev => ({ ...prev, dateTo: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              />
            </div>

            <div className="flex items-end gap-3">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={filters.hasSensitiveWords}
                  onChange={(e) => setFilters(prev => ({ ...prev, hasSensitiveWords: e.target.checked }))}
                />
                含敏感词标记
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={filters.hasShieldWords}
                  onChange={(e) => setFilters(prev => ({ ...prev, hasShieldWords: e.target.checked }))}
                />
                含屏蔽词标记
              </label>
            </div>

            <div className="flex items-end gap-2">
              <button
                onClick={() => fetchRecords(1)}
                disabled={loading}
                className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50"
              >
                应用筛选
              </button>
              <button
                onClick={() => {
                  setFilters({
                    search: '',
                    status: 'all',
                    mode: '',
                    generationMode: 'all',
                    endpoint: '',
                    username: '',
                    scenarioDataCardId: '',
                    dateFrom: '',
                    dateTo: '',
                    hasSensitiveWords: false,
                    hasShieldWords: false,
                    sortBy: 'started_at',
                    sortOrder: 'desc',
                  });
                  setCurrentPage(1);
                  setSelectedIds(new Set());
                  setTimeout(() => fetchRecords(1), 0);
                }}
                disabled={loading}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50"
              >
                重置
              </button>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-lg p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <button
                onClick={toggleSelectAllCurrentPage}
                disabled={records.length === 0}
                className="px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm"
              >
                {allSelectedOnPage ? '取消全选(本页)' : '全选(本页)'}
              </button>

              <div className="text-sm text-gray-600">
                已选 <span className="font-semibold">{selectedIds.size}</span> 条
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={exportIncludeCombatants}
                  onChange={(e) => setExportIncludeCombatants(e.target.checked)}
                />
                导出包含参战者明细
              </label>

              <div className="flex items-center gap-2 text-sm text-gray-700">
                导出上限
                <input
                  type="number"
                  min={1}
                  max={50000}
                  value={exportMaxRows}
                  onChange={(e) => setExportMaxRows(parseInt(e.target.value || '0', 10) || 20000)}
                  className="w-28 px-2 py-1 border border-gray-300 rounded"
                />
              </div>

              <button
                onClick={exportSelected}
                disabled={isExporting || selectedIds.size === 0}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                导出选中
              </button>

              <button
                onClick={exportFiltered}
                disabled={isExporting}
                className="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-black disabled:opacity-50 flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                导出当前筛选（全部）
              </button>
            </div>
          </div>

          <AdminTableScroll withCard={false} className="rounded-lg border border-gray-200">
            <table className="min-w-full w-max text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-3 py-2 text-left w-10">
                    <input type="checkbox" checked={allSelectedOnPage} onChange={toggleSelectAllCurrentPage} />
                  </th>
                  <th className="px-3 py-2 text-left">时间</th>
                  <th className="px-3 py-2 text-left">状态</th>
                  <th className="px-3 py-2 text-left">用户</th>
                  <th className="px-3 py-2 text-left">模式</th>
                  <th className="px-3 py-2 text-left">情景</th>
                  <th className="px-3 py-2 text-left">参战者</th>
                  <th className="px-3 py-2 text-left">标题 / 胜者</th>
                  <th className="px-3 py-2 text-left">耗时</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Token（用量）</th>
                  <th className="px-3 py-2 text-left w-28">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td colSpan={11} className="px-3 py-6 text-center text-gray-500">加载中...</td>
                  </tr>
                ) : records.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-3 py-6 text-center text-gray-500">暂无记录</td>
                  </tr>
                ) : (
                  records.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(r.id)}
                          onChange={() => toggleSelected(r.id)}
                        />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="text-gray-800">{formatIso(r.started_at)}</div>
                        <div className="text-xs text-gray-400 font-mono">{r.id.slice(0, 8)}…</div>
                      </td>
	                      <td className="px-3 py-2 whitespace-nowrap">
	                        <span className={`inline-flex items-center px-2 py-1 rounded border text-xs ${statusBadge(r.status)}`}>
	                          <span title={r.status}>{formatStatus(r.status)}</span>
	                        </span>
                        {(r.status !== 'completed' || r.combatants_write_ok === 0) && (
                          <div className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" />
                            <span>{r.combatants_write_ok === 0 ? '参战者明细写入失败' : '非完成状态'}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {r.username ? (
                          <div className="flex items-center gap-2">
                            <User className="w-4 h-4 text-gray-400" />
                            <Link href={`/admin/user-management?username=${encodeURIComponent(r.username)}`}>
                              <span className="text-purple-600 hover:underline cursor-pointer">{r.username}</span>
                            </Link>
                          </div>
                        ) : (
                          <span className="text-gray-400">匿名</span>
                        )}
                        {typeof r.user_id === 'number' && (
                          <div className="text-xs text-gray-400">ID: {r.user_id}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="text-gray-800">{r.mode}</div>
                        <div className="text-xs text-gray-400">{r.generation_mode}</div>
                      </td>
                      <td className="px-3 py-2">
                        {r.scenario_title ? (
                          <div className="text-gray-800 truncate max-w-56" title={r.scenario_title}>{r.scenario_title}</div>
                        ) : (
                          <div className="text-gray-400">—</div>
                        )}
                        {r.scenario_data_card_id ? (
                          <div className="text-xs mt-1">
                            <Link href={`/admin/character-management?id=${encodeURIComponent(r.scenario_data_card_id)}`}>
                              <span className="text-purple-600 hover:underline cursor-pointer font-mono">{r.scenario_data_card_id}</span>
                            </Link>
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <div className="text-gray-800 truncate max-w-64" title={r.combatant_names || ''}>
                          {r.combatant_names || '—'}
                        </div>
                        {r.combatant_count != null && (
                          <div className="text-xs text-gray-400">数量：{r.combatant_count}</div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="text-gray-800 truncate max-w-56" title={r.headline || ''}>
                          {r.headline || '—'}
                        </div>
                        <div className="text-xs text-gray-400 truncate max-w-56" title={r.winner || ''}>
                          {r.winner ? `胜者：${r.winner}` : '胜者：—'}
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{formatDuration(r.duration_ms)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.total_tokens ?? '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <button
                          onClick={() => openDetail(r.id)}
                          className="px-3 py-2 rounded-lg bg-white border border-gray-200 hover:border-orange-300 text-gray-700 text-sm flex items-center gap-2"
                        >
                          <Eye className="w-4 h-4" />
                          详情
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </AdminTableScroll>

          {totalPages > 1 && (
            <div className="flex justify-center gap-2 mt-4">
              <button
                onClick={() => fetchRecords(currentPage - 1)}
                disabled={currentPage === 1 || loading}
                className="px-3 py-2 bg-gray-200 text-gray-700 rounded disabled:opacity-50"
              >
                上一页
              </button>
              <span className="px-3 py-2 bg-orange-100 text-orange-700 rounded">
                {currentPage} / {totalPages}
              </span>
              <button
                onClick={() => fetchRecords(currentPage + 1)}
                disabled={currentPage === totalPages || loading}
                className="px-3 py-2 bg-gray-200 text-gray-700 rounded disabled:opacity-50"
              >
                下一页
              </button>
            </div>
          )}
        </div>
      </div>

      {detailOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={closeDetail}>
          <div className="bg-white w-full max-w-5xl rounded-xl shadow-xl p-6 overflow-y-auto max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h3 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                  <Eye className="w-5 h-5 text-orange-600" />
                  记录详情
                </h3>
                <p className="text-sm text-gray-500">点击遮罩或右上角关闭</p>
              </div>
              <button onClick={closeDetail} className="p-2 rounded hover:bg-gray-100">
                <X className="w-5 h-5 text-gray-600" />
              </button>
            </div>

            {detailLoading ? (
              <div className="py-10 text-center text-gray-500">加载中...</div>
            ) : detailData?.success === false ? (
              <div className="py-10 text-center text-red-600">{detailData.error || '获取详情失败'}</div>
            ) : detailData ? (
              <div className="grid lg:grid-cols-2 gap-6">
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                  <h4 className="font-semibold text-gray-800 mb-3">基础信息</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between gap-4"><span className="text-gray-500">ID</span><span className="font-mono break-all">{String(detailData.generation.id || '')}</span></div>
                    <div className="flex justify-between gap-4"><span className="text-gray-500">开始</span><span>{formatIso(String(detailData.generation.started_at || ''))}</span></div>
                    <div className="flex justify-between gap-4"><span className="text-gray-500">结束</span><span>{formatIso(String(detailData.generation.ended_at || ''))}</span></div>
                    <div className="flex justify-between gap-4"><span className="text-gray-500">耗时</span><span>{formatDuration(Number(detailData.generation.duration_ms || 0))}</span></div>
                    <div className="flex justify-between gap-4"><span className="text-gray-500">状态</span><span>{String(detailData.generation.status || '')}</span></div>
                    <div className="flex justify-between gap-4"><span className="text-gray-500">模式</span><span>{String(detailData.generation.mode || '')}</span></div>
                    <div className="flex justify-between gap-4"><span className="text-gray-500">生成方式</span><span>{String(detailData.generation.generation_mode || '')}</span></div>
                    <div className="flex justify-between gap-4"><span className="text-gray-500">端点</span><span className="font-mono break-all">{String(detailData.generation.endpoint || '')}</span></div>
                    <div className="flex justify-between gap-4"><span className="text-gray-500">用户</span><span>{detailData.generation.username ? String(detailData.generation.username) : '匿名'}</span></div>
                    {detailData.generation.username ? (
                      <div className="flex justify-end">
                        <Link href={`/admin/user-management?username=${encodeURIComponent(String(detailData.generation.username))}`}>
                          <span className="text-purple-600 hover:underline cursor-pointer text-sm">打开用户管理页</span>
                        </Link>
                      </div>
                    ) : null}
                    {detailData.generation.scenario_data_card_id ? (
                      <div className="flex justify-between gap-4">
                        <span className="text-gray-500">情景卡</span>
                        <Link href={`/admin/character-management?id=${encodeURIComponent(String(detailData.generation.scenario_data_card_id))}`}>
                          <span className="text-purple-600 hover:underline cursor-pointer font-mono break-all">{String(detailData.generation.scenario_data_card_id)}</span>
                        </Link>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                  <h4 className="font-semibold text-gray-800 mb-3">参战者明细</h4>
                  {detailData.combatants.length === 0 ? (
                    <div className="text-sm text-gray-500">无参战者明细（或写入失败）</div>
                  ) : (
                    <div className="space-y-2 text-sm">
                      {detailData.combatants.map((c: any) => (
                        <div key={String(c.id)} className="flex items-start justify-between gap-4 border border-gray-200 bg-white rounded-lg p-3">
                          <div>
                            <div className="font-medium text-gray-800">{String(c.name || '')}</div>
                            <div className="text-xs text-gray-500">type: {c.type || '—'} / team: {c.team_id ?? '—'}</div>
                          </div>
                          <div className="text-right">
                            {c.data_card_id ? (
                              <Link href={`/admin/character-management?id=${encodeURIComponent(String(c.data_card_id))}`}>
                                <span className="text-purple-600 hover:underline cursor-pointer font-mono">{String(c.data_card_id)}</span>
                              </Link>
                            ) : (
                              <span className="text-gray-400 font-mono">—</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="lg:col-span-2 bg-gray-50 rounded-lg p-4 border border-gray-200">
                  <h4 className="font-semibold text-gray-800 mb-3">输出预览 / 标记</h4>

                  <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-gray-500">R2 正文</span>
                    {outputLinksLoading ? (
                      <span className="text-gray-500">加载中...</span>
                    ) : outputLinksError ? (
                      <span className="text-red-600">{outputLinksError}</span>
                    ) : outputLinks?.candidates?.length ? (
                      <>
                        {outputLinks.candidates.map((item) => (
                          <a
                            key={item.r2Key}
                            href={item.downloadUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-gray-700 hover:bg-gray-50"
                          >
                            <Download className="h-3 w-3" />
                            下载 {item.format === 'json' ? 'JSON' : 'Markdown'}
                          </a>
                        ))}
                        <span className="text-gray-400">
                          {outputLinks.indexed ? '（已索引）' : '（未索引，可能需要确认对象是否存在）'}
                        </span>
                        <span className="text-gray-400">有效期 {outputLinks.expiresInSeconds}s</span>
                      </>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </div>

                  <div className="grid md:grid-cols-3 gap-4 text-sm mb-4">
                    <div className="bg-white border border-gray-200 rounded-lg p-3">
                      <div className="text-gray-500 text-xs mb-1">标题</div>
                      <div className="text-gray-800">{String(detailData.generation.headline || '—')}</div>
                    </div>
                    <div className="bg-white border border-gray-200 rounded-lg p-3">
                      <div className="text-gray-500 text-xs mb-1">胜者</div>
                      <div className="text-gray-800">{String(detailData.generation.winner || '—')}</div>
                    </div>
                    <div className="bg-white border border-gray-200 rounded-lg p-3">
                      <div className="text-gray-500 text-xs mb-1">敏感/屏蔽标记</div>
                      <div className="text-gray-800">
                        {detailData.generation.output_has_sensitive_words ? '敏感词 ' : ''}
                        {detailData.generation.output_has_shield_words ? '屏蔽词' : ''}
                        {!detailData.generation.output_has_sensitive_words && !detailData.generation.output_has_shield_words ? '—' : ''}
                      </div>
                    </div>
                  </div>

                  <pre className="whitespace-pre-wrap text-xs bg-white border border-gray-200 rounded-lg p-3 max-h-80 overflow-auto">
                    {String(detailData.generation.output_preview || '—')}
                  </pre>

                  {detailData.generation.extra_json ? (
                    <div className="mt-4">
                      <h5 className="font-semibold text-gray-800 mb-2">extra_json</h5>
                      <pre className="whitespace-pre-wrap text-xs bg-white border border-gray-200 rounded-lg p-3 max-h-72 overflow-auto">
                        {JSON.stringify(detailData.generation.extra_json, null, 2)}
                      </pre>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="py-10 text-center text-gray-500">未选择记录</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
