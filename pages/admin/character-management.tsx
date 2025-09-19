import React, { useState, useEffect } from 'react';
import { Search, Save, X, Database, Eye, Ban, CheckCircle, AlertTriangle, Calendar, User, Hash } from 'lucide-react';
import { getDataCardStatus } from '@/lib/database/data-cards';

interface DataCard {
  id: string;
  user_id: number;
  type: 'character' | 'scenario';
  name: string;
  description: string;
  data: string;
  is_public: number;
  usage_count: number;
  like_count: number;
  created_at: string;
  updated_at: string;
  username?: string;
}

interface EditFormData {
  name: string;
  description: string;
  is_public: number;
}

export default function CharacterManagement() {
  const [cards, setCards] = useState<DataCard[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCard, setSelectedCard] = useState<DataCard | null>(null);
  const [editingCard, setEditingCard] = useState<EditFormData | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [typeFilter, setTypeFilter] = useState<'all' | 'character' | 'scenario'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'public' | 'private' | 'banned'>('all');
  const [viewingData, setViewingData] = useState(false);

  // 获取所有角色卡
  const fetchCards = async (page = 1, search = '', type = typeFilter, status = statusFilter) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '20',
        ...(search && { search }),
        ...(type !== 'all' && { type }),
        ...(status !== 'all' && { status })
      });

      const response = await fetch(`/api/admin/data-cards?${params}`);
      if (response.ok) {
        const data = await response.json();
        setCards(data.cards || []);
        setTotalPages(data.totalPages || 1);
        setCurrentPage(data.currentPage || 1);
      } else {
        setMessage({ type: 'error', text: '获取角色卡列表失败' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: '获取角色卡列表失败: ' + error });
    } finally {
      setLoading(false);
    }
  };

  // 搜索角色卡
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetchCards(1, searchTerm, typeFilter, statusFilter);
  };

  // 获取单个角色卡详情
  const fetchCardDetails = async (cardId: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/data-cards?id=${encodeURIComponent(cardId)}`);
      if (response.ok) {
        const card = await response.json();
        setSelectedCard(card);
        setEditingCard({
          name: card.name,
          description: card.description || '',
          is_public: card.is_public
        });
      } else {
        setMessage({ type: 'error', text: '获取角色卡详情失败' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: '获取角色卡详情失败: ' + error });
    } finally {
      setLoading(false);
    }
  };

  // 保存角色卡更新
  const saveCardUpdate = async () => {
    if (!editingCard || !selectedCard) return;

    setLoading(true);
    try {
      const response = await fetch(`/api/admin/data-cards/${selectedCard.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editingCard.name,
          description: editingCard.description,
          is_public: editingCard.is_public
        })
      });

      if (response.ok) {
        const updatedCard = await response.json();
        setSelectedCard(updatedCard);
        setCards(cards.map(c => c.id === updatedCard.id ? updatedCard : c));
        setEditingCard({
          name: updatedCard.name,
          description: updatedCard.description || '',
          is_public: updatedCard.is_public
        });
        setMessage({ type: 'success', text: '角色卡信息更新成功' });
      } else {
        setMessage({ type: 'error', text: '更新角色卡信息失败' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: '更新角色卡信息失败: ' + error });
    } finally {
      setLoading(false);
    }
  };

  // 重置编辑表单
  const resetEditing = () => {
    if (selectedCard) {
      setEditingCard({
        name: selectedCard.name,
        description: selectedCard.description || '',
        is_public: selectedCard.is_public
      });
    }
  };

  // 查看角色卡数据
  const viewCardData = () => {
    setViewingData(true);
  };

  useEffect(() => {
    fetchCards();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 to-purple-50">
      <div className="w-full px-8 py-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2 flex items-center justify-center gap-2">
            <Database className="w-8 h-8 text-purple-600" />
            角色卡管理系统
          </h1>
          <p className="text-gray-600">管理和审核所有用户创建的角色卡和情景卡</p>
        </div>

        {message && (
          <div className={`mb-6 p-4 rounded-lg ${message.type === 'success' ? 'bg-green-100 text-green-700 border border-green-200' : 'bg-red-100 text-red-700 border border-red-200'}`}>
            {message.text}
          </div>
        )}

        <div className="grid lg:grid-cols-3 gap-6">
          {/* 角色卡列表面板 */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-xl font-bold mb-4 text-gray-800">角色卡列表</h2>

              {/* 搜索表单 */}
              <form onSubmit={handleSearch} className="mb-4">
                <div className="flex gap-2 mb-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="搜索角色卡名称..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
                  >
                    搜索
                  </button>
                </div>

                {/* 过滤器 */}
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <select
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value as any)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="all">所有类型</option>
                    <option value="character">角色卡</option>
                    <option value="scenario">情景卡</option>
                  </select>

                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as any)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="all">所有状态</option>
                    <option value="public">公开</option>
                    <option value="private">私有</option>
                    <option value="banned">封禁</option>
                  </select>
                </div>

                <button
                  type="button"
                  onClick={() => fetchCards(1, searchTerm, typeFilter, statusFilter)}
                  className="w-full px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 text-sm"
                >
                  应用筛选
                </button>
              </form>

              {/* 角色卡列表 */}
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {loading ? (
                  <div className="text-center py-4 text-gray-500">加载中...</div>
                ) : cards.length === 0 ? (
                  <div className="text-center py-4 text-gray-500">没有找到角色卡</div>
                ) : (
                  cards.map((card) => {
                    const cardStatus = getDataCardStatus(card);
                    return (
                      <div
                        key={card.id}
                        onClick={() => fetchCardDetails(card.id)}
                        className={`p-3 rounded-lg border cursor-pointer transition-colors hover:bg-gray-50 ${selectedCard?.id === card.id ? 'border-purple-500 bg-purple-50' : 'border-gray-200'
                          }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-sm">{card.name}</span>
                          <div className="flex items-center gap-1">
                            <span className={`text-xs px-2 py-1 rounded flex items-center gap-1 ${cardStatus.status === 'banned'
                              ? 'bg-red-100 text-red-700'
                              : cardStatus.status === 'public'
                                ? 'bg-green-100 text-green-700'
                                : 'bg-gray-100 text-gray-700'
                              }`}>
                              {cardStatus.status === 'banned' && <Ban className="w-3 h-3" />}
                              {cardStatus.status === 'public' && <CheckCircle className="w-3 h-3" />}
                              {cardStatus.label}
                            </span>
                          </div>
                        </div>
                        <div className="text-xs text-gray-500 mb-1">
                          {card.type === 'character' ? '角色卡' : '情景卡'} | 作者: {card.username}
                        </div>
                        <div className="text-xs text-gray-400">
                          ❤️ {card.like_count} | 📥 {card.usage_count}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* 分页 */}
              {totalPages > 1 && (
                <div className="flex justify-center gap-2 mt-4">
                  <button
                    onClick={() => fetchCards(currentPage - 1, searchTerm, typeFilter, statusFilter)}
                    disabled={currentPage === 1 || loading}
                    className="px-3 py-1 bg-gray-200 text-gray-700 rounded disabled:opacity-50"
                  >
                    上一页
                  </button>
                  <span className="px-3 py-1 bg-purple-100 text-purple-700 rounded">
                    {currentPage} / {totalPages}
                  </span>
                  <button
                    onClick={() => fetchCards(currentPage + 1, searchTerm, typeFilter, statusFilter)}
                    disabled={currentPage === totalPages || loading}
                    className="px-3 py-1 bg-gray-200 text-gray-700 rounded disabled:opacity-50"
                  >
                    下一页
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 角色卡详情面板 */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-xl shadow-lg p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-gray-800">角色卡详情</h2>
                {selectedCard && editingCard && (
                  <div className="flex gap-2">
                    <button
                      onClick={viewCardData}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                      <Eye className="w-4 h-4" />
                      查看数据
                    </button>
                    <button
                      onClick={saveCardUpdate}
                      disabled={loading}
                      className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                    >
                      <Save className="w-4 h-4" />
                      保存
                    </button>
                    <button
                      onClick={resetEditing}
                      className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
                    >
                      <X className="w-4 h-4" />
                      重置
                    </button>
                  </div>
                )}
              </div>

              {selectedCard ? (
                <div className="space-y-6">
                  {/* 基础信息 */}
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">角色卡ID</label>
                      <div className="flex items-center gap-2">
                        <Hash className="w-4 h-4 text-gray-400" />
                        <input
                          type="text"
                          value={selectedCard.id}
                          disabled
                          className="flex-1 p-3 border border-gray-300 rounded-lg bg-gray-50 text-xs font-mono"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">类型</label>
                      <input
                        type="text"
                        value={selectedCard.type === 'character' ? '角色卡' : '情景卡'}
                        disabled
                        className="w-full p-3 border border-gray-300 rounded-lg bg-gray-50"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">创建者</label>
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-gray-400" />
                        <input
                          type="text"
                          value={selectedCard.username || '未知用户'}
                          disabled
                          className="flex-1 p-3 border border-gray-300 rounded-lg bg-gray-50"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">用户ID</label>
                      <input
                        type="text"
                        value={selectedCard.user_id}
                        disabled
                        className="w-full p-3 border border-gray-300 rounded-lg bg-gray-50"
                      />
                    </div>
                  </div>

                  {/* 可编辑字段 */}
                  <div className="border-t pt-6">
                    <h3 className="text-lg font-semibold mb-4 text-gray-800">可编辑设置</h3>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">名称</label>
                        <input
                          type="text"
                          value={editingCard ? editingCard.name : selectedCard.name}
                          onChange={(e) => editingCard && setEditingCard({ ...editingCard, name: e.target.value })}
                          className="w-full p-3 border border-gray-300 rounded-lg bg-white"
                          maxLength={50}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
                        <textarea
                          value={editingCard ? editingCard.description : selectedCard.description}
                          onChange={(e) => editingCard && setEditingCard({ ...editingCard, description: e.target.value })}
                          className="w-full p-3 border border-gray-300 rounded-lg bg-white"
                          rows={3}
                          maxLength={200}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          状态设置
                          {editingCard?.is_public === -1 && <AlertTriangle className="inline w-4 h-4 ml-1 text-red-500" />}
                        </label>
                        <select
                          value={editingCard ? editingCard.is_public : selectedCard.is_public}
                          onChange={(e) => editingCard && setEditingCard({ ...editingCard, is_public: parseInt(e.target.value) })}
                          className={`w-full p-3 border border-gray-300 rounded-lg bg-white ${editingCard?.is_public === -1 ? 'border-red-300 bg-red-50' : ''
                            }`}
                        >
                          <option value={0}>私有</option>
                          <option value={1}>公开</option>
                          <option value={-1}>封禁</option>
                        </select>
                        {editingCard?.is_public === -1 && (
                          <p className="text-xs text-red-600 mt-1">
                            封禁后，该角色卡将无法被其他用户查看或使用
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 统计信息 */}
                  <div className="border-t pt-6">
                    <h3 className="text-lg font-semibold mb-4 text-gray-800">统计信息</h3>
                    <div className="grid md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">点赞数</label>
                        <input
                          type="text"
                          value={selectedCard.like_count || 0}
                          disabled
                          className="w-full p-3 border border-gray-300 rounded-lg bg-gray-50"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">使用次数</label>
                        <input
                          type="text"
                          value={selectedCard.usage_count || 0}
                          disabled
                          className="w-full p-3 border border-gray-300 rounded-lg bg-gray-50"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">当前状态</label>
                        <div className={`w-full p-3 border border-gray-300 rounded-lg text-center font-medium ${getDataCardStatus(selectedCard).status === 'banned'
                          ? 'bg-red-50 text-red-700 border-red-300'
                          : getDataCardStatus(selectedCard).status === 'public'
                            ? 'bg-green-50 text-green-700 border-green-300'
                            : 'bg-gray-50 text-gray-700'
                          }`}>
                          {getDataCardStatus(selectedCard).label}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 时间信息 */}
                  <div className="border-t pt-6">
                    <h3 className="text-lg font-semibold mb-4 text-gray-800">时间信息</h3>
                    <div className="grid md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">创建时间</label>
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4 text-gray-400" />
                          <input
                            type="text"
                            value={selectedCard.created_at ? new Date(selectedCard.created_at).toLocaleString('zh-CN') : ''}
                            disabled
                            className="flex-1 p-3 border border-gray-300 rounded-lg bg-gray-50"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">更新时间</label>
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4 text-gray-400" />
                          <input
                            type="text"
                            value={selectedCard.updated_at ? new Date(selectedCard.updated_at).toLocaleString('zh-CN') : ''}
                            disabled
                            className="flex-1 p-3 border border-gray-300 rounded-lg bg-gray-50"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 text-gray-500">
                  <Database className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <p>请从左侧列表选择一个角色卡查看详情</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 数据查看模态框 */}
        {viewingData && selectedCard && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg max-w-4xl max-h-[80vh] overflow-hidden">
              <div className="p-6 border-b">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-bold">角色卡原始数据</h3>
                  <button
                    onClick={() => setViewingData(false)}
                    className="p-2 hover:bg-gray-100 rounded-lg"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <div className="p-6 overflow-y-auto max-h-[60vh]">
                <pre className="text-sm bg-gray-50 p-4 rounded-lg overflow-x-auto whitespace-pre-wrap">
                  {JSON.stringify(JSON.parse(selectedCard.data), null, 2)}
                </pre>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}