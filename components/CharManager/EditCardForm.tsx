import React from 'react';

interface EditCardFormProps {
  card: any;
  onSave: (name: string, description: string, isPublic: boolean) => void;
  onCancel: () => void;
}

export default function EditCardForm({ card, onSave, onCancel }: EditCardFormProps) {
  const [formData, setFormData] = React.useState({
    name: card.name,
    description: card.description || '',
    isPublic: card.is_public || false
  });

  return (
    <div className="border rounded-lg p-4">
      <div className="space-y-2">
        <input
          type="text"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          className="input-field"
          placeholder="名称"
        />
        <textarea
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          className="input-field text-sm"
          rows={2}
          placeholder="描述"
          maxLength={50}
        />
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id={`card-public-${card.id}`}
            checked={formData.isPublic}
            onChange={(e) => setFormData({ ...formData, isPublic: e.target.checked })}
            className="w-4 h-4 text-purple-600 rounded"
          />
          <label htmlFor={`card-public-${card.id}`} className="text-sm text-gray-700">
            设为公开
          </label>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => onSave(formData.name, formData.description, formData.isPublic)}
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