'use client';

import { useEffect, useState, type ChangeEventHandler } from 'react';

import TachieGenerator from '@/components/TachieGenerator';
import { readImageFileAsDataUrl, resolveProxyImageUrl } from '@/lib/client/visualAsset';
import type { CharacterCardPortraitAsset } from '@/types/visual-asset';

type PortraitChoice = 'none' | 'generated' | 'uploaded';

interface CharacterPortraitAssetPanelProps {
  prompt: string;
  onPortraitAssetChange?: (asset: CharacterCardPortraitAsset | null) => void;
}

export function CharacterPortraitAssetPanel({ prompt, onPortraitAssetChange }: CharacterPortraitAssetPanelProps) {
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const [choice, setChoice] = useState<PortraitChoice>('none');
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    const asset = (() => {
      if (choice === 'generated' && generatedImageUrl) {
        return {
          imageUrl: resolveProxyImageUrl(generatedImageUrl),
          source: 'generated',
        } satisfies CharacterCardPortraitAsset;
      }
      if (choice === 'uploaded' && uploadedImageUrl) {
        return {
          imageUrl: uploadedImageUrl,
          source: 'uploaded',
          note: '用户自行上传',
        } satisfies CharacterCardPortraitAsset;
      }
      return null;
    })();
    onPortraitAssetChange?.(asset);
  }, [choice, generatedImageUrl, uploadedImageUrl, onPortraitAssetChange]);

  const handleUploadFile: ChangeEventHandler<HTMLInputElement> = async (event) => {
    setUploadError(null);
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setUploadError('仅支持上传图片文件。');
      return;
    }
    try {
      const dataUrl = await readImageFileAsDataUrl(file);
      setUploadedImageUrl(dataUrl);
      setChoice('uploaded');
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : '上传失败，请重试。');
    } finally {
      event.target.value = '';
    }
  };

  const hasGeneratedImage = Boolean(generatedImageUrl);
  const hasUploadedImage = Boolean(uploadedImageUrl);

  return (
    <div className="space-y-4">
      <div className="input-group">
        <label className="input-label">卡片立绘来源</label>
        <div className="grid gap-2 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => setChoice('none')}
            className={`px-3 py-2 rounded-lg border text-sm font-medium ${
              choice === 'none' ? 'border-pink-400 bg-pink-50 text-pink-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            不插入
          </button>
          <button
            type="button"
            onClick={() => setChoice('generated')}
            disabled={!hasGeneratedImage}
            className={`px-3 py-2 rounded-lg border text-sm font-medium disabled:opacity-50 ${
              choice === 'generated'
                ? 'border-pink-400 bg-pink-50 text-pink-700'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            使用生成图
          </button>
          <button
            type="button"
            onClick={() => setChoice('uploaded')}
            disabled={!hasUploadedImage}
            className={`px-3 py-2 rounded-lg border text-sm font-medium disabled:opacity-50 ${
              choice === 'uploaded'
                ? 'border-pink-400 bg-pink-50 text-pink-700'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            使用上传图
          </button>
        </div>
      </div>

      <div className="input-group">
        <label className="input-label">上传本地立绘</label>
        <input
          type="file"
          accept="image/*"
          onChange={handleUploadFile}
          className="w-full text-sm"
        />
        {uploadError && <p className="text-xs text-red-500 mt-1">{uploadError}</p>}
      </div>

      {(generatedImageUrl || uploadedImageUrl) && (
        <div className="grid gap-3 md:grid-cols-2">
          {generatedImageUrl && (
            <div className="rounded-lg border border-gray-200 bg-white p-2">
              <div className="text-xs font-medium text-gray-600 mb-2">生成图预览</div>
              <img src={generatedImageUrl} alt="生成立绘预览" className="w-full rounded-lg border border-gray-100" />
            </div>
          )}
          {uploadedImageUrl && (
            <div className="rounded-lg border border-gray-200 bg-white p-2">
              <div className="text-xs font-medium text-gray-600 mb-2">上传图预览</div>
              <img src={uploadedImageUrl} alt="上传立绘预览" className="w-full rounded-lg border border-gray-100" />
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-gray-500">
        当前为 MVP：立绘仅用于角色卡截图展示，不会写入或覆盖角色 JSON 数据。
      </p>

      <TachieGenerator
        prompt={prompt}
        mode="tachie"
        onImageUrlChange={(imageUrl) => {
          setGeneratedImageUrl(imageUrl);
          setChoice((prev) => {
            if (imageUrl) return 'generated';
            return prev === 'generated' ? 'none' : prev;
          });
        }}
      />
    </div>
  );
}
