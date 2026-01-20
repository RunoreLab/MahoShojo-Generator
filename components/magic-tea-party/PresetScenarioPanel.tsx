import { useCallback, useEffect, useMemo, useState } from 'react';

import { ScenarioPresetGridPicker } from '@/components/ScenarioPresetGridPicker';
import { randomUUID } from '@/lib/crypto';
import { inferTemplate } from '@/lib/data-card-converter';
import type { MagicTeaPartyPreferences, MagicTeaPartyScenario, MagicTeaPartySession } from '@/lib/magic-tea-party/types';
import type { ScenarioPreset } from '@/lib/scenario-presets';

const EMPTY_AUX_SCENARIOS: MagicTeaPartyScenario[] = [];

type MagicTeaPartyPresetScenarioPanelProps = {
  activeSession: MagicTeaPartySession | null;
  preferences: MagicTeaPartyPreferences;
  onPreferenceChange: (patch: Partial<MagicTeaPartyPreferences>) => void;
  onUpdateScenarios: (scenario: MagicTeaPartyScenario | undefined, auxScenarios: MagicTeaPartyScenario[]) => void;
};

const fetchScenarioPresets = async (): Promise<ScenarioPreset[]> => {
  const response = await fetch('/api/get-scenario-presets');
  if (!response.ok) throw new Error('无法加载预设情景列表');
  return (await response.json()) as ScenarioPreset[];
};

const buildScenarioFromPreset = (preset: ScenarioPreset, card: Record<string, unknown>): MagicTeaPartyScenario | null => {
  const template = inferTemplate(card);
  if (template !== 'scenario' && template !== 'general-scenario') return null;

  const title =
    typeof (card as any).title === 'string'
      ? (card as any).title.trim()
      : typeof (card as any).name === 'string'
        ? (card as any).name.trim()
        : '';

  return {
    id: randomUUID(),
    title: title || preset.title,
    templateId: typeof (card as any).templateId === 'string' ? (card as any).templateId : undefined,
    source: 'preset',
    signature: typeof (card as any).signature === 'string' ? (card as any).signature : undefined,
    card,
    origin: { fileName: preset.filename, importedAt: Date.now() },
  };
};

export function MagicTeaPartyPresetScenarioPanel(props: MagicTeaPartyPresetScenarioPanelProps) {
  const { activeSession, preferences, onPreferenceChange, onUpdateScenarios } = props;
  const [collapsed, setCollapsed] = useState(preferences.presetScenarioPanelCollapsed);
  const [presets, setPresets] = useState<ScenarioPreset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [loadingFilename, setLoadingFilename] = useState<string | null>(null);

  const scenario = activeSession?.scenario;
  const auxScenarios = activeSession?.auxScenarios ?? EMPTY_AUX_SCENARIOS;

  useEffect(() => {
    setCollapsed(preferences.presetScenarioPanelCollapsed);
  }, [preferences.presetScenarioPanelCollapsed]);

  const selectedFilenames = useMemo(() => {
    const out: string[] = [];
    if (scenario?.source === 'preset' && scenario.origin?.fileName) out.push(scenario.origin.fileName);
    auxScenarios.forEach((scn) => {
      if (scn?.source === 'preset' && scn.origin?.fileName) out.push(scn.origin.fileName);
    });
    return out;
  }, [auxScenarios, scenario?.origin?.fileName, scenario?.source]);

  const loadPresets = useCallback(async () => {
    if (presets || loading) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchScenarioPresets();
      setPresets(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法加载预设情景');
    } finally {
      setLoading(false);
    }
  }, [loading, presets]);

  useEffect(() => {
    if (!collapsed) {
      void loadPresets();
    }
  }, [collapsed, loadPresets]);

  const handleToggle = useCallback(
    async (preset: ScenarioPreset) => {
      if (!activeSession) return;

      const existingMain = scenario?.source === 'preset' && scenario.origin?.fileName === preset.filename;
      const existingAuxIndex = auxScenarios.findIndex((scn) => scn?.source === 'preset' && scn.origin?.fileName === preset.filename);
      if (existingMain) {
        onUpdateScenarios(undefined, auxScenarios);
        return;
      }
      if (existingAuxIndex >= 0) {
        onUpdateScenarios(scenario, auxScenarios.filter((_, idx) => idx !== existingAuxIndex));
        return;
      }

      setLoadingFilename(preset.filename);
      try {
        const response = await fetch(`/scenario-presets/${encodeURIComponent(preset.filename)}`);
        if (!response.ok) throw new Error(`无法加载预设情景：${preset.title}`);
        const card = (await response.json()) as Record<string, unknown>;
        const built = buildScenarioFromPreset(preset, card);
        if (!built) throw new Error('预设情景格式不受支持');

        if (!scenario) {
          onUpdateScenarios(built, auxScenarios);
        } else {
          onUpdateScenarios(scenario, [...auxScenarios, built]);
        }
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载预设失败');
      } finally {
        setLoadingFilename(null);
      }
    },
    [activeSession, auxScenarios, onUpdateScenarios, scenario]
  );

  return (
    <div className="rounded-xl border border-pink-100 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-gray-800">预设情景</div>
        <button
          type="button"
          className="text-xs text-pink-700 hover:underline"
          onClick={() => {
            const next = !collapsed;
            setCollapsed(next);
            onPreferenceChange({ presetScenarioPanelCollapsed: next });
          }}
        >
          {collapsed ? '展开' : '收起'}
        </button>
      </div>

      {collapsed ? (
        <div className="text-xs text-gray-500">
          主情景：{scenario ? '已选' : '未选'} · 追加情景：{auxScenarios.length} · 已选择 {selectedFilenames.length} 个预设情景。
        </div>
      ) : (
        <>
          <div className="text-xs text-gray-500">
            提示：若尚未选择主情景，点击预设将设为主情景；否则会追加为“辅助情景”。
          </div>
          {error ? <div className="text-xs text-red-600">{error}</div> : null}
          {loading || !presets ? (
            <div className="text-xs text-gray-500">正在加载预设情景...</div>
          ) : (
            <ScenarioPresetGridPicker
              title="选择预设情景"
              presets={presets}
              currentPage={page}
              onPageChange={setPage}
              disabled={!activeSession}
              selectedFilenames={selectedFilenames}
              loadingFilename={loadingFilename}
              onToggle={handleToggle}
            />
          )}
        </>
      )}
    </div>
  );
}
