import { useCallback, useMemo, useRef, useState } from 'react';

import { ErrorMessage } from '@/components/ErrorMessage';
import { downloadBlob } from '@/lib/client/blobUrl';
import { buildSafeFileName } from '@/lib/client/fileName';
import { randomUUID } from '@/lib/crypto';
import {
  listMagicTeaPartyMessages,
  listMagicTeaPartySessions,
  listMagicTeaPartyTachieAssets,
  putMagicTeaPartyMessage,
  putMagicTeaPartySession,
  putMagicTeaPartyTachieAsset,
} from '@/lib/magic-tea-party/storage';
import type {
  MagicTeaPartyMessage,
  MagicTeaPartyPreferences,
  MagicTeaPartyRole,
  MagicTeaPartyScenario,
  MagicTeaPartySession,
  MagicTeaPartyTachieAsset,
} from '@/lib/magic-tea-party/types';
import {
  buildMagicTeaPartySessionExport,
  parseSillyTavernJsonl,
  stringifySillyTavernJsonl,
  type MagicTeaPartyArchiveExport,
  type MagicTeaPartySessionExport,
} from '@/lib/magic-tea-party/transfer';

type ImportExportPanelProps = {
  activeSession: MagicTeaPartySession | null;
  preferences: MagicTeaPartyPreferences;
  onSessionImported: (sessionId: string) => void;
};

const getBaseTitle = (filename: string, fallback: string): string => {
  const trimmed = filename.trim();
  if (!trimmed) return fallback;
  return trimmed.replace(/\.[^/.]+$/, '').trim() || fallback;
};

const ensureRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const ensureArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

export function MagicTeaPartyImportExportPanel(props: ImportExportPanelProps) {
  const { activeSession, preferences, onSessionImported } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const roleNameLookup = useMemo(() => {
    const map = new Map<string, string>();
    for (const role of activeSession?.roles ?? []) {
      map.set(role.id, role.name);
    }
    return (roleId: string) => map.get(roleId) ?? roleId;
  }, [activeSession?.roles]);

  const buildSessionSettings = useCallback(
    (raw: Record<string, unknown> | null | undefined) => {
      const defaults = preferences;
      const base = (raw ?? {}) as Record<string, unknown>;
      return {
        providerId: typeof base.providerId === 'string' ? base.providerId : 'unknown',
        modelId: typeof base.modelId === 'string' ? base.modelId : '',
        temperature: typeof base.temperature === 'number' ? base.temperature : 0.75,
        maxContextMessages: typeof base.maxContextMessages === 'number' ? base.maxContextMessages : undefined,
        contextWindowTokens: typeof base.contextWindowTokens === 'number' ? base.contextWindowTokens : undefined,
        responseReserveTokens: typeof base.responseReserveTokens === 'number' ? base.responseReserveTokens : undefined,
        summaryTriggerRatio: typeof base.summaryTriggerRatio === 'number' ? base.summaryTriggerRatio : undefined,
        summaryMaxTokens: typeof base.summaryMaxTokens === 'number' ? base.summaryMaxTokens : undefined,
        summaryMinGapMessages: typeof base.summaryMinGapMessages === 'number' ? base.summaryMinGapMessages : undefined,
        enableChoices: typeof base.enableChoices === 'boolean' ? base.enableChoices : defaults.enableChoices,
        choiceCount: typeof base.choiceCount === 'number' ? base.choiceCount : defaults.choiceCount,
        outputFormat: base.outputFormat === 'markdown' ? 'markdown' : defaults.outputFormat,
        language: base.language === 'en-US' || base.language === 'ja-JP' ? base.language : defaults.language,
        userDisplayName: typeof base.userDisplayName === 'string' ? base.userDisplayName : defaults.userDisplayName,
        presetId: typeof base.presetId === 'string' ? base.presetId : undefined,
        worldbookPresetId: typeof base.worldbookPresetId === 'string' ? base.worldbookPresetId : undefined,
        enableSummary: typeof base.enableSummary === 'boolean' ? base.enableSummary : undefined,
      } as MagicTeaPartySession['settings'];
    },
    [preferences]
  );

  const importSessionPayload = useCallback(
    async (payload: MagicTeaPartySessionExport, titleHint: string | null): Promise<string> => {
      const now = Date.now();
      const sessionId = randomUUID();
      const sessionCore = ensureRecord(payload.session) ?? {};
      const roles = ensureArray<MagicTeaPartyRole>(payload.roles).length > 0
        ? ensureArray<MagicTeaPartyRole>(payload.roles)
        : ensureArray<MagicTeaPartyRole>(sessionCore.roles);
      const scenario = payload.scenario ?? (sessionCore.scenario as MagicTeaPartyScenario | null) ?? null;
      const auxScenarios = ensureArray<MagicTeaPartyScenario>(payload.auxScenarios).length > 0
        ? ensureArray<MagicTeaPartyScenario>(payload.auxScenarios)
        : ensureArray<MagicTeaPartyScenario>(sessionCore.auxScenarios);
      const messages = ensureArray<MagicTeaPartyMessage>(payload.messages);
      const assets = ensureArray<MagicTeaPartyTachieAsset>(payload.tachieAssets);

      const messageIdMap = new Map<string, string>();
      const normalizedMessages = messages.map((message, index) => {
        const raw = ensureRecord(message) ?? {};
        const id = randomUUID();
        if (typeof raw.id === 'string') messageIdMap.set(raw.id, id);
        const createdAt =
          typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? (raw.createdAt as number) : now + index;
        const status = raw.status === 'blocked' || raw.status === 'error' ? raw.status : 'done';
        return {
          ...(raw as any),
          id,
          sessionId,
          createdAt,
          status,
        } as MagicTeaPartyMessage;
      });

      const normalizedMessagesFixed = normalizedMessages.map((message) => {
        const next = { ...(message as any) };
        if (typeof next.sourceMessageId === 'string' && messageIdMap.has(next.sourceMessageId)) {
          next.sourceMessageId = messageIdMap.get(next.sourceMessageId);
        }
        if (typeof next.revisionOf === 'string' && messageIdMap.has(next.revisionOf)) {
          next.revisionOf = messageIdMap.get(next.revisionOf);
        }
        return next as any;
      });

      const normalizedAssets = assets.map((asset) => {
        const raw = ensureRecord(asset) ?? {};
        const anchor = typeof raw.anchorMessageId === 'string' ? raw.anchorMessageId : undefined;
        const mappedAnchor = anchor && messageIdMap.has(anchor) ? messageIdMap.get(anchor) : undefined;
        return {
          ...(raw as any),
          id: randomUUID(),
          sessionId,
          anchorMessageId: mappedAnchor,
          createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
          lastUsedAt: typeof raw.lastUsedAt === 'number' ? raw.lastUsedAt : now,
        } as any;
      });

      const sessionTitle =
        readString(sessionCore.title) ||
        (titleHint ? titleHint.trim() : '') ||
        '导入会话';

      const session: MagicTeaPartySession = {
        id: sessionId,
        title: sessionTitle,
        titleMeta: { source: 'manual', generatedAt: now, reason: 'import' },
        createdAt: now,
        updatedAt: now,
        roles,
        scenario: scenario ?? undefined,
        auxScenarios,
        playerRoleId: typeof sessionCore.playerRoleId === 'string' ? sessionCore.playerRoleId : null,
        summary: typeof sessionCore.summary === 'string' ? sessionCore.summary : undefined,
        summaryMeta: ensureRecord(sessionCore.summaryMeta) as any,
        settings: buildSessionSettings(ensureRecord(sessionCore.settings)),
      };

      await putMagicTeaPartySession(session);
      await Promise.all(normalizedMessagesFixed.map((message) => putMagicTeaPartyMessage(message as any)));
      if (normalizedAssets.length > 0) {
        await Promise.all(normalizedAssets.map((asset) => putMagicTeaPartyTachieAsset(asset as any)));
      }

      return sessionId;
    },
    [buildSessionSettings]
  );

  const handleExportSession = useCallback(async () => {
    if (!activeSession) {
      setError('请先选择一个会话再导出。');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const messages = await listMagicTeaPartyMessages(activeSession.id);
      const tachieAssets = await listMagicTeaPartyTachieAssets(activeSession.id);
      const payload = buildMagicTeaPartySessionExport({
        session: activeSession,
        messages,
        tachieAssets,
        appVersion: 'unknown',
      });
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      downloadBlob(blob, buildSafeFileName(activeSession.title || 'magic-tea-party-session', 'json', 'magic-tea-party-session'));
      setNotice('会话已导出。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出失败');
    } finally {
      setBusy(false);
    }
  }, [activeSession]);

  const handleExportSessionJsonl = useCallback(async () => {
    if (!activeSession) {
      setError('请先选择一个会话再导出。');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const messages = await listMagicTeaPartyMessages(activeSession.id);
      const userDisplayName =
        activeSession.settings.userDisplayName || preferences.userDisplayName || '旅人';
      const playerRoleName = activeSession.playerRoleId
        ? (activeSession.roles ?? []).find((role) => role.id === activeSession.playerRoleId)?.name
        : undefined;
      const jsonl = stringifySillyTavernJsonl({
        messages,
        userDisplayName,
        playerRoleName,
        roleNameLookup,
      });
      const blob = new Blob([jsonl], { type: 'application/jsonl' });
      downloadBlob(
        blob,
        buildSafeFileName(`${activeSession.title || 'magic-tea-party'}_SillyTavern`, 'jsonl', 'magic-tea-party')
      );
      setNotice('SillyTavern JSONL 已导出。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出失败');
    } finally {
      setBusy(false);
    }
  }, [activeSession, preferences.userDisplayName, roleNameLookup]);

  const handleExportArchive = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const sessions = await listMagicTeaPartySessions({ limit: 9999 });
      const exports: MagicTeaPartySessionExport[] = [];
      for (const session of sessions) {
        const messages = await listMagicTeaPartyMessages(session.id);
        const assets = await listMagicTeaPartyTachieAssets(session.id);
        exports.push(
          buildMagicTeaPartySessionExport({
            session,
            messages,
            tachieAssets: assets,
            appVersion: 'unknown',
          })
        );
      }
      const archive: MagicTeaPartyArchiveExport = {
        schema: 'magic-tea-party.archive.v1',
        exportedAt: new Date().toISOString(),
        appVersion: 'unknown',
        sessions: exports,
      };
      const blob = new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json' });
      downloadBlob(blob, buildSafeFileName('magic-tea-party-archive', 'json', 'magic-tea-party-archive'));
      setNotice(`已导出 ${exports.length} 个会话。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出失败');
    } finally {
      setBusy(false);
    }
  }, []);

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      setBusy(true);
      setError(null);
      setNotice(null);

      try {
        const text = await file.text();
        const ext = file.name.toLowerCase();
        const baseTitle = getBaseTitle(file.name, '导入会话');
        const now = Date.now();

        if (ext.endsWith('.jsonl')) {
          const sessionId = randomUUID();
          const { messages, warnings } = parseSillyTavernJsonl({
            text,
            sessionId,
            createId: randomUUID,
            userDisplayName: preferences.userDisplayName,
            now,
          });
          const session: MagicTeaPartySession = {
            id: sessionId,
            title: baseTitle,
            titleMeta: { source: 'manual', generatedAt: now, reason: 'import' },
            createdAt: now,
            updatedAt: now,
            roles: [],
            scenario: undefined,
            auxScenarios: [],
            playerRoleId: null,
            settings: buildSessionSettings(null),
          };
          await putMagicTeaPartySession(session);
          await Promise.all(messages.map((message) => putMagicTeaPartyMessage(message)));
          setNotice(warnings.length > 0 ? `已导入 ${messages.length} 条消息（${warnings.length} 行已跳过）。` : `已导入 ${messages.length} 条消息。`);
          onSessionImported(sessionId);
          return;
        }

        const parsed = JSON.parse(text);
        const payload = ensureRecord(parsed);
        const schema = payload ? readString(payload.schema) : '';
        if (schema === 'magic-tea-party.session.v1' || schema === 'magic-tavern.session.v1') {
          const sessionId = await importSessionPayload(payload as MagicTeaPartySessionExport, baseTitle);
          setNotice('会话已导入。');
          onSessionImported(sessionId);
          return;
        }
        if (schema === 'magic-tea-party.archive.v1' || schema === 'magic-tavern.archive.v1') {
          const sessions = ensureArray<MagicTeaPartySessionExport>((payload as any).sessions);
          if (sessions.length === 0) throw new Error('归档中没有会话数据。');
          const importedIds: string[] = [];
          for (const sessionExport of sessions) {
            const sessionId = await importSessionPayload(sessionExport, null);
            importedIds.push(sessionId);
          }
          setNotice(`已导入 ${importedIds.length} 个会话。`);
          onSessionImported(importedIds[0]);
          return;
        }

        throw new Error('不支持的文件格式，请使用魔法茶会导出的 JSON 或 SillyTavern JSONL。');
      } catch (err) {
        setError(err instanceof Error ? err.message : '导入失败');
      } finally {
        setBusy(false);
        event.target.value = '';
      }
    },
    [buildSessionSettings, importSessionPayload, onSessionImported, preferences.userDisplayName]
  );

  return (
    <div className="rounded-xl border border-pink-100 bg-white p-4">
      <div className="text-sm font-semibold text-gray-800">导入 / 导出</div>
      <div className="mt-2 text-xs text-gray-500">支持魔法茶会 JSON 与 SillyTavern JSONL。</div>
      {error && (
        <div className="mt-3">
          <ErrorMessage message={error} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" />
        </div>
      )}
      {notice && <div className="mt-3 text-xs text-emerald-600">{notice}</div>}
      <div className="mt-4 grid gap-2">
        <button
          type="button"
          className="rounded-xl border border-pink-200 bg-white px-4 py-2 text-left text-sm font-semibold text-pink-700 hover:bg-pink-50 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
        >
          导入会话（JSON / JSONL）
        </button>
        <button
          type="button"
          className="rounded-xl border border-pink-200 bg-white px-4 py-2 text-left text-sm font-semibold text-pink-700 hover:bg-pink-50 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={handleExportSession}
          disabled={busy}
        >
          导出当前会话（JSON）
        </button>
        <button
          type="button"
          className="rounded-xl border border-pink-200 bg-white px-4 py-2 text-left text-sm font-semibold text-pink-700 hover:bg-pink-50 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={handleExportSessionJsonl}
          disabled={busy}
        >
          导出当前会话（SillyTavern JSONL）
        </button>
        <button
          type="button"
          className="rounded-xl border border-pink-200 bg-white px-4 py-2 text-left text-sm font-semibold text-pink-700 hover:bg-pink-50 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={handleExportArchive}
          disabled={busy}
        >
          导出全部会话（JSON）
        </button>
      </div>
      <input
        ref={fileInputRef}
        className="hidden"
        type="file"
        accept=".json,.jsonl,application/json"
        onChange={handleFileChange}
      />
    </div>
  );
}

const readString = (value: unknown): string => (typeof value === 'string' ? value : '').trim();
