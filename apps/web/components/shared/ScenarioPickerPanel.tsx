'use client';

import Link from 'next/link';
import { ChangeEvent, useEffect, useRef, useState } from 'react';

import { DisclosureButton } from '@/components/shared/CollapsibleSection';

type ScenarioPickerPanelProps = {
  onOpenScenarioModal: () => void;
  /** 缺省时隐藏随机匹配入口（如 proposal 只允许 exact ref 场景）。 */
  onRandomMatchScenario?: () => void | Promise<void>;
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
          {onRandomMatchScenario ? (
            <button
              onClick={() => void onRandomMatchScenario()}
              disabled={isGenerating || isMatchingBlocked}
              className="flex-1 px-4 py-2 bg-teal-500 text-white rounded hover:bg-teal-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
              {isMatchingScenario ? '匹配中...' : '随机匹配情景'}
            </button>
          ) : null}
        </div>
        {!isAuthenticated && (
          <div className="battle-lite-subtle-text flex flex-1 items-center px-2 text-xs">
            <Link href="/character-manager" className="battle-lite-link underline">
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
            className="battle-lite-file-input input-field cursor-pointer font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          />
        </>
      )}
      {scenarioFileName && (
        <p className="battle-lite-subtle-text mt-2 text-xs">
          已加载情景: <span className="battle-lite-link font-bold">{scenarioFileName}</span>
          {isScenarioNative && <span className="battle-lite-link ml-1 text-xs font-semibold">(原生)</span>}
        </p>
      )}

      <div className="mb-6 mt-4">
        {enableLocalInput && (
          <>
            <DisclosureButton
              open={isPasteVisible}
              onToggle={() => setIsPasteVisible((prev) => !prev)}
              className="battle-lite-link mb-2"
            >
              {isPasteVisible ? '收起情景粘贴区域' : '展开情景粘贴区域（手机端推荐）'}
            </DisclosureButton>
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
        <div className="battle-lite-accent-box mt-2 rounded-lg p-3 text-sm">
          <p className="font-bold">你已选择【情景模式】！</p>
          <p className="mt-1">
            {enableLocalInput
              ? '选择一个情景数据卡或上传情景文件，让角色们在自定义的舞台上展开故事吧！'
              : onRandomMatchScenario
                ? '请选择一个已通过审查且未被封禁的在线情景数据卡（也可使用随机匹配）。'
                : '请选择一个已通过审查且未被封禁的在线情景数据卡。'}
          </p>
        </div>
      </div>
    </div>
  );
}
