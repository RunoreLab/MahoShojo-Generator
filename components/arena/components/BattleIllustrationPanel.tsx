'use client';

import { useEffect, useMemo, useState, type ChangeEventHandler } from 'react';

import TachieGenerator from '@/components/TachieGenerator';
import type { BattleReportIllustrationAsset } from '@/components/BattleReportCard';
import { CollapsibleSection } from '@/components/shared/CollapsibleSection';
import { buildBattleIllustrationPrompt } from '@/lib/arena/battle-illustration-prompt';
import type { BattleAiImpact, CombatantData } from '../types';

type IllustrationChoice = 'none' | 'generated' | 'uploaded';

interface BattleIllustrationPanelProps {
  headline?: string | null;
  reportBody?: string | null;
  reportMarkdown?: string | null;
  combatants: CombatantData[];
  aiImpacts: BattleAiImpact[] | null;
  onIllustrationAssetChange?: (asset: BattleReportIllustrationAsset | null) => void;
}

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result) {
        reject(new Error('读取图片失败，请重试。'));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => {
      reject(new Error('读取图片失败，请重试。'));
    };
    reader.readAsDataURL(file);
  });

export function BattleIllustrationPanel({
  headline,
  reportBody,
  reportMarkdown,
  combatants,
  aiImpacts,
  onIllustrationAssetChange,
}: BattleIllustrationPanelProps) {
  const [prompt, setPrompt] = useState('');
  const [promptDirty, setPromptDirty] = useState(false);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const [choice, setChoice] = useState<IllustrationChoice>('none');
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'error'>('idle');
  const [uploadError, setUploadError] = useState<string | null>(null);

  const suggested = useMemo(
    () =>
      buildBattleIllustrationPrompt({
        headline,
        reportBody,
        reportMarkdown,
        combatants: combatants.map((item) => ({
          type: item.type,
          data: item.data,
          filename: item.filename,
        })),
        aiImpacts,
      }),
    [headline, reportBody, reportMarkdown, combatants, aiImpacts]
  );

  useEffect(() => {
    if (!promptDirty) {
      setPrompt(suggested.prompt);
    }
  }, [suggested.prompt, promptDirty]);

  useEffect(() => {
    const asset = (() => {
      if (choice === 'generated' && generatedImageUrl) {
        return {
          imageUrl: generatedImageUrl,
          source: 'generated',
        } satisfies BattleReportIllustrationAsset;
      }
      if (choice === 'uploaded' && uploadedImageUrl) {
        return {
          imageUrl: uploadedImageUrl,
          source: 'uploaded',
          note: '用户自行上传',
        } satisfies BattleReportIllustrationAsset;
      }
      return null;
    })();
    onIllustrationAssetChange?.(asset);
  }, [choice, generatedImageUrl, uploadedImageUrl, onIllustrationAssetChange]);

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopyState('ok');
    } catch {
      setCopyState('error');
    }
  };

  const handleResetPrompt = () => {
    setPrompt(suggested.prompt);
    setPromptDirty(false);
    setCopyState('idle');
  };

  const handleUploadFile: ChangeEventHandler<HTMLInputElement> = async (event) => {
    setUploadError(null);
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setUploadError('仅支持上传图片文件。');
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
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
    <div className="card mt-6">
      <CollapsibleSection
        title="🎨 战报插图"
        description="可编辑提示词，生成或上传图片后插入战报卡片"
        defaultOpen={false}
        storageKey="arena.section.battleIllustration.open"
        variant="plain"
        titleClassName="text-lg font-bold text-gray-800"
        headerClassName="mb-3"
      >
        <div className="space-y-4">
          <div className="input-group">
            <label className="input-label">推荐提示词（可编辑）</label>
            <textarea
              value={prompt}
              onChange={(event) => {
                setPrompt(event.target.value);
                setPromptDirty(true);
                setCopyState('idle');
              }}
              className="w-full min-h-[180px] px-3 py-2 rounded-lg border border-pink-200"
              placeholder="请输入插图提示词"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleResetPrompt}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-pink-200 text-pink-600 hover:bg-pink-50"
              >
                重置为推荐提示词
              </button>
              <button
                type="button"
                onClick={handleCopyPrompt}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-pink-200 text-pink-600 hover:bg-pink-50"
              >
                复制提示词
              </button>
              {copyState === 'ok' && <span className="text-xs text-green-600 self-center">已复制</span>}
              {copyState === 'error' && <span className="text-xs text-red-500 self-center">复制失败，请手动复制</span>}
            </div>
          </div>

          {suggested.missingAppearance && (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700">
              未提取到角色外观，当前提示词仅使用战报片段与基础构图建议。
            </div>
          )}
          {suggested.missingAiImpacts && (
            <div className="p-3 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-600">
              AI 本次未返回状态/历战摘要，本次提示词不会回退到角色卡旧字段。
            </div>
          )}

          <div className="input-group">
            <label className="input-label">卡片插图来源</label>
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
            <label className="input-label">上传本地插图</label>
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
                  <img src={generatedImageUrl} alt="生成插图预览" className="w-full rounded-lg border border-gray-100" />
                </div>
              )}
              {uploadedImageUrl && (
                <div className="rounded-lg border border-gray-200 bg-white p-2">
                  <div className="text-xs font-medium text-gray-600 mb-2">上传图预览</div>
                  <img src={uploadedImageUrl} alt="上传插图预览" className="w-full rounded-lg border border-gray-100" />
                </div>
              )}
            </div>
          )}

          <div className="pt-1">
            <TachieGenerator
              prompt={prompt}
              mode="illustration"
              onImageUrlChange={(imageUrl) => {
                setGeneratedImageUrl(imageUrl);
                setChoice((prev) => {
                  if (imageUrl) return 'generated';
                  return prev === 'generated' ? 'none' : prev;
                });
              }}
            />
          </div>
        </div>
      </CollapsibleSection>
    </div>
  );
}
