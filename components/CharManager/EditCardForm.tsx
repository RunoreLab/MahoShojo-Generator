import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { isDataCardBanned } from '@/lib/data-card-status';
import { inferTemplate, TEMPLATE_LABELS } from '@/lib/data-card-converter';
import type { InferableTemplate } from '@/lib/data-card-converter';

interface EditCardFormProps {
  card: any;
  onSave: (name: string, description: string, isPublic: number) => void;
  onCancel: () => void;
}

export default function EditCardForm({ card, onSave, onCancel }: EditCardFormProps) {
  const [formData, setFormData] = React.useState({
    name: card.name,
    description: card.description || '',
    isPublic: card.is_public === 1 // 只有值为1时才显示为选中
  });

  const templateType = React.useMemo<InferableTemplate>(() => {
    try {
      const parsed = JSON.parse(card.data);
      return inferTemplate(parsed);
    } catch {
      return 'unknown';
    }
  }, [card.data]);

  const templateLabel = templateType === 'unknown' ? '未知类型' : TEMPLATE_LABELS[templateType];

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
          maxLength={300}
        />
        <div>
          <label className="block text-sm font-medium text-gray-700">内容模板</label>
          <select
            value={templateType === 'unknown' ? '__unknown__' : templateType}
            disabled
            className="input-field bg-gray-100 cursor-not-allowed"
          >
            <option value={templateType === 'unknown' ? '__unknown__' : templateType}>
              {templateLabel}
            </option>
          </select>
          <p className="mt-1 text-xs text-gray-500">
            如需转换模板，请在档案馆编辑器中载入该数据卡并使用“内容模板”选择器。
          </p>
        </div>
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
            onClick={() => onSave(formData.name, formData.description, isBanned ? -1 : (formData.isPublic ? 1 : 0))}
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
