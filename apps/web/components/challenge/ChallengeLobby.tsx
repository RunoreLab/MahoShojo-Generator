import { useEffect, useState } from 'react';

import AiProviderSelector from '@/components/AiProviderSelector';
import { DatabaseSelector } from '@/components/arena/components/DatabaseSelector';
import { ChallengeCardImportPanel } from '@/components/challenge/ChallengeCardImportPanel';
import { ChallengeEntrantSummaryCard } from '@/components/challenge/ChallengeEntrantSummaryCard';
import { ChallengeResumePanel } from '@/components/challenge/ChallengeResumePanel';
import { ChallengeUnlockPanel } from '@/components/challenge/ChallengeUnlockPanel';
import type { ChallengeEntrantSummary } from '@/components/challenge/hooks/useChallengeController';
import { CollapsibleSection } from '@/components/shared/CollapsibleSection';
import type { ChallengeRunRecord, ChallengeUnlockRecord } from '@/lib/challenge/types';

type ChallengeLobbyProps = {
  worldTitle: string;
  recentRuns: ChallengeRunRecord[];
  unlocks: ChallengeUnlockRecord[];
  isLoadingRecentRuns: boolean;
  isAuthenticated: boolean;
  isSubmitting: boolean;
  isMatching: 'character' | null;
  entrantSummary: ChallengeEntrantSummary | null;
  rawEditorText: string;
  selectionError: string | null;
  localImportError: string | null;
  editorError: string | null;
  isEditorDirty: boolean;
  advancedEditorRevealToken: number;
  onRawEditorTextChange: (value: string) => void;
  onApplyEditorText: () => void;
  onOpenCharacterPicker: () => void;
  onRandomMatchEntrant: () => void;
  onImportEntrantFile: (file: File) => void | Promise<void>;
  onImportEntrantText: (text: string) => void | Promise<void>;
  onLoadDemoCard: () => void;
  onClearEntrant: () => void;
  onRevealAdvancedEditor: () => void;
  onPrepareChallenge: () => void;
  onUserProviderConfigChange: Parameters<typeof AiProviderSelector>[0]['onConfigChange'];
  onResumeRun: (runId: string) => void;
  onDeleteRun: (runId: string) => void;
};

export function ChallengeLobby({
  worldTitle,
  recentRuns,
  unlocks,
  isLoadingRecentRuns,
  isAuthenticated,
  isSubmitting,
  isMatching,
  entrantSummary,
  rawEditorText,
  selectionError,
  localImportError,
  editorError,
  isEditorDirty,
  advancedEditorRevealToken,
  onRawEditorTextChange,
  onApplyEditorText,
  onOpenCharacterPicker,
  onRandomMatchEntrant,
  onImportEntrantFile,
  onImportEntrantText,
  onLoadDemoCard,
  onClearEntrant,
  onRevealAdvancedEditor,
  onPrepareChallenge,
  onUserProviderConfigChange,
  onResumeRun,
  onDeleteRun,
}: ChallengeLobbyProps) {
  const [advancedEditorAutoOpen, setAdvancedEditorAutoOpen] = useState(false);

  useEffect(() => {
    if (advancedEditorRevealToken <= 0) return;
    setAdvancedEditorAutoOpen(true);
  }, [advancedEditorRevealToken]);

  useEffect(() => {
    if (!advancedEditorAutoOpen) return;
    const handle = window.setTimeout(() => {
      setAdvancedEditorAutoOpen(false);
    }, 0);
    return () => window.clearTimeout(handle);
  }, [advancedEditorAutoOpen]);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
      <section className="rounded-[28px] border border-rose-200/70 bg-white/85 p-6 shadow-[0_16px_48px_rgba(244,114,182,0.10)] backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-rose-500">世界选择</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">{worldTitle}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              先为这轮 challenge 选定一张入场角色卡。你可以沿用 arena 的在线角色库与随机匹配，也可以从本地文件或粘贴文本导入。
            </p>
          </div>
          <button
            type="button"
            onClick={onLoadDemoCard}
            className="rounded-full border border-slate-300 px-4 py-2 text-sm text-slate-700 transition hover:border-rose-300 hover:text-rose-600"
          >
            载入试玩示例
          </button>
        </div>

        <div className="mt-6 space-y-4">
          <CollapsibleSection
            title="当前挑战者"
            description={entrantSummary ? `${entrantSummary.displayName} · ${entrantSummary.sourceModeLabel}` : '尚未选择角色卡'}
            defaultOpen
            keepMounted
            storageKey="challenge.section.currentEntrant.open"
          >
            <ChallengeEntrantSummaryCard
              summary={entrantSummary}
              onClear={onClearEntrant}
              onRevealAdvancedEditor={() => {
                onRevealAdvancedEditor();
              }}
              onLoadDemoCard={onLoadDemoCard}
            />
          </CollapsibleSection>

          <CollapsibleSection
            title="在线角色库 / 随机匹配"
            description="登录后可使用私有卡；随机匹配仅从公开卡中抽取"
            defaultOpen
            keepMounted
            storageKey="challenge.section.database.open"
          >
            <DatabaseSelector
              className="!mb-0"
              title={null}
              onOpenCharacterModal={onOpenCharacterPicker}
              onRandomMatchCharacter={onRandomMatchEntrant}
              isAuthenticated={isAuthenticated}
              isGenerating={isSubmitting}
              isMatching={isMatching}
              combatantCount={0}
              maxCombatants={null}
            />
            {selectionError ? <p className="mt-3 text-sm text-red-600">{selectionError}</p> : null}
          </CollapsibleSection>

          <CollapsibleSection
            title="本地导入"
            description="支持上传单张 .json，或展开粘贴文本"
            defaultOpen
            keepMounted
            storageKey="challenge.section.localImport.open"
          >
            <ChallengeCardImportPanel
              isSubmitting={isSubmitting}
              localImportError={localImportError}
              onImportFile={onImportEntrantFile}
              onImportText={onImportEntrantText}
            />
          </CollapsibleSection>

          <CollapsibleSection
            title="AI 裁定模型"
            description="与竞技场共用本地模型和提供商设置，后续 AI 节点可在节点页继续调整"
            defaultOpen
            keepMounted
            storageKey="challenge.section.aiProvider.open"
          >
            <div className="space-y-3">
              <p className="text-sm leading-6 text-slate-600">
                战斗节点与需要文本裁定的事件节点会直接读取这里的模型设置。该配置会与
                {' '}
                <span className="font-medium text-slate-800">/arena</span>
                {' '}
                共用同一份本地持久化记录。
              </p>
              <AiProviderSelector onConfigChange={onUserProviderConfigChange} />
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            title="高级 JSON 编辑"
            description={isEditorDirty ? '存在未应用修改' : '默认折叠，仅用于高级编辑与排障'}
            defaultOpen={false}
            autoOpen={advancedEditorAutoOpen}
            keepMounted
            storageKey="challenge.section.advancedEditor.open"
          >
            <div className="space-y-3">
              <label className="block text-sm font-medium text-slate-800" htmlFor="challenge-card-json-editor">
                原始角色卡 JSON
              </label>
              <textarea
                id="challenge-card-json-editor"
                value={rawEditorText}
                onChange={(event) => onRawEditorTextChange(event.target.value)}
                className="min-h-[260px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-xs leading-6 text-slate-700 outline-none transition focus:border-rose-300 focus:bg-white"
                placeholder="在这里继续手动调整 challenge 入场角色卡 JSON。"
              />
              {editorError ? <p className="text-sm text-red-600">{editorError}</p> : null}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={onApplyEditorText}
                  disabled={isSubmitting}
                  className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                >
                  应用编辑内容
                </button>
                <p className="text-sm text-slate-500">点击“生成竞技场快照”时，如果这里仍有未应用改动，会先自动尝试应用。</p>
              </div>
            </div>
          </CollapsibleSection>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onPrepareChallenge}
            disabled={isSubmitting}
            className="rounded-full bg-rose-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-rose-600 disabled:cursor-not-allowed disabled:bg-rose-300"
          >
            生成竞技场快照
          </button>
          <p className="text-sm text-slate-500">进入 bootstrap 后可进行一次免费重掷，再正式开始本轮挑战。</p>
        </div>
      </section>

      <aside className="space-y-5">
        <ChallengeResumePanel
          worldTitle={worldTitle}
          runs={recentRuns}
          isLoading={isLoadingRecentRuns}
          onResume={onResumeRun}
          onDelete={onDeleteRun}
        />
        <ChallengeUnlockPanel unlocks={unlocks} />
      </aside>
    </div>
  );
}
