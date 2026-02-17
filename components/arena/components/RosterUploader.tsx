'use client';

import { ChangeEvent, useEffect, useRef, useState } from 'react';

import { DisclosureButton } from '@/components/shared/CollapsibleSection';

import { useBattleStore } from '../stores/useBattleStore';
import { BattleStoreState, isCombatantLimitReached, MAX_COMBATANTS } from '../types';
import { useBattleActions } from '../hooks/useBattleActions';

export function RosterUploader() {
  const [isPasteVisible, setIsPasteVisible] = useState(false);
  const [pastedJson, setPastedJson] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const useBattleSelector = <T,>(selector: (state: BattleStoreState) => T) => useBattleStore(selector);
  const combatants = useBattleSelector((state) => state.combatants);
  const isGenerating = useBattleSelector((state) => state.isGenerating);
  const [isPasting, setIsPasting] = useState(false);
  const setError = useBattleSelector((state) => state.setError);
  const { handleFileUpload, handlePaste } = useBattleActions();

  useEffect(() => {
    const isMobile =
      typeof window !== 'undefined' &&
      /mobile|android|iphone|ipad|ipod|blackberry|iemobile|opera mini/.test(navigator.userAgent.toLowerCase());
    if (isMobile) {
      setIsPasteVisible(true);
    }
  }, []);

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;
    try {
      await handleFileUpload(files);
      setError(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : '上传文件解析失败');
    } finally {
      if (inputRef.current) {
        inputRef.current.value = '';
      }
    }
  };

  const onPaste = async () => {
    setIsPasting(true);
    try {
      await handlePaste(pastedJson);
      setError(null);
      setPastedJson('');
    } catch (error) {
      setError(error instanceof Error ? error.message : '粘贴内容解析失败');
    } finally {
      setIsPasting(false);
    }
  };

  return (
    <>
      <div className="input-group">
        <label htmlFor="file-upload" className="input-label">
          上传自己的 .json 设定文件
        </label>
        <input
          ref={inputRef}
          id="file-upload"
          type="file"
          multiple
          accept=".json"
          onChange={onFileChange}
          disabled={isGenerating}
          className="cursor-pointer input-field file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-pink-50 file:text-pink-700 hover:file:bg-pink-100 disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>

      <div className="mb-6">
        <DisclosureButton
          open={isPasteVisible}
          onToggle={() => setIsPasteVisible((prev) => !prev)}
          className="text-pink-700 hover:underline mb-2"
        >
          {isPasteVisible ? '收起角色粘贴区域' : '展开角色粘贴区域（手机端推荐）'}
        </DisclosureButton>
        {isPasteVisible && (
          <div className="input-group mt-2">
            <textarea
              value={pastedJson}
              onChange={(e) => setPastedJson(e.target.value)}
              placeholder="在此处粘贴一个或多个角色设定文件(.json)内容..."
              className="input-field resize-y h-32"
              disabled={isGenerating}
            />
            <button
              onClick={onPaste}
              disabled={
                !pastedJson.trim() ||
                isGenerating ||
                isPasting ||
                isCombatantLimitReached(combatants.length, MAX_COMBATANTS)
              }
              className="generate-button mt-2 mb-0"
            >
              从文本添加角色
            </button>
          </div>
        )}
      </div>
    </>
  );
}
