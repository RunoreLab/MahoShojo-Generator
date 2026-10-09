import { useId, type ReactNode } from 'react';
import { BaseModal } from '../modal/BaseModal';
import { JsonSizeIndicator } from '../details-controls/JsonSizeIndicator';
import { getDataCardBaseSlotCostFromBytes, getUtf8ByteLength } from '@mahoshojo/domain/data-card-size';

export interface SaveCardModalProps {
  isOpen: boolean;
  privateOnly?: boolean;
  submitDisabled?: boolean;
  supplementaryContent?: ReactNode;
  onClose: () => void;
  onSave: () => void;
  name: string;
  description: string;
  isPublic: number;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onPublicChange: (value: number) => void;
  error: string | null;
  isSaving?: boolean;
  usedSlots?: number;
  userCapacity?: number;
  data?: unknown;
}

export function SaveCardModal({
  isOpen,
  onClose,
  onSave,
  name,
  description,
  isPublic,
  onNameChange,
  onDescriptionChange,
  onPublicChange,
  error,
  isSaving = false,
  usedSlots,
  userCapacity,
  privateOnly = false,
  submitDisabled = false,
  supplementaryContent,
  data
}: SaveCardModalProps) {
  const publicId = useId();
  const nameId = useId();
  const descriptionId = useId();
  const close = () => { if (!isSaving) onClose(); };
  const capacityKnown = usedSlots !== undefined && userCapacity !== undefined;
  const estimatedSlots = data == null
    ? 1
    : getDataCardBaseSlotCostFromBytes(getUtf8ByteLength(JSON.stringify(data)));
  const wouldExceedCapacity = capacityKnown && usedSlots + estimatedSlots > userCapacity;

  return (
    <BaseModal isOpen={isOpen} onClose={close} title="保存数据卡" maxWidthClassName="max-w-md" closeOnBackdrop={!isSaving}>
        <div className="mb-4 text-sm text-gray-600">{capacityKnown ? `${usedSlots}/${userCapacity} 槽` : '云端容量未知，保存时由服务器校验'}</div>
        {/* 容量警告 */}
        {capacityKnown && usedSlots >= userCapacity && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-md text-sm">
            ⚠️ 数据卡槽位已达上限（{userCapacity} 槽），请先释放部分槽位
          </div>
        )}
        {capacityKnown && usedSlots >= userCapacity - 5 && usedSlots < userCapacity && (
          <div className="mb-4 p-3 bg-yellow-100 text-yellow-700 rounded-md text-sm">
            ⚠️ 数据卡容量即将用完（{usedSlots}/{userCapacity} 槽）
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-md text-sm">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label htmlFor={nameId} className="block text-sm font-medium text-gray-700 mb-1">
              数据卡名称 <span className="text-red-500">*</span>
            </label>
            <input
              id={nameId}
              type="text"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              className="input-field"
              placeholder="请输入数据卡名称"
              maxLength={20}
              disabled={isSaving}
            />
          </div>

          <div>
            <label htmlFor={descriptionId} className="block text-sm font-medium text-gray-700 mb-1">
              描述
            </label>
            <textarea id={descriptionId}
              value={description}
              onChange={(e) => onDescriptionChange(e.target.value)}
              className="input-field"
              rows={3}
              placeholder="请输入数据卡描述"
              maxLength={300}
              disabled={isSaving}
            />
          </div>

          {!privateOnly && <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id={publicId}
              checked={isPublic === 1}
              onChange={(e) => onPublicChange(e.target.checked ? 1 : 0)}
              className="w-4 h-4 text-purple-600 rounded"
              disabled={isSaving}
            />
            <label htmlFor={publicId} className="text-sm text-gray-700">
              设为公开（其他用户可见）
            </label>
          </div>}
          {privateOnly && <p className="text-sm text-gray-600">新建私有云端副本，仅当前账号可见；本地结果保留。</p>}

          {!privateOnly && isPublic === 1 && (
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
              ⚠️ 公开的数据卡将对所有用户可见
            </div>
          )}

          {data !== undefined && data !== null && (
            <>
              <div className="mb-2 text-sm text-gray-600">
                当前内容预计占 {estimatedSlots} 个槽位，{capacityKnown ? `保存后约 ${usedSlots + estimatedSlots}/${userCapacity} 槽。` : '当前剩余槽位未知。'}服务器加入作者信息后体积可能增加，估算不保证可保存。
              </div>
              <JsonSizeIndicator
              data={data}
              className="mt-0"
              warningText="⚠️ 接近云端 1MiB 单卡上限，保存可能失败，请先精简数据。"
              />
            </>
          )}

          <div className="flex gap-2">
            <button
              onClick={onSave}
              disabled={!name.trim() || isSaving || submitDisabled || wouldExceedCapacity}
              className={`flex-1 generate-button ${(!name.trim() || isSaving || submitDisabled || wouldExceedCapacity) ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {isSaving ? '保存中...' : (wouldExceedCapacity ? '槽位不足' : '保存')}
            </button>
            <button
              onClick={close}
              disabled={isSaving}
              className={`flex-1 generate-button bg-white/80 text-gray-600 border-2 border-gray-200 hover:bg-white ${isSaving ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              取消
            </button>
          </div>
        </div>
        {supplementaryContent}
    </BaseModal>
  );
}
