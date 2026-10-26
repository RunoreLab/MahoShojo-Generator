"use client";

import { useState, useEffect, useRef } from "react";
import {
  DEFAULT_MODELSCOPE_MODEL,
  DEFAULT_MODELSCOPE_SIZE,
  MODELSCOPE_SIZE_OPTIONS,
  isModelScopePresetSize,
  type ModelScopePresetSize,
} from '@mahoshojo/ai-core/modelscope';
import { generateTachieWithProgress, type TachieGenerationRequest, type TachieGenerationResult, type TachieSource } from "@/lib/tachie/manager";
import { ImageGenerationFeedback, ImageGenerationResultView } from '@mahoshojo/ui-web/image-generation';
import { normalizeModelScopeToken } from "@/lib/tachie/modelscope/error";
import { DEFAULT_NOVELAI_SETTINGS, normalizeNovelAIToken } from '@/lib/tachie/novelai';
import { NovelAISettingsFields } from '@/components/tachie/NovelAISettings';

const NOVELAI_TOKEN_KEY = 'tachie_novelai_token';

interface TachieGeneratorProps {
  prompt: string;
  /** Stable result/role/session identity; changing prompt or parameters does not change the owner. */
  ownerKey?: unknown;
  textProviderStorageNamespace?: string;
  recommendedPrompt?: string;
  onUseRecommendedPrompt?: () => void;
  mode?: 'tachie' | 'illustration';
  workflowUuid?: string;
  templateUuid?: string;
  promptNodeId?: number;
  negativePrompt?: string;
  negativePromptNodeId?: number;
  onImageUrlChange?: (imageUrl: string | null) => void;
  onResult?: (result: TachieGenerationResult) => void;
}

export default function TachieGenerator({
  prompt,
  ownerKey,
  textProviderStorageNamespace,
  recommendedPrompt,
  onUseRecommendedPrompt,
  mode,
  workflowUuid,
  templateUuid,
  promptNodeId,
  negativePrompt,
  negativePromptNodeId,
  onImageUrlChange,
  onResult,
}: TachieGeneratorProps) {
  const [source, setSource] = useState<TachieSource>("modelscope");
  const [accessKey, setAccessKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [modelscopeToken, setModelscopeToken] = useState("");
  const [modelscopeModel, setModelscopeModel] = useState(DEFAULT_MODELSCOPE_MODEL);
  const [modelscopeSize, setModelscopeSize] = useState<ModelScopePresetSize>(DEFAULT_MODELSCOPE_SIZE);
  const [novelaiToken, setNovelaiToken] = useState('');
  const [novelaiStorageError, setNovelaiStorageError] = useState('');
  const [novelaiCustomMode, setNovelaiCustomMode] = useState(false);
  const [novelaiPrompt, setNovelaiPrompt] = useState('');
  const [novelaiSettings, setNovelaiSettings] = useState({ ...DEFAULT_NOVELAI_SETTINGS });
  const generationRef = useRef<AbortController | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isOptimizingPrompt, setIsOptimizingPrompt] = useState(false);
  const [result, setResult] = useState<TachieGenerationResult | null>(null);
  const [completedImage, setCompletedImage] = useState<TachieGenerationResult | null>(null);
  const pendingRequest = useRef<TachieGenerationRequest | null>(null);
  const pendingCallbacks = useRef<Pick<TachieGeneratorProps, 'onResult' | 'onImageUrlChange'> | null>(null);
  const previousOwner = useRef(ownerKey);
  useEffect(() => {
    if (Object.is(previousOwner.current, ownerKey)) return;
    previousOwner.current = ownerKey;
    generationRef.current?.abort(); generationRef.current = null;
    pendingRequest.current = null;
    pendingCallbacks.current = null;
    setIsGenerating(false); setResult(null); setCompletedImage(null);
    setProgress(0); setProgressStatus('');
    onImageUrlChange?.(null);
  }, [ownerKey, onImageUrlChange]);
  const [rememberCredentials, setRememberCredentials] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressStatus, setProgressStatus] = useState("");
  const normalizedModelScopeToken = normalizeModelScopeToken(modelscopeToken);

  useEffect(() => {
    try { setNovelaiToken(localStorage.getItem(NOVELAI_TOKEN_KEY) ?? ''); }
    catch { setNovelaiStorageError('浏览器不允许读取本地存储，请重新填写 Token。'); }
  }, []);
  const updateNovelaiToken = (value: string) => {
    setNovelaiToken(value);
    try {
      const token = normalizeNovelAIToken(value);
      if (token) localStorage.setItem(NOVELAI_TOKEN_KEY, token);
      else localStorage.removeItem(NOVELAI_TOKEN_KEY);
      setNovelaiStorageError('');
    } catch { setNovelaiStorageError('Token 无法保存到本地存储，本次仍可使用，刷新后需重新填写。'); }
  };
  useEffect(() => () => { generationRef.current?.abort(); generationRef.current = null; }, []);

  // localStorage keys
  const CREDENTIALS_KEY = 'tachie_credentials';
  const REMEMBER_KEY = 'tachie_remember';

  // 组件加载时从localStorage读取凭据
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const shouldRemember = localStorage.getItem(REMEMBER_KEY) === 'true';
      setRememberCredentials(shouldRemember);

      if (shouldRemember) {
        const savedCredentials = localStorage.getItem(CREDENTIALS_KEY);
        if (savedCredentials) {
          try {
            const parsed = JSON.parse(savedCredentials) as Record<string, unknown>;
            if (parsed.source === 'liblib') {
              setSource('liblib');
            } else {
              setSource('modelscope');
            }

            setAccessKey(typeof parsed.accessKey === 'string' ? parsed.accessKey : '');
            setSecretKey(typeof parsed.secretKey === 'string' ? parsed.secretKey : '');
            setModelscopeToken(typeof parsed.modelscopeToken === 'string' ? normalizeModelScopeToken(parsed.modelscopeToken) : '');
            setModelscopeModel(
              typeof parsed.modelscopeModel === 'string' && parsed.modelscopeModel.trim()
                ? parsed.modelscopeModel
                : DEFAULT_MODELSCOPE_MODEL
            );
            setModelscopeSize(isModelScopePresetSize(parsed.modelscopeSize) ? parsed.modelscopeSize : DEFAULT_MODELSCOPE_SIZE);
          } catch (error) {
            console.error('Failed to parse saved credentials:', error);
          }
        }
      }
    }
  }, []);

  // 保存凭据到localStorage
  const saveCredentials = () => {
    if (source === 'novelai') return;
    if (typeof window !== 'undefined') {
      if (rememberCredentials) {
        localStorage.setItem(CREDENTIALS_KEY, JSON.stringify({
          source,
          accessKey: accessKey.trim(),
          secretKey: secretKey.trim(),
          modelscopeToken: normalizedModelScopeToken,
          modelscopeModel: modelscopeModel.trim() || DEFAULT_MODELSCOPE_MODEL,
          modelscopeSize,
        }));
        localStorage.setItem(REMEMBER_KEY, 'true');
      } else {
        localStorage.removeItem(CREDENTIALS_KEY);
        localStorage.setItem(REMEMBER_KEY, 'false');
      }
    }
  };

  // 清除已保存的凭据
  const clearSavedCredentials = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(CREDENTIALS_KEY);
      localStorage.setItem(REMEMBER_KEY, 'false');
      setRememberCredentials(false);
      setSource('modelscope');
      setAccessKey('');
      setSecretKey('');
      setModelscopeToken('');
      setModelscopeModel(DEFAULT_MODELSCOPE_MODEL);
      setModelscopeSize(DEFAULT_MODELSCOPE_SIZE);
    }
  };

  const requiredCredentialsReady = source === 'liblib'
    ? Boolean(accessKey.trim() && secretKey.trim())
    : source === 'novelai' ? Boolean(normalizeNovelAIToken(novelaiToken)) : Boolean(normalizedModelScopeToken);

  const handleGenerate = async (resume = false) => {
    if (generationRef.current || isOptimizingPrompt) return;
    const frozen = resume ? pendingRequest.current : {
      source, accessKey: accessKey.trim(), secretKey: secretKey.trim(),
      modelscopeToken: normalizedModelScopeToken, modelscopeModel: modelscopeModel.trim() || undefined, modelscopeSize,
      novelaiToken,
      novelaiSettings: novelaiCustomMode ? { ...novelaiSettings } : {
        ...DEFAULT_NOVELAI_SETTINGS, model: novelaiSettings.model, baseUrl: novelaiSettings.baseUrl,
      },
      prompt: (source === 'novelai' ? novelaiPrompt : prompt).trim(),
      mode, workflowUuid, templateUuid, promptNodeId, negativePrompt, negativePromptNodeId,
    } satisfies TachieGenerationRequest;
    if (!frozen || (resume && !result?.generateUuid)) return;
    if (!resume && !frozen.prompt) {
      setResult({ success: false, error: '立绘提示词为空：请先补全角色外观/正文，或手动填写提示词后再生成。' });
      return;
    }
    const controller = new AbortController();
    generationRef.current = controller;
    pendingRequest.current = frozen;
    if (!resume) pendingCallbacks.current = { onResult, onImageUrlChange };
    const callbacks = pendingCallbacks.current;
    const resumeTaskId = resume ? result?.generateUuid : undefined;
    setIsGenerating(true); setResult(null); setProgress(0);
    setProgressStatus(resume ? '正在查询原任务…' : '正在提交生成任务…');
    try {
      if (!resume) saveCredentials();
      const generationResult = await generateTachieWithProgress({ ...frozen, signal: controller.signal, resumeTaskId }, (progress, status) => {
        if (generationRef.current !== controller) return;
        setProgress(progress); setProgressStatus(status);
      });
      if (generationRef.current !== controller) return;
      setResult(generationResult);
      callbacks?.onResult?.(generationResult);
      if (generationResult.success && generationResult.imageUrl) {
        setCompletedImage(generationResult);
        callbacks?.onImageUrlChange?.(generationResult.imageUrl);
      }
      if (generationResult.outcome !== 'unresolved' && generationResult.outcome !== 'stopped') {
        pendingRequest.current = null;
        pendingCallbacks.current = null;
      }
    } catch (error) {
      if (generationRef.current !== controller) return;
      setResult({ success: false, error: error instanceof Error ? error.message : '生成失败' });
    } finally {
      if (generationRef.current === controller) {
        generationRef.current = null; setIsGenerating(false);
        setProgress(0); setProgressStatus('');
      }
    }
  };

  return (
    <div>
      <div className="input-group">
        <label className="input-label">图片生成来源</label>
        <div className="flex flex-wrap gap-2">
          {(['modelscope', 'liblib', 'novelai'] as const).map((item) => <button
            key={item}
            type="button"
            onClick={() => setSource(item)}
            disabled={isGenerating || isOptimizingPrompt}
            aria-pressed={source === item}
            className={`shrink-0 rounded-lg border px-4 py-2 text-sm font-medium disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-500 ${source === item ? 'border-pink-500 bg-pink-500 text-white' : 'border-pink-200 bg-white text-pink-600 hover:bg-pink-50'}`}
          >
            {item === 'modelscope' ? 'ModelScope' : item === 'liblib' ? 'LibLib' : 'NovelAI'}
          </button>)}
        </div>
      </div>

      {source === 'novelai' && <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <p className="font-semibold">NovelAI 的使用具有一定的门槛，不推荐直接使用默认提示词。</p>
        <p className="mt-1">请自行编写适合所选模型的提示词，或导入角色与剧情后使用「LLM 优化提示词」。仅提供 V4.5 Curated 和 V5 Curated。</p>
      </div>}

      <div className="mb-6">
        <p className="text-center text-sm text-gray-500 mt-4 leading-relaxed">
          请前往
          {source === 'liblib' ? (
            <>
              &nbsp;
              <a
                href="https://www.liblib.art/apis"
                target="_blank"
                rel="noopener noreferrer"
                className="footer-link"
              >
                LibLib
              </a>
              &nbsp;获取 Access Key 和 Secret Key
            </>
          ) : source === 'novelai' ? (
            <>
              &nbsp;<a href="https://novelai.net" target="_blank" rel="noopener noreferrer" className="footer-link">NovelAI</a>
              &nbsp;的用户设置 → Account → Get Persistent API Token 获取令牌
            </>
          ) : (
            <>
              &nbsp;
              <a
                href="https://modelscope.cn/my/access/token"
                target="_blank"
                rel="noopener noreferrer"
                className="footer-link"
              >
                ModelScope
              </a>
              &nbsp;获取 Token
            </>
          )}
          <br />
          {source === 'novelai' ? '无需填写 NovelAI 账号密码。' : '勾选“记住凭据”后，凭据将保存在此浏览器的本地存储中。'}
        </p>
      </div>

      <div className="mb-6">
        {source === 'liblib' ? (
          <>
            <div className="input-group">
              <label htmlFor="accessKey" className="input-label">
                LibLib Access Key
              </label>
              <input
                id="accessKey"
                type="password"
                value={accessKey}
                onChange={(e) => setAccessKey(e.target.value)}
                placeholder="输入你的 Access Key"
                className="input-field"
                disabled={isGenerating}
              />
            </div>

            <div className="input-group">
              <label htmlFor="secretKey" className="input-label">
                LibLib Secret Key
              </label>
              <input
                id="secretKey"
                type="password"
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                placeholder="输入你的 Secret Key"
                className="input-field"
                disabled={isGenerating}
              />
            </div>
          </>
        ) : source === 'novelai' ? (
          <><NovelAISettingsFields token={novelaiToken} onTokenChange={updateNovelaiToken}
            textProviderStorageNamespace={textProviderStorageNamespace}
            prompt={novelaiPrompt} onPromptChange={setNovelaiPrompt}
            onUseRecommendedPrompt={recommendedPrompt?.trim() ? () => {
              const qualityTags = novelaiSettings.model === 'nai-diffusion-5-curated' ? 'very aesthetic, masterpiece,' : 'masterpiece,';
              setNovelaiPrompt(`0.9::Ixy::,\n${qualityTags}\n${recommendedPrompt}`);
              onUseRecommendedPrompt?.();
            } : undefined}
            customMode={novelaiCustomMode} onCustomModeChange={setNovelaiCustomMode}
            onOptimizerBusyChange={setIsOptimizingPrompt}
            settings={novelaiSettings} onChange={setNovelaiSettings} disabled={isGenerating} />
            {novelaiStorageError && <p role="alert" className="mt-2 text-xs text-amber-700">{novelaiStorageError}</p>}
          </>
        ) : (
          <>
            <div className="input-group">
              <label htmlFor="modelscopeToken" className="input-label">
                ModelScope Token
              </label>
              <input
                id="modelscopeToken"
                type="password"
                value={modelscopeToken}
                onChange={(e) => setModelscopeToken(e.target.value)}
                placeholder="输入你的 ModelScope Token"
                className="input-field"
                disabled={isGenerating}
              />
              <div className="mt-2 text-xs text-gray-500">
                可直接粘贴 Token；若误贴了 <code>Bearer </code> 前缀，系统会自动去除。
              </div>
              <div className="mt-1 text-xs text-gray-500">
                若报 401/403 且提示绑定阿里云或实名认证，请先到 ModelScope 账号设置完成后再重试。
              </div>
            </div>

            <div className="input-group">
              <label htmlFor="modelscopeSize" className="input-label">
                图片尺寸
              </label>
              <select
                id="modelscopeSize"
                value={modelscopeSize}
                onChange={(e) => setModelscopeSize(e.target.value as ModelScopePresetSize)}
                className="input-field"
                disabled={isGenerating}
              >
                {MODELSCOPE_SIZE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>

      {/* 记住凭据选项 */}
      {source !== 'novelai' && <div className="input-group flex items-center justify-between">
        <label className="flex items-center cursor-pointer text-sm text-gray-500">
          <input
            type="checkbox"
            checked={rememberCredentials}
            onChange={(e) => setRememberCredentials(e.target.checked)}
            className="mr-2"
          />
          在本地记住我的凭据，方便下次使用
        </label>
        {rememberCredentials && (accessKey || secretKey || modelscopeToken || modelscopeModel || modelscopeSize) && (
          <button
            type="button"
            onClick={clearSavedCredentials}
            className="bg-transparent border-0 text-xs text-pink-600 underline hover:text-pink-500"
          >
            清除已保存的凭据
          </button>
        )}
      </div>}

      <button
        type="button"
        onClick={() => void handleGenerate()}
        disabled={isGenerating || isOptimizingPrompt || !requiredCredentialsReady || !(source === 'novelai' ? novelaiPrompt : prompt).trim()}
        className="generate-button"
      >
        {isGenerating ? "立绘生成中，请稍后捏 (≖ᴗ≖)✧✨" : `✨ 使用 ${source === 'liblib' ? 'LibLib' : source === 'novelai' ? 'NovelAI' : 'ModelScope'} 生成立绘 ✨`}
      </button>

      <ImageGenerationFeedback busy={isGenerating} progress={source === 'novelai' ? null : progress}
        statusText={progressStatus} error={result?.success ? undefined : result?.error}
        taskId={result?.generateUuid} outcome={result?.outcome}
        onStop={() => generationRef.current?.abort()}
        onResume={!isGenerating && result?.generateUuid && pendingRequest.current && (result.outcome === 'stopped' || result.outcome === 'unresolved')
          ? () => void handleGenerate(true) : undefined} />
      {completedImage?.imageUrl && <ImageGenerationResultView imageUrl={completedImage.imageUrl} seed={completedImage.seed}
        download={completedImage.imageUrl.startsWith('data:image/png;base64,') ? { filename: `novelai-${completedImage.seed ?? 'image'}.png` } : undefined} />}
    </div>
  );
}
