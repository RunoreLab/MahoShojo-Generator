import React from 'react';
import { isDataCardBanned } from '../../lib/database/data-cards';
import { AlertTriangle } from 'lucide-react';

interface EditCardFormProps {
  card: any;
  onSave: (name: string, description: string, isPublic: boolean | number) => void;
  onCancel: () => void;
}

export default function EditCardForm({ card, onSave, onCancel }: EditCardFormProps) {
  const [formData, setFormData] = React.useState({
    name: card.name,
    description: card.description || '',
    isPublic: card.is_public === 1 ? true : card.is_public === -1 ? false : false // 封禁时也显示为false
  });

  const isBanned = isDataCardBanned(card);

  return (
    <div className="border rounded-lg p-4">
      <div className="space-y-2">
        <input
          type="text"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          className="input-field"
          placeholder="名称"
          maxLength={20}
        />
        <textarea
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          className="input-field text-sm"
          rows={2}
          placeholder="描述"
          maxLength={120}
        />
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id={`card-public-${card.id}`}
            checked={formData.isPublic}
            onChange={(e) => !isBanned && setFormData({ ...formData, isPublic: e.target.checked })}
            disabled={isBanned}
            className={`w-4 h-4 rounded ${isBanned ? 'opacity-50 cursor-not-allowed' : 'text-purple-600'
              }`}
          />
          {!isBanned && <label htmlFor={`card-public-${card.id}`} className={`text-sm flex items-center gap-1 ${isBanned ? 'text-red-600' : 'text-gray-700'
            }`}>
            设为公开
          </label>}
          {isBanned && (
            <div className="flex items-center gap-1 text-xs text-red-600 bg-red-50 px-2 py-1 rounded">
              <AlertTriangle className="w-3 h-3" />
              数据卡已被封禁，无法修改公开状态
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => onSave(formData.name, formData.description, isBanned ? -1 : formData.isPublic)}
            className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700"
          >
            保存
          </button>
          <button
            onClick={onCancel}
            className="px-3 py-1 bg-gray-500 text-white rounded text-sm hover:bg-gray-600"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}