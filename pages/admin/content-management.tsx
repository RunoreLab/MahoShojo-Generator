// pages/admin/content-management.tsx

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { debounce } from 'lodash';
import DataCardDetailsModal from '@/components/DataCardDetailsModal';

// 定义数据卡类型接口
interface DataCard {
  id: string;
  name: string;
  description: string;
  data: string; // 确保 data 字段存在
  type: 'character' | 'scenario';
  is_public: -1 | 0 | 1;
  review_status: 'pending' | 'approved' | 'rejected';
  username: string;
  like_count: number;
  usage_count: number;
  favorite_count: number;
  is_recommended: number;
  created_at: string;
  updated_at: string;
}

// AI审查结果类型
interface AiReviewResult {
    id: string;
    name: string;
    suggestion: 'approved' | 'rejected';
    reason: string;
}

const CharacterManagementPage: React.FC = () => {
  const router = useRouter();
  const [selectedCardDetails, setSelectedCardDetails] = useState<DataCard | null>(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);

  const [dataCards, setDataCards] = useState<DataCard[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    page: 1,
    limit: 20,
    search: '',
    reviewStatus: '',
    isPublic: '',
    type: '',
    isRecommended: '',
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isExporting, setIsExporting] = useState(false);

  // AI 审查相关状态
  const [showAiReviewModal, setShowAiReviewModal] = useState(false);
  const [isAiReviewing, setIsAiReviewing] = useState(false);
  const [aiReviewResults, setAiReviewResults] = useState<AiReviewResult[]>([]);
  const [markedActions, setMarkedActions] = useState<Record<string, 'approve' | 'reject'>>({});
  const [aiBatchSize, setAiBatchSize] = useState(20);
  const [aiModel, setAiModel] = useState('gemini-2.5-flash-lite');
  const [externalReviewContent, setExternalReviewContent] = useState(''); // [新增] 外部审查粘贴内容
  const [copyStatus, setCopyStatus] = useState(''); // [新增] 复制按钮状态

  const fetchData = useCallback(async (currentFilters: typeof filters) => {
    setLoading(true);
    setSelectedIds(new Set());
    try {
      const params = new URLSearchParams({
        page: currentFilters.page.toString(),
        limit: currentFilters.limit.toString(),
        search: currentFilters.search,
        reviewStatus: currentFilters.reviewStatus,
        isPublic: currentFilters.isPublic,
        type: currentFilters.type,
        isRecommended: currentFilters.isRecommended,
      });
      const response = await fetch(`/api/admin/data-cards?${params.toString()}`);
      if (!response.ok) throw new Error('获取数据失败');
      const data = await response.json();
      setDataCards(data.cards);
      setTotal(data.total);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, []);
  
  useEffect(() => {
    if (router.isReady) {
      const newFilters = {
        page: parseInt(router.query.page as string || '1', 10),
        limit: 20,
        search: router.query.search as string || '',
        reviewStatus: router.query.reviewStatus as string || '',
        isPublic: router.query.isPublic as string || '',
        type: router.query.type as string || '',
        isRecommended: router.query.isRecommended as string || '',
      };
      setFilters(newFilters);
      fetchData(newFilters);
    }
  }, [router.isReady, router.query, fetchData]);

  // useEffect 钩子，用于在 AI 审查结果加载后自动更新操作标记。
  useEffect(() => {
    if (aiReviewResults.length > 0) {
        const newMarkedActions: Record<string, 'approve' | 'reject'> = {};
        aiReviewResults.forEach(result => {
            // 注意: AI 返回的建议可能是 'approved'/'rejected'，
            // 而我们的状态管理使用的是 'approve'/'reject'，这里做一个简单的映射。
            if (result.suggestion === 'approved') {
                newMarkedActions[result.id] = 'approve';
            } else if (result.suggestion === 'rejected') {
                newMarkedActions[result.id] = 'reject';
            }
        });
        setMarkedActions(newMarkedActions);
    }
  }, [aiReviewResults]); // 依赖项是 aiReviewResults

  const updateUrl = useCallback((newFilters: typeof filters) => {
      const query: { [key: string]: any } = {};
      if (newFilters.page > 1) query.page = newFilters.page;
      if (newFilters.search) query.search = newFilters.search;
      if (newFilters.reviewStatus) query.reviewStatus = newFilters.reviewStatus;
      if (newFilters.isPublic) query.isPublic = newFilters.isPublic;
      if (newFilters.type) query.type = newFilters.type;
      if (newFilters.isRecommended) query.isRecommended = newFilters.isRecommended;
      
      router.push({ pathname: router.pathname, query }, undefined, { shallow: true });
  }, [router]);

  const debouncedUpdateUrl = useMemo(() => debounce(updateUrl, 300), [updateUrl]);

  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    const newFilters = { ...filters, [name]: value, page: 1 };
    setFilters(newFilters);
    debouncedUpdateUrl(newFilters);
  };
  
  const handlePageChange = (newPage: number) => {
    if (newPage > 0 && newPage <= Math.ceil(total / filters.limit)) {
      const newFilters = { ...filters, page: newPage };
      setFilters(newFilters);
      updateUrl(newFilters);
    }
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedIds(e.target.checked ? new Set(dataCards.map(card => card.id)) : new Set());
  };

  const handleSelectOne = (id: string) => {
    const newSelectedIds = new Set(selectedIds);
    if (newSelectedIds.has(id)) {
        newSelectedIds.delete(id);
    } else {
        newSelectedIds.add(id);
    }
    setSelectedIds(newSelectedIds);
  };

  const handleViewDetails = (card: DataCard) => {
    setSelectedCardDetails(card);
    setIsDetailsModalOpen(true);
  };

  const handleBatchAction = async (action: string, value?: any) => {
    if (selectedIds.size === 0) return alert('请至少选择一个项目');
    if (!window.confirm(`确定要对选中的 ${selectedIds.size} 个项目执行此操作吗？`)) return;

    try {
      const response = await fetch('/api/admin/data-cards/batch-update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardIds: Array.from(selectedIds), action, value }),
      });
      if (!response.ok) throw new Error('操作失败');
      alert('操作成功！');
      fetchData(filters);
    } catch (error) {
      alert(`操作失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  // 批量导出处理函数
  const handleExport = async () => {
    if (selectedIds.size === 0) {
      alert('请至少选择一个项目进行导出');
      return;
    }
    setIsExporting(true);
    try {
      const response = await fetch('/api/admin/export-data-cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardIds: Array.from(selectedIds) }),
      });
      if (!response.ok) throw new Error('导出失败');

      const result = await response.json();
      if (!result.success) throw new Error(result.error || '导出失败');

      // 创建并下载JSON文件
      const jsonData = JSON.stringify(result.data, null, 2);
      const blob = new Blob([jsonData], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `exported_data_cards_${new Date().toISOString()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

    } catch (error) {
      alert('导出失败，请查看控制台');
      console.error('导出失败:', error);
    } finally {
      setIsExporting(false);
    }
  };

  // --- AI 审查处理函数 ---
  const handleOpenAiReview = () => {
    setAiReviewResults([]);
    setMarkedActions({});
    setExternalReviewContent('');
    setCopyStatus('');
    setShowAiReviewModal(true);
  };

  const handleStartAiReview = async () => {
    const pendingCards = dataCards.filter(card => card.review_status === 'pending');
    const idsToReview = pendingCards.slice(0, aiBatchSize).map(card => card.id);

    if (idsToReview.length === 0) {
      alert('当前筛选条件下没有待审查的内容。');
      return;
    }
    
    setIsAiReviewing(true);
    setAiReviewResults([]);
    try {
      const response = await fetch('/api/admin/ai-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardIds: idsToReview, model: aiModel }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'AI审查请求失败');
      setAiReviewResults(result.reviews);
    } catch (error) {
      alert(`AI审查失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsAiReviewing(false);
    }
  };

  const handleMarkAction = (id: string, action: 'approve' | 'reject') => {
    setMarkedActions(prev => ({ ...prev, [id]: action }));
  };

  const handleExecuteMarkedActions = async () => {
    const actionsToExecute = Object.entries(markedActions);
    if (actionsToExecute.length === 0) return alert('没有已标记的操作');

    const approveIds = actionsToExecute.filter(([, action]) => action === 'approve').map(([id]) => id);
    const rejectIds = actionsToExecute.filter(([, action]) => action === 'reject').map(([id]) => id);

    if (!window.confirm(`即将通过 ${approveIds.length} 项，拒绝 ${rejectIds.length} 项。是否继续？`)) return;

    try {
      if (approveIds.length > 0) {
        await fetch('/api/admin/data-cards/batch-update', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cardIds: approveIds, action: 'approve' }),
        });
      }
      if (rejectIds.length > 0) {
        await fetch('/api/admin/data-cards/batch-update', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cardIds: rejectIds, action: 'reject' }),
        });
      }
      alert('操作成功！');
      setShowAiReviewModal(false);
      fetchData(filters); // 刷新主列表
    } catch (error) {
      alert(`执行失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  // [新增] 外部审查 - 复制内容到剪贴板
  const handleCopyToClipboard = () => {
    const pendingCards = dataCards.filter(card => card.review_status === 'pending');
    if (pendingCards.length === 0) {
      alert('当前筛选条件下没有待审查的内容。');
      return;
    }

    const cardsToCopy = pendingCards.map(card => ({
        id: card.id,
        content: {
            name: card.name,
            description: card.description,
            data: JSON.parse(card.data) // 解析 data 字符串为 JSON 对象
        }
    }));
    
    const promptForLLM = `
You are a content moderator. Please review the following data cards based on our content policy (no politics, hate speech, explicit content, etc.). 
For each card, provide your suggestion ('approved' or 'rejected') and a brief reason in Chinese. 
Your entire response MUST be a single, valid JSON array of objects, with no other text before or after it.

Example format:
[
  { "id": "...", "suggestion": "approved", "reason": "虽存在部分擦边内容，但不存在明显不适宜的内容。" },
  { "id": "...", "suggestion": "rejected", "reason": "令人不适的内容：恐怖猎奇的行为。" }
]

Here is the batch of data cards to review:

${JSON.stringify(cardsToCopy, null, 2)}
`;
    navigator.clipboard.writeText(promptForLLM).then(() => {
        setCopyStatus(`已成功复制 ${cardsToCopy.length} 条待审查内容到剪贴板！`);
        setTimeout(() => setCopyStatus(''), 3000);
    }).catch(err => {
        alert('复制失败，请检查浏览器权限。');
        console.error('复制失败:', err);
    });
  };

  // [新增] 外部审查 - 解析并应用结果
  const handleParseAndApply = () => {
      if (!externalReviewContent.trim()) {
          alert('请将外部 AI 的审查结果粘贴到文本框中。');
          return;
      }
      try {
          const parsedResults = JSON.parse(externalReviewContent);
          if (!Array.isArray(parsedResults)) {
              throw new Error('粘贴的内容不是一个有效的 JSON 数组。');
          }
          
          // 验证数组中的每个对象是否符合格式
          const validatedResults: AiReviewResult[] = parsedResults.map(item => {
              if (!item.id || !item.suggestion || !['approved', 'rejected'].includes(item.suggestion) || typeof item.reason === 'undefined') {
                  throw new Error(`解析失败：对象 ${JSON.stringify(item)} 缺少 id, suggestion, 或 reason 字段。`);
              }
              const originalCard = dataCards.find(c => c.id === item.id);
              return {
                  id: item.id,
                  name: originalCard?.name || item.id,
                  suggestion: item.suggestion,
                  reason: item.reason
              };
          });

          setAiReviewResults(validatedResults);
          setExternalReviewContent(''); // 清空文本框
          alert(`成功解析并加载了 ${validatedResults.length} 条审查建议！`);
      } catch (error) {
          alert(`解析失败: ${error instanceof Error ? error.message : '无效的JSON格式'}`);
          console.error('解析外部审查结果失败:', error);
      }
  };

  const totalPages = Math.ceil(total / filters.limit);
  const getReviewStatusBadge = (status: DataCard['review_status']) => {
      const map = {
          pending: { text: '待审查', color: 'bg-yellow-100 text-yellow-800' },
          approved: { text: '已通过', color: 'bg-green-100 text-green-800' },
          rejected: { text: '未通过', color: 'bg-red-100 text-red-800' },
      };
      return <span className={`px-2 py-1 text-xs font-medium rounded-full ${map[status].color}`}>{map[status].text}</span>;
  };
  const getPublicStatusBadge = (status: DataCard['is_public']) => {
      const map = {
          '1': { text: '公开', color: 'bg-blue-100 text-blue-800' },
          '0': { text: '私有', color: 'bg-gray-100 text-gray-800' },
          '-1': { text: '封禁', color: 'bg-zinc-200 text-zinc-800 font-bold' },
      };
      const key = String(status);
      return <span className={`px-2 py-1 text-xs font-medium rounded-full ${map[key as keyof typeof map].color}`}>{map[key as keyof typeof map].text}</span>;
  };

  return (
    <>
      <Head>
        <title>内容档案管理 - Admin</title>
      </Head>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-7xl mx-auto">
          <div className="mb-4">
            <Link href="/admin">
              <span className="text-sm text-purple-600 hover:underline cursor-pointer">&larr; 返回管理后台主页</span>
            </Link>
          </div>
          <h1 className="text-2xl font-bold text-gray-800 mb-4">内容档案管理</h1>

          {/* 筛选器区域 */}
          <div className="bg-white p-4 rounded-lg shadow-sm mb-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <input
                type="text"
                name="search"
                defaultValue={router.query.search || ''} // 使用 router.query 初始化以避免UI跳动
                onChange={handleFilterChange}
                placeholder="搜索名称、描述、作者..."
                className="input-field"
              />
              <select name="reviewStatus" value={filters.reviewStatus} onChange={handleFilterChange} className="input-field">
                <option value="">所有审查状态</option>
                <option value="pending">待审查</option>
                <option value="approved">已通过</option>
                <option value="rejected">未通过</option>
              </select>
              <select name="isPublic" value={filters.isPublic} onChange={handleFilterChange} className="input-field">
                <option value="">所有公开状态</option>
                <option value="1">公开</option>
                <option value="0">私有</option>
                <option value="-1">封禁</option>
              </select>
              <select name="type" value={filters.type} onChange={handleFilterChange} className="input-field">
                <option value="">所有类型</option>
                <option value="character">角色</option>
                <option value="scenario">情景</option>
              </select>
              <select name="isRecommended" value={filters.isRecommended} onChange={handleFilterChange} className="input-field">
                <option value="">推荐状态</option>
                <option value="1">仅推荐</option>
                <option value="0">未推荐</option>
              </select>
            </div>
          </div>

          {/* 操作栏 */}
          <div className="bg-white p-4 rounded-lg shadow-sm mb-4 flex flex-wrap items-center gap-2">
            <span className="text-sm text-gray-600 mr-4">选中 {selectedIds.size} / {dataCards.length} 项 (共 {total} 项)</span>
            <div className="flex-grow flex flex-wrap gap-2">
                <button onClick={() => handleBatchAction('approve')} className="admin-button-sm bg-green-500 hover:bg-green-600">通过审查</button>
                <button onClick={() => handleBatchAction('reject')} className="admin-button-sm bg-red-500 hover:bg-red-600">拒绝审查</button>
                <button onClick={() => handleBatchAction('set_public_status', 1)} className="admin-button-sm bg-blue-500 hover:bg-blue-600">设为公开</button>
                <button onClick={() => handleBatchAction('set_public_status', 0)} className="admin-button-sm bg-gray-500 hover:bg-gray-600">设为私有</button>
                <button onClick={() => handleBatchAction('set_public_status', -1)} className="admin-button-sm bg-zinc-500 hover:bg-zinc-600">设为封禁</button>
                <button onClick={() => handleBatchAction('set_recommended', 1)} className="admin-button-sm bg-amber-500 hover:bg-amber-600 text-white">设为推荐</button>
                <button onClick={() => handleBatchAction('set_recommended', 0)} className="admin-button-sm bg-amber-200 hover:bg-amber-300 text-amber-800">取消推荐</button>
                <button onClick={handleExport} className="admin-button-sm bg-teal-500 hover:bg-teal-600 disabled:opacity-50" disabled={isExporting || selectedIds.size === 0}>
                  {isExporting ? '导出中...' : '导出选中项'}
                </button>
                <button onClick={handleOpenAiReview} className="admin-button-sm bg-indigo-500 hover:bg-indigo-600">AI 辅助审查</button>
            </div>
          </div>
          
          {/* 数据表格 */}
          <div className="bg-white rounded-lg shadow-sm overflow-x-auto">
            <table className="w-full text-sm text-left text-gray-500">
              <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                <tr>
                  <th scope="col" className="p-4"><input type="checkbox" onChange={handleSelectAll} checked={selectedIds.size === dataCards.length && dataCards.length > 0} /></th>
                  <th scope="col" className="px-6 py-3">名称 / 作者</th>
                  <th scope="col" className="px-6 py-3">类型</th>
                  <th scope="col" className="px-6 py-3">公开状态</th>
                  <th scope="col" className="px-6 py-3">审查状态</th>
                  <th scope="col" className="px-6 py-3 whitespace-nowrap">点赞 / 收藏 / 使用</th>
                  <th scope="col" className="px-6 py-3">内容预览</th>
                  <th scope="col" className="px-6 py-3">更新时间</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="text-center p-8">加载中...</td></tr>
                ) : dataCards.length === 0 ? (
                  <tr><td colSpan={8} className="text-center p-8">未找到符合条件的数据</td></tr>
                ) : (
                  dataCards.map(card => (
                    <tr key={card.id} className="bg-white border-b hover:bg-gray-50">
                      <td className="p-4"><input type="checkbox" onChange={() => handleSelectOne(card.id)} checked={selectedIds.has(card.id)} /></td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => handleViewDetails(card)}
                          className="font-medium text-purple-600 hover:underline text-left"
                        >
                          {card.name}
                          {card.is_recommended === 1 && (
                            <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full bg-amber-100 text-amber-700">
                              <span>推荐</span>
                            </span>
                          )}
                        </button>
                        <div className="text-xs text-gray-500">by {card.username}</div>
                      </td>
                      <td className="px-6 py-4">{card.type === 'character' ? '角色' : '情景'}</td>
                      <td className="px-6 py-4">{getPublicStatusBadge(card.is_public)}</td>
                      <td className="px-6 py-4">{getReviewStatusBadge(card.review_status)}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        ❤️ {card.like_count} / ⭐ {card.favorite_count} / 📥 {card.usage_count}
                      </td>
                      {/* 内容预览列 */}
                      <td className="px-6 py-4 text-xs text-gray-500 max-w-xs">
                        {(() => {
                            // 定义无意义的默认描述
                            const defaultDescriptions = ['角色数据卡', '情景数据卡'];
                            // 判断当前描述是否有意义
                            const isMeaningfulDescription = card.description && !defaultDescriptions.includes(card.description.trim());
                            
                            // 如果描述有意义，则显示描述；否则，显示data字段的内容
                            const contentToShow = isMeaningfulDescription ? card.description : card.data;
                            let titleToShow = contentToShow;
                            try {
                                // 为悬浮提示（title）美化JSON格式
                                if (!isMeaningfulDescription) {
                                    titleToShow = JSON.stringify(JSON.parse(card.data), null, 2);
                                }
                            } catch(e) { console.error('❌ 发生解析错误:', e); }

                            return (
                                <p className="truncate" title={titleToShow}>
                                    {contentToShow}
                                </p>
                            );
                        })()}
                      </td>
                      <td className="px-6 py-4">{new Date(card.updated_at).toLocaleString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* 分页 */}
          {totalPages > 1 && (
              <div className="flex justify-between items-center mt-4 text-sm">
                  <button onClick={() => handlePageChange(filters.page - 1)} disabled={loading || filters.page <= 1} className="admin-button-sm">上一页</button>
                  <span>第 {filters.page} / {totalPages} 页 (共 {total} 项)</span>
                  <button onClick={() => handlePageChange(filters.page + 1)} disabled={loading || filters.page >= totalPages} className="admin-button-sm">下一页</button>
              </div>
          )}
        </div>
      </div>
      
      {/* AI 辅助审查模态框 */}
      {showAiReviewModal && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-lg shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col">
                  <div className="flex justify-between items-center p-4 border-b">
                      <h2 className="text-lg font-bold">AI 辅助审查</h2>
                      <button onClick={() => setShowAiReviewModal(false)} className="text-gray-500 hover:text-gray-800 text-2xl">&times;</button>
                  </div>
                  <div className="flex-grow flex flex-col md:flex-row overflow-hidden">
                      {/* 左侧控制与结果区 */}
                      <div className="w-full md:w-1/2 flex flex-col border-r">
                          <div className="p-4 space-y-4">
                              <div className="flex items-center gap-4">
                                  <div>
                                      <label className="text-sm font-medium">单次处理数量</label>
                                      <input type="number" value={aiBatchSize} onChange={e => setAiBatchSize(parseInt(e.target.value))} className="input-field w-24 mt-1" min="1" max="50" />
                                  </div>
                                  <div>
                                    <label className="text-sm font-medium">使用模型</label>
                                    <select value={aiModel} onChange={e => setAiModel(e.target.value)} className="input-field mt-1">
                                        {/* Google Models */}
                                        <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                                        <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash Lite</option>
                                        <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
                                        
                                        {/* Grok Models */}
                                        <option value="grok-2">Grok 2</option>
                                        <option value="grok-3">Grok 3</option>
                                        <option value="grok-3-fast">Grok 3 Fast</option>
                                        <option value="grok-3-mini">Grok 3 Mini</option>
                                        <option value="grok-3-mini-fast">Grok 3 Mini Fast</option>
                                        <option value="grok-4">Grok 4</option>

                                        {/* Qwen Models */}
                                        <option value="qwen-plus-latest">Qwen Plus (Latest)</option>
                                        <option value="qwen-turbo-latest">Qwen Turbo (Latest)</option>
                                      </select>
                                  </div>
                                  <button onClick={handleStartAiReview} disabled={isAiReviewing} className="admin-button-sm bg-indigo-500 hover:bg-indigo-600 self-end">
                                      {isAiReviewing ? '审查中...' : `开始审查`}
                                  </button>
                              </div>
                              <p className="text-xs text-gray-500">将从当前筛选结果中，选取最多 {aiBatchSize} 项“待审查”的内容进行分析。</p>
                          </div>
                          <div className="flex-grow overflow-y-auto p-4 border-t">
                              {isAiReviewing && <div className="text-center">AI 正在努力分析中...</div>}
                              {aiReviewResults.length === 0 && !isAiReviewing && <div className="text-center text-gray-500">暂无审查结果</div>}
                              {aiReviewResults.length > 0 && (
                                  <div className="space-y-2">
                                      {aiReviewResults.map(res => (
                                          <div key={res.id} className="p-3 bg-gray-50 rounded-lg border">
                                              <p className="font-semibold">{res.name}</p>
                                              <p className={`text-sm font-bold ${res.suggestion === 'approved' ? 'text-green-600' : 'text-red-600'}`}>AI建议: {res.suggestion === 'approved' ? '通过' : '拒绝'}</p>
                                              <p className="text-xs text-gray-600 italic">理由: {res.reason}</p>
                                              <div className="mt-2 flex gap-2">
                                                  <label className="flex items-center text-xs cursor-pointer"><input type="radio" name={`action-${res.id}`} onChange={() => handleMarkAction(res.id, 'approve')} checked={markedActions[res.id] === 'approve'}/><span className="ml-1">通过</span></label>
                                                  <label className="flex items-center text-xs cursor-pointer"><input type="radio" name={`action-${res.id}`} onChange={() => handleMarkAction(res.id, 'reject')} checked={markedActions[res.id] === 'reject'}/><span className="ml-1">拒绝</span></label>
                                              </div>
                                          </div>
                                      ))}
                                  </div>
                              )}
                          </div>
                      </div>
                      {/* 右侧外部工作流 */}
                      <div className="w-full md:w-1/2 flex flex-col">
                          <div className="p-4">
                              <h3 className="font-semibold mb-2">外部 AI 审查工作流</h3>
                              <button onClick={handleCopyToClipboard} className="admin-button-sm bg-gray-600 hover:bg-gray-700 w-full mb-2">1. 复制内容以供外部审查</button>
                              {copyStatus && <p className="text-xs text-green-600 text-center mb-2">{copyStatus}</p>}
                              <textarea value={externalReviewContent} onChange={e => setExternalReviewContent(e.target.value)} placeholder="2. 在此处粘贴外部 AI 返回的 JSON 数组结果..." className="input-field w-full h-32 resize-y"></textarea>
                              <button onClick={handleParseAndApply} className="admin-button-sm bg-blue-600 hover:bg-blue-700 w-full mt-2">3. 解析并应用建议</button>
                          </div>
                      </div>
                  </div>
                  <div className="p-4 border-t flex justify-end">
                      <button onClick={handleExecuteMarkedActions} disabled={Object.keys(markedActions).length === 0} className="admin-button-sm bg-green-600 hover:bg-green-700">
                          执行所有已标记操作 ({Object.keys(markedActions).length})
                      </button>
                  </div>
              </div>
          </div>
      )}
      {/* 详情弹窗组件 */}
      {selectedCardDetails && (
        <DataCardDetailsModal
          isOpen={isDetailsModalOpen}
          onClose={() => setIsDetailsModalOpen(false)}
          card={{
            id: selectedCardDetails.id,
            name: selectedCardDetails.name,
            description: selectedCardDetails.description,
            type: selectedCardDetails.type,
            data: selectedCardDetails.data,
            isPublic: selectedCardDetails.is_public === 1,
            usageCount: selectedCardDetails.usage_count,
            likeCount: selectedCardDetails.like_count,
            favoriteCount: selectedCardDetails.favorite_count,
            author: selectedCardDetails.username,
            createdAt: selectedCardDetails.created_at,
            updatedAt: selectedCardDetails.updated_at
          }}
        />
      )}
    </>
  );
};

export default CharacterManagementPage;
