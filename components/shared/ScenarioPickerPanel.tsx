'use client';

import Link from 'next/link';
import { ChangeEvent, useEffect, useRef, useState } from 'react';

type ScenarioPickerPanelProps = {
  onOpenScenarioModal: () => void;
  onRandomMatchScenario: () => void | Promise<void>;
  enableLocalInput?: boolean;
  onScenarioUpload?: (file: File) => void | Promise<void>;
  onScenarioPaste?: (jsonText: string) => void | Promise<void>;
  onActionError?: (error: Error) => void;
  isAuthenticated: boolean;
  isGenerating?: boolean;
  isMatchingBlocked?: boolean;
  isMatchingScenario?: boolean;
  scenarioFileName?: string | null;
  isScenarioNative?: boolean;
};

export function ScenarioPickerPanel({
  onOpenScenarioModal,
  onRandomMatchScenario,
  enableLocalInput = true,
  onScenarioUpload,
  onScenarioPaste,
  onActionError,
  isAuthenticated,
  isGenerating = false,
  isMatchingBlocked = false,
  isMatchingScenario = false,
  scenarioFileName = null,
  isScenarioNative = false,
}: ScenarioPickerPanelProps) {
  const [isPasteVisible, setIsPasteVisible] = useState(false);
  const [pastedJson, setPastedJson] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!enableLocalInput) return;
    const isMobile =
      typeof window !== 'undefined' &&
      /mobile|android|iphone|ipad|ipod|blackberry|iemobile|opera mini/.test(navigator.userAgent.toLowerCase());
    if (isMobile) {
      setIsPasteVisible(true);
    }
  }, [enableLocalInput]);

  const reportError = (error: unknown) => {
    const e = error instanceof Error ? error : new Error('未知错误');
    onActionError?.(e);
  };

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!onScenarioUpload) return;
    try {
      await onScenarioUpload(file);
    } catch (error) {
      reportError(error);
    } finally {
      if (inputRef.current) {
        inputRef.current.value = '';
      }
    }
  };

  const onPaste = async () => {
    if (!onScenarioPaste) return;
    try {
      await onScenarioPaste(pastedJson);
      setPastedJson('');
    } catch (error) {
      reportError(error);
    }
  };

  return (
    <div className="mt-4">
      <div className="mb-4">
        <h3 className="input-label">选择情景</h3>
        <div className="flex gap-2 mb-4">
          <button
            onClick={onOpenScenarioModal}
            disabled={isGenerating}
            className="flex-1 px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            浏览在线情景库
          </button>
          <button
            onClick={() => void onRandomMatchScenario()}
            disabled={isGenerating || isMatchingBlocked}
            className="flex-1 px-4 py-2 bg-teal-500 text-white rounded hover:bg-teal-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            {isMatchingScenario ? '匹配中...' : '随机匹配情景'}
          </button>
        </div>
        {!isAuthenticated && (
          <div className="flex-1 text-xs text-gray-500 flex items-center px-2">
            <Link href="/character-manager" className="text-green-600 hover:text-green-800 underline">
              登录后可访问私有数据卡
            </Link>
          </div>
        )}
      </div>

      {enableLocalInput && (
        <>
          <label htmlFor="scenario-upload" className="input-label">
            上传情景文件 (.json)
          </label>
          <input
            ref={inputRef}
            id="scenario-upload"
            type="file"
            accept=".json"
            onChange={onFileChange}
            disabled={isGenerating}
            className="cursor-pointer input-field file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm font-semibold file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100 disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </>
      )}
      {scenarioFileName && (
        <p className="text-xs text-gray-500 mt-2">
          已加载情景: <span className="font-bold text-green-600">{scenarioFileName}</span>
          {isScenarioNative && <span className="text-xs text-green-600 ml-1 font-semibold">(原生)</span>}
        </p>
      )}

      <div className="mb-6 mt-4">
        {enableLocalInput && (
          <>
            <button
              onClick={() => setIsPasteVisible(!isPasteVisible)}
              className="text-purple-700 hover:underline cursor-pointer mb-2 font-semibold"
            >
              {isPasteVisible ? '▼ 折叠情景粘贴区域' : '▶ 展开情景粘贴区域 (手机端推荐)'}
            </button>
            {isPasteVisible && (
              <div className="input-group mt-2">
                <textarea
                  value={pastedJson}
                  onChange={(e) => setPastedJson(e.target.value)}
                  placeholder="在此处粘贴一个情景的设定文件(.json)内容..."
                  className="input-field resize-y h-24"
                  disabled={isGenerating}
                />
                <button
                  onClick={() => void onPaste()}
                  disabled={!pastedJson.trim() || isGenerating}
                  className="generate-button mt-2 mb-0"
                  style={{ backgroundColor: '#8b5cf6', backgroundImage: 'linear-gradient(to right, #8b5cf6, #a78bfa)' }}
                >
                  从文本加载情景
                </button>
              </div>
            )}
          </>
        )}
        <div className="mt-2 p-3 bg-purple-50 border border-purple-200 rounded-lg text-sm text-purple-800">
          <p className="font-bold">你已选择【情景模式】！</p>
          <p className="mt-1">
            {enableLocalInput
              ? '选择一个情景数据卡或上传情景文件，让角色们在自定义的舞台上展开故事吧！'
              : '请选择一个已通过审查且未被封禁的在线情景数据卡（也可使用随机匹配）。'}
          </p>
        </div>
      </div>
    </div>
  );
}
