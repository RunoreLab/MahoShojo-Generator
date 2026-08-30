import { useCallback, useEffect, useMemo, useState } from 'react';

import { PresetGridPicker } from '@/components/PresetGridPicker';
import { randomUUID } from '@/lib/crypto';
import { inferTemplate } from '@/lib/data-card-converter';
import type { Preset } from '@/lib/presets';
import type { MagicTeaPartyPreferences, MagicTeaPartyRole, MagicTeaPartySession } from '@/lib/magic-tea-party/types';

type MagicTeaPartyPresetCharacterPanelProps = {
  activeSession: MagicTeaPartySession | null;
  preferences: MagicTeaPartyPreferences;
  onPreferenceChange: (patch: Partial<MagicTeaPartyPreferences>) => void;
  onUpdateRoles: (roles: MagicTeaPartyRole[]) => void;
};

type PresetCollections = {
  magicalGirl: Preset[];
  canshou: Preset[];
};

const fetchPresets = async (): Promise<PresetCollections> => {
  const response = await fetch('/api/get-presets');
  if (!response.ok) throw new Error('无法加载预设列表');
  const data = (await response.json()) as Preset[];
  return {
    magicalGirl: data.filter((preset) => preset.type === 'magical-girl'),
    canshou: data.filter((preset) => preset.type === 'canshou'),
  };
};

const buildRoleFromPreset = (preset: Preset, card: Record<string, unknown>): MagicTeaPartyRole => {
  const template = inferTemplate(card);
  const name =
    template === 'magical-girl'
      ? (typeof (card as any).codename === 'string' ? (card as any).codename.trim() : '') || preset.name
      : typeof (card as any).name === 'string'
        ? (card as any).name.trim()
        : preset.name;
  return {
    id: randomUUID(),
    name: name || preset.name,
    template: template === 'magical-girl' || template === 'canshou' || template === 'general' ? template : undefined,
    templateId: typeof (card as any).templateId === 'string' ? (card as any).templateId : preset.filename,
    source: 'preset',
    card,
    origin: { fileName: preset.filename, importedAt: Date.now() },
  };
};

export function MagicTeaPartyPresetCharacterPanel(props: MagicTeaPartyPresetCharacterPanelProps) {
  const { activeSession, preferences, onPreferenceChange, onUpdateRoles } = props;
  const [collapsed, setCollapsed] = useState(preferences.presetCharacterPanelCollapsed);
  const [presets, setPresets] = useState<PresetCollections | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mgPage, setMgPage] = useState(1);
  const [canshouPage, setCanshouPage] = useState(1);
  const [loadingFilename, setLoadingFilename] = useState<string | null>(null);

  useEffect(() => {
    setCollapsed(preferences.presetCharacterPanelCollapsed);
  }, [preferences.presetCharacterPanelCollapsed]);

  const selectedFilenames = useMemo(() => {
    const roles = activeSession?.roles ?? [];
    return roles
      .filter((role) => role.source === 'preset' && role.origin?.fileName)
      .map((role) => role.origin?.fileName as string);
  }, [activeSession?.roles]);

  const loadPresets = useCallback(async () => {
    if (presets || loading) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPresets();
      setPresets(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法加载预设');
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
    async (preset: Preset) => {
      if (!activeSession) return;
      const roles = activeSession.roles ?? [];
      const existingIndex = roles.findIndex(
        (role) => role.source === 'preset' && role.origin?.fileName === preset.filename
      );
      if (existingIndex >= 0) {
        const nextRoles = roles.filter((_, idx) => idx !== existingIndex);
        onUpdateRoles(nextRoles);
        return;
      }

      setLoadingFilename(preset.filename);
      try {
        const response = await fetch(`/presets/${encodeURIComponent(preset.filename)}`);
        if (!response.ok) throw new Error(`无法加载 ${preset.name}`);
        const card = (await response.json()) as Record<string, unknown>;
        const nextRoles = [...roles, buildRoleFromPreset(preset, card)];
        onUpdateRoles(nextRoles);
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载预设失败');
      } finally {
        setLoadingFilename(null);
      }
    },
    [activeSession, onUpdateRoles]
  );

  return (
    <div className="rounded-xl border border-pink-100 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-gray-800">预设角色</div>
        <button
          type="button"
          className="text-xs text-pink-700 hover:underline"
          onClick={() => {
            const next = !collapsed;
            setCollapsed(next);
            onPreferenceChange({ presetCharacterPanelCollapsed: next });
          }}
        >
          {collapsed ? '展开' : '收起'}
        </button>
      </div>

      {collapsed ? (
        <div className="text-xs text-gray-500">已选择 {selectedFilenames.length} 个预设角色。</div>
      ) : (
        <>
          {error ? <div className="text-xs text-red-600">{error}</div> : null}
          {loading || !presets ? (
            <div className="text-xs text-gray-500">正在加载预设...</div>
          ) : (
            <>
              <PresetGridPicker
                title="预设魔法少女"
                presets={presets.magicalGirl}
                currentPage={mgPage}
                onPageChange={setMgPage}
                disabled={!activeSession}
                maxSelected={999}
                selectedFilenames={selectedFilenames}
                loadingFilename={loadingFilename}
                onToggle={handleToggle}
              />
              <PresetGridPicker
                title="预设残兽"
                presets={presets.canshou}
                currentPage={canshouPage}
                onPageChange={setCanshouPage}
                disabled={!activeSession}
                maxSelected={999}
                selectedFilenames={selectedFilenames}
                loadingFilename={loadingFilename}
                onToggle={handleToggle}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
