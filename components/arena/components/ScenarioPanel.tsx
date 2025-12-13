'use client';

import { ChangeEvent, useEffect, useRef, useState } from 'react';

import { useBattleStore } from '../stores/useBattleStore';
import { useBattleActions } from '../hooks/useBattleActions';
import { BattleStoreState } from '../types';

export function ScenarioPanel() {
  const useBattleSelector = <T,>(selector: (state: BattleStoreState) => T) => useBattleStore(selector);
  const scenario = useBattleSelector((state) => state.scenario);
  const isGenerating = useBattleSelector((state) => state.isGenerating);
  const { handleScenarioUpload, handleScenarioPaste } = useBattleActions();
  const [isPasteVisible, setIsPasteVisible] = useState(false);
  const [pastedJson, setPastedJson] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const isMobile =
      typeof window !== 'undefined' &&
      /mobile|android|iphone|ipad|ipod|blackberry|iemobile|opera mini/.test(navigator.userAgent.toLowerCase());
    if (isMobile) {
      setIsPasteVisible(true);
    }
  }, []);

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await handleScenarioUpload(file);
    } finally {
      if (inputRef.current) {
        inputRef.current.value = '';
      }
    }
  };

  const onPaste = async () => {
    await handleScenarioPaste(pastedJson);
    setPastedJson('');
  };

  return (
    <div className="mt-4">
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
      {scenario.fileName && (
        <p className="text-xs text-gray-500 mt-2">
          已加载情景: <span className="font-bold text-green-600">{scenario.fileName}</span>
          {scenario.isNative && <span className="text-xs text-green-600 ml-1 font-semibold">(原生)</span>}
        </p>
      )}

      <div className="mb-6 mt-4">
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
              onClick={onPaste}
              disabled={!pastedJson.trim() || isGenerating}
              className="generate-button mt-2 mb-0"
              style={{ backgroundColor: '#8b5cf6', backgroundImage: 'linear-gradient(to right, #8b5cf6, #a78bfa)' }}
            >
              从文本加载情景
            </button>
          </div>
        )}
        <div className="mt-2 p-3 bg-purple-50 border border-purple-200 rounded-lg text-sm text-purple-800">
          <p className="font-bold">你已选择【情景模式】！</p>
          <p className="mt-1">选择一个情景数据卡或上传情景文件，让角色们在自定义的舞台上展开故事吧！</p>
        </div>
      </div>
    </div>
  );
}
