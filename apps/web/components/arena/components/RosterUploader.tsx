'use client';

import { ArenaRosterImportPanel } from '@mahoshojo/ui-web/arena';

import { useLocalLibraryAutoSave } from '@/lib/local-library/use-local-library-auto-save';
import { LocalLibrarySavePreference } from '@/components/shared/LocalLibrarySavePreference';
import { useLocalLibraryPreferences } from '@/lib/local-library/preferences';
import type { CombatantData } from '../types';

import { useBattleStore } from '../stores/useBattleStore';
import { BattleStoreState, isCombatantLimitReached, MAX_COMBATANTS } from '../types';
import { useBattleActions } from '../hooks/useBattleActions';

export function RosterUploader() {
  const useBattleSelector = <T,>(selector: (state: BattleStoreState) => T) => useBattleStore(selector);
  const combatants = useBattleSelector((state) => state.combatants);
  const isGenerating = useBattleSelector((state) => state.isGenerating);
  const setError = useBattleSelector((state) => state.setError);
  const { handleFileUpload, handlePaste } = useBattleActions();
  const { preferences, setPreference } = useLocalLibraryPreferences();
  const autoSave = useLocalLibraryAutoSave();

  const persistImported = async (imported: CombatantData[]): Promise<void> => {
    if (!preferences.saveImportedDataCards || imported.length === 0) return;
    await autoSave.save(imported.map((item) => ({
      cardType: 'character' as const,
      title: item.filename,
      payload: item.data,
    })));
  };

  return <ArenaRosterImportPanel
    disabled={isGenerating}
    limitReached={isCombatantLimitReached(combatants.length, MAX_COMBATANTS)}
    onUpload={async (files) => { const imported = await handleFileUpload(files); await persistImported(imported); setError(null); }}
    onPaste={async (text) => { const imported = await handlePaste(text); await persistImported(imported); setError(null); }}
    onError={(error, source) => setError(error instanceof Error ? error.message : source === 'upload' ? '上传文件解析失败' : '粘贴内容解析失败')}
    afterUpload={<>
        <LocalLibrarySavePreference
          checked={preferences.saveImportedDataCards}
          onChange={(next) => setPreference('saveImportedDataCards', next)}
          disabled={isGenerating}
        />
        {autoSave.error ? (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400" role="status">
            {autoSave.error}
          </p>
        ) : null}
        {autoSave.result && (autoSave.result.saved > 0 || autoSave.result.updated > 0) ? (
          <p className="mt-1 text-xs text-gray-500" role="status" data-testid="roster-local-library-status">
            已保存到本地库：新增 {autoSave.result.saved} 张，更新 {autoSave.result.updated} 张。
          </p>
        ) : null}
        {autoSave.result && autoSave.result.inRecycleBin > 0 ? (
          <p className="mt-1 text-xs text-gray-500" role="status" data-testid="roster-local-library-recycle-bin">
            {autoSave.result.inRecycleBin} 张内容相同的数据卡在本地库回收站中，未重复保存；可在「本地库」页面恢复。
          </p>
        ) : null}
    </>}
  />;
}
