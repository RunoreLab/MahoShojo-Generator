import React, { useState } from 'react';
import { X, Check } from 'lucide-react';
import type { BadgeDefinition } from '@/types/badge';
import Badge from '@/components/badge/Badge';

interface BadgeWithMeta extends BadgeDefinition {
  createdAt?: string;
}

interface GrantBadgeModalProps {
  badge: BadgeWithMeta;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

export default function GrantBadgeModal({ badge, onClose, onSuccess }: GrantBadgeModalProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);

  const searchUsers = async () => {
    if (!searchTerm.trim()) return;

    setSearching(true);
    try {
      const response = await fetch(
        `/api/admin/users?search=${encodeURIComponent(searchTerm)}&limit=20`
      );
      if (response.ok) {
        const data = await response.json();
        setSearchResults(data.users || []);
      }
    } catch (error) {
      console.error('搜索用户失败:', error);
    } finally {
      setSearching(false);
    }
  };

  const handleGrant = async () => {
    if (selectedUsers.length === 0) return;

    setLoading(true);
    try {
      const response = await fetch('/api/admin/badges/grant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          badgeId: badge.id,
          userIds: selectedUsers
        })
      });

      if (response.ok) {
        const data = await response.json();
        onSuccess(data.message);
      }
    } catch (error) {
      console.error('授予徽章失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleUser = (userId: number) => {
    setSelectedUsers((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-bold text-gray-800">授予徽章</h2>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
              <X className="w-6 h-6" />
            </button>
          </div>

          <div className="mb-4 p-3 bg-purple-50 rounded-lg">
            <Badge badge={badge} size="md" />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">搜索用户</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && searchUsers()}
                placeholder="输入用户名搜索..."
                className="flex-1 p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
              />
              <button
                onClick={searchUsers}
                disabled={searching}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
              >
                {searching ? '搜索中...' : '搜索'}
              </button>
            </div>
          </div>

          {searchResults.length > 0 && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                选择用户 ({selectedUsers.length} 已选择)
              </label>
              <div className="max-h-60 overflow-y-auto border rounded-lg">
                {searchResults.map((user) => (
                  <div
                    key={user.id}
                    onClick={() => toggleUser(user.id)}
                    className={`p-3 border-b cursor-pointer hover:bg-gray-50 ${selectedUsers.includes(user.id) ? 'bg-purple-50' : ''
                      }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">{user.username}</div>
                        <div className="text-xs text-gray-500">{user.email}</div>
                      </div>
                      {selectedUsers.includes(user.id) && (
                        <Check className="w-5 h-5 text-purple-600" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2 justify-end pt-4">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              取消
            </button>
            <button
              onClick={handleGrant}
              disabled={loading || selectedUsers.length === 0}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? '授予中...' : `授予给 ${selectedUsers.length} 个用户`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
