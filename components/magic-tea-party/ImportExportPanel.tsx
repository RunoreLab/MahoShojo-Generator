import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { zipSync } from 'fflate';

import { ErrorMessage } from '@/components/ErrorMessage';
import { downloadBlob } from '@/lib/client/blobUrl';
import { buildSafeFileName } from '@/lib/client/fileName';
import { randomUUID } from '@/lib/crypto';
import {
  getMagicTeaPartyTachieBlob,
  getMagicTeaPartySession,
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
  MagicTeaPartyUpdateDraft,
  MagicTeaPartyUpdateSnapshot,
} from '@/lib/magic-tea-party/types';
import {
  buildMagicTeaPartySessionExport,
  buildMagicTeaPartyArchiveZipEntries,
  parseSillyTavernJsonl,
  stringifySillyTavernJsonl,
  type MagicTeaPartyArchiveExport,
  type MagicTeaPartySessionExport,
} from '@/lib/magic-tea-party/transfer';
import {
  checkMagicTeaPartySensitiveText,
  maskMagicTeaPartyJsonValue,
  maskMagicTeaPartyText,
} from '@/lib/magic-tea-party/import-safety';

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
  const router = useRouter();
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
      const outputPlanRaw = base.outputPlan && typeof base.outputPlan === 'object' ? (base.outputPlan as Record<string, unknown>) : null;
      const normalizePlanValue = (value: unknown, fallback: 'off' | 'auto' | 'on') =>
        value === 'off' || value === 'on' || value === 'auto' ? (value as 'off' | 'auto' | 'on') : fallback;
      const outputPlan = outputPlanRaw
        ? {
            choices: normalizePlanValue(outputPlanRaw.choices, defaults.outputPlan.choices),
            summary: normalizePlanValue(outputPlanRaw.summary, defaults.outputPlan.summary),
            updates: normalizePlanValue(outputPlanRaw.updates, defaults.outputPlan.updates),
          }
        : defaults.outputPlan;
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
        outputPlan,
        updateApplyMode:
          base.updateApplyMode === 'confirm' || base.updateApplyMode === 'draft'
            ? base.updateApplyMode
            : defaults.updateApplyMode,
        language: base.language === 'en-US' || base.language === 'ja-JP' ? base.language : defaults.language,
        userDisplayName: typeof base.userDisplayName === 'string' ? base.userDisplayName : defaults.userDisplayName,
        presetId: typeof base.presetId === 'string' ? base.presetId : undefined,
        worldbookPresetId: typeof base.worldbookPresetId === 'string' ? base.worldbookPresetId : undefined,
        enableSummary: typeof base.enableSummary === 'boolean' ? base.enableSummary : defaults.enableSummary,
        readArenaHistory: typeof base.readArenaHistory === 'boolean' ? base.readArenaHistory : defaults.readArenaHistory,
        readArenaHistoryLimit: typeof base.readArenaHistoryLimit === 'number' ? base.readArenaHistoryLimit : defaults.readArenaHistoryLimit,
        isArenaHistoryUnlimited:
          typeof base.isArenaHistoryUnlimited === 'boolean' ? base.isArenaHistoryUnlimited : defaults.isArenaHistoryUnlimited,
        readCurrentState: typeof base.readCurrentState === 'boolean' ? base.readCurrentState : defaults.readCurrentState,
        writeArenaHistory: typeof base.writeArenaHistory === 'boolean' ? base.writeArenaHistory : defaults.writeArenaHistory,
        writeCurrentState: typeof base.writeCurrentState === 'boolean' ? base.writeCurrentState : defaults.writeCurrentState,
      } as MagicTeaPartySession['settings'];
    },
    [preferences]
  );

  const maskOptionalText = useCallback((value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    return maskMagicTeaPartyText(value).value;
  }, []);

  const sanitizeMessage = useCallback(
    (message: MagicTeaPartyMessage): MagicTeaPartyMessage => {
      const next: MagicTeaPartyMessage = { ...message };
      if (typeof next.content === 'string') {
        next.content = maskMagicTeaPartyText(next.content).value;
      }
      if (Array.isArray(next.segments)) {
        next.segments = next.segments.map((seg) => {
          if (seg.type === 'narration') {
            return { ...seg, text: maskMagicTeaPartyText(seg.text).value };
          }
          if (seg.type === 'dialogue') {
            return {
              ...seg,
              speakerName: seg.speakerName ? maskMagicTeaPartyText(seg.speakerName).value : seg.speakerName,
              text: maskMagicTeaPartyText(seg.text).value,
            };
          }
          if (seg.type === 'choices') {
            const items = seg.items?.map((item) => ({
              ...item,
              text: maskMagicTeaPartyText(item.text).value,
            }));
            return { ...seg, items: items ?? seg.items };
          }
          return seg;
        });
      }
      if (Array.isArray(next.choices)) {
        next.choices = next.choices.map((item) => ({
          ...item,
          text: maskMagicTeaPartyText(item.text).value,
        }));
      }
      if (next.meta && typeof next.meta === 'object') {
        const meta = { ...(next.meta as Record<string, unknown>) };
        if (typeof meta.speakerName === 'string') {
          meta.speakerName = maskMagicTeaPartyText(meta.speakerName).value;
        }
        next.meta = meta;
      }
      return next;
    },
    []
  );

  const sanitizeRole = useCallback(
    (role: MagicTeaPartyRole): MagicTeaPartyRole => {
      const maskedName = maskOptionalText(role.name) ?? role.name;
      const maskedNotes = maskOptionalText(role.notes);
      const maskedCard = maskMagicTeaPartyJsonValue(role.card ?? {}).value as Record<string, unknown>;
      return {
        ...role,
        name: maskedName,
        ...(typeof maskedNotes === 'string' ? { notes: maskedNotes } : {}),
        card: maskedCard,
      };
    },
    [maskOptionalText]
  );

  const sanitizeScenario = useCallback(
    (scenario: MagicTeaPartyScenario): MagicTeaPartyScenario => {
      const maskedTitle = maskOptionalText(scenario.title) ?? scenario.title;
      const maskedNotes = maskOptionalText(scenario.notes);
      const maskedCard = maskMagicTeaPartyJsonValue(scenario.card ?? {}).value as Record<string, unknown>;
      return {
        ...scenario,
        title: maskedTitle,
        ...(typeof maskedNotes === 'string' ? { notes: maskedNotes } : {}),
        card: maskedCard,
      };
    },
    [maskOptionalText]
  );

  const maskTextValue = useCallback((value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const masked = maskMagicTeaPartyText(value).value;
    return masked.trim() ? masked : undefined;
  }, []);

  const sanitizeSummarySections = useCallback(
    (value: unknown): Record<string, string> | undefined => {
      const record = ensureRecord(value);
      if (!record) return undefined;
      const next: Record<string, string> = {};
      for (const [key, section] of Object.entries(record)) {
        const masked = maskTextValue(section);
        if (masked) next[key] = masked;
      }
      return Object.keys(next).length > 0 ? next : undefined;
    },
    [maskTextValue]
  );

  const sanitizeUpdateDrafts = useCallback(
    (value: unknown): MagicTeaPartyUpdateDraft[] | undefined => {
      if (!Array.isArray(value)) return undefined;
      const drafts = value
        .map((item) => {
          const record = ensureRecord(item);
          if (!record) return null;
          const characterNameRaw =
            readString(record.characterName) || readString(record.character) || readString(record.name);
          const characterName = maskTextValue(characterNameRaw) ?? characterNameRaw;
          if (!characterName) return null;
          const impact = maskTextValue(record.impact);
          const currentStateSummary = maskTextValue(record.currentStateSummary ?? record.current_state_summary);
          const winner = maskTextValue(record.winner);
          const roleId = typeof record.roleId === 'string' ? record.roleId : undefined;
          const hasWinner = typeof record.hasWinner === 'boolean' ? record.hasWinner : undefined;
          const meta = ensureRecord(record.meta) ?? undefined;
          return {
            ...(roleId ? { roleId } : {}),
            characterName,
            ...(impact ? { impact } : {}),
            ...(currentStateSummary ? { currentStateSummary } : {}),
            ...(typeof hasWinner === 'boolean' ? { hasWinner } : {}),
            ...(winner ? { winner } : {}),
            ...(meta ? { meta } : {}),
          } as MagicTeaPartyUpdateDraft;
        })
        .filter((item): item is MagicTeaPartyUpdateDraft => Boolean(item));
      return drafts.length > 0 ? drafts : undefined;
    },
    [maskTextValue]
  );

  const importSessionPayload = useCallback(
    async (
      payload: MagicTeaPartySessionExport,
      titleHint: string | null,
      options?: { sessionId?: string }
    ): Promise<{
      sessionId: string;
      originalSessionId: string | null;
      messageIdMap: Map<string, string>;
      forkedFromRaw: MagicTeaPartySession['forkedFrom'] | null;
      session: MagicTeaPartySession;
    }> => {
      const now = Date.now();
      const sessionId = options?.sessionId ?? randomUUID();
      const sessionCore = ensureRecord(payload.session) ?? {};
      const originalSessionId = typeof sessionCore.id === 'string' ? sessionCore.id : null;
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
      const messageIndexMap = new Map<string, number>();
      normalizedMessagesFixed.forEach((message, index) => {
        messageIndexMap.set(message.id, index);
      });

      const mapMessageRange = (value: unknown): { fromMessageId: string; toMessageId: string; count: number } | undefined => {
        const record = ensureRecord(value);
        if (!record) return undefined;
        const fromRaw = typeof record.fromMessageId === 'string' ? record.fromMessageId : '';
        const toRaw = typeof record.toMessageId === 'string' ? record.toMessageId : '';
        const mappedFrom = fromRaw ? messageIdMap.get(fromRaw) : undefined;
        const mappedTo = toRaw ? messageIdMap.get(toRaw) : undefined;
        if (!mappedFrom || !mappedTo) return undefined;
        let count = typeof record.count === 'number' && Number.isFinite(record.count) ? record.count : undefined;
        if (typeof count !== 'number') {
          const fromIndex = messageIndexMap.get(mappedFrom);
          const toIndex = messageIndexMap.get(mappedTo);
          if (typeof fromIndex === 'number' && typeof toIndex === 'number' && toIndex >= fromIndex) {
            count = toIndex - fromIndex + 1;
          } else {
            count = 0;
          }
        }
        return { fromMessageId: mappedFrom, toMessageId: mappedTo, count };
      };

      const summaryMetaRaw = ensureRecord(sessionCore.summaryMeta);
      const summaryMeta = summaryMetaRaw
        ? {
            updatedAt: typeof summaryMetaRaw.updatedAt === 'number' ? summaryMetaRaw.updatedAt : now,
            ...(typeof summaryMetaRaw.tokenCount === 'number' ? { tokenCount: summaryMetaRaw.tokenCount } : {}),
            ...(typeof summaryMetaRaw.fromMessageId === 'string' && messageIdMap.has(summaryMetaRaw.fromMessageId)
              ? { fromMessageId: messageIdMap.get(summaryMetaRaw.fromMessageId) as string }
              : {}),
            ...(typeof summaryMetaRaw.toMessageId === 'string' && messageIdMap.has(summaryMetaRaw.toMessageId)
              ? { toMessageId: messageIdMap.get(summaryMetaRaw.toMessageId) as string }
              : {}),
          }
        : undefined;

      const protocolShadowRaw = ensureRecord(sessionCore.protocolShadow);
      const protocolShadowDrafts = sanitizeUpdateDrafts(protocolShadowRaw?.drafts);
      const protocolShadowRange = mapMessageRange(protocolShadowRaw?.messageRange);
      const protocolShadowSource =
        protocolShadowRaw?.source === 'manual' || protocolShadowRaw?.source === 'stream'
          ? (protocolShadowRaw.source as 'manual' | 'stream')
          : undefined;
      const protocolShadow =
        protocolShadowRaw && protocolShadowDrafts && protocolShadowDrafts.length > 0
          ? {
              updatedAt: typeof protocolShadowRaw.updatedAt === 'number' ? protocolShadowRaw.updatedAt : now,
              ...(protocolShadowRange ? { messageRange: protocolShadowRange } : {}),
              drafts: protocolShadowDrafts,
              ...(protocolShadowSource ? { source: protocolShadowSource } : {}),
            }
          : undefined;

      const updateSnapshotRaw = ensureRecord(sessionCore.updateSnapshot);
      const updateSnapshotRange = mapMessageRange(updateSnapshotRaw?.messageRange);
      const updateSnapshotDrafts = sanitizeUpdateDrafts(updateSnapshotRaw?.drafts) ?? [];
      const updateSnapshotRolesBefore = Array.isArray(updateSnapshotRaw?.rolesBefore)
        ? updateSnapshotRaw?.rolesBefore.map((role: MagicTeaPartyRole) => sanitizeRole(role))
        : [];
      const updateSnapshotRolesAfter = Array.isArray(updateSnapshotRaw?.rolesAfter)
        ? updateSnapshotRaw?.rolesAfter.map((role: MagicTeaPartyRole) => sanitizeRole(role))
        : [];
      const updateSnapshot: MagicTeaPartyUpdateSnapshot | undefined = updateSnapshotRaw
        ? {
            id: typeof updateSnapshotRaw.id === 'string' ? updateSnapshotRaw.id : randomUUID(),
            createdAt: typeof updateSnapshotRaw.createdAt === 'number' ? updateSnapshotRaw.createdAt : now,
            mode: updateSnapshotRaw.mode === 'confirm' ? 'confirm' : 'auto',
            ...(updateSnapshotRange ? { messageRange: updateSnapshotRange } : {}),
            drafts: updateSnapshotDrafts,
            rolesBefore: updateSnapshotRolesBefore,
            rolesAfter: updateSnapshotRolesAfter,
            ...(typeof updateSnapshotRaw.revertedAt === 'number' ? { revertedAt: updateSnapshotRaw.revertedAt } : {}),
          }
        : undefined;

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
        maskOptionalText(sessionCore.title) ||
        (titleHint ? titleHint.trim() : '') ||
        '导入会话';

      const forkedFromRaw = ensureRecord(sessionCore.forkedFrom);
      const forkedFromOriginal =
        forkedFromRaw && typeof forkedFromRaw.sessionId === 'string' && typeof forkedFromRaw.messageId === 'string'
          ? {
              sessionId: forkedFromRaw.sessionId,
              messageId: forkedFromRaw.messageId,
              createdAt: typeof forkedFromRaw.createdAt === 'number' ? forkedFromRaw.createdAt : now,
            }
          : null;
      const forkedFrom = forkedFromOriginal
        ? {
            ...forkedFromOriginal,
            messageId: messageIdMap.get(forkedFromOriginal.messageId) ?? forkedFromOriginal.messageId,
          }
        : undefined;

      const session: MagicTeaPartySession = {
        id: sessionId,
        title: sessionTitle,
        titleMeta: { source: 'manual', generatedAt: now, reason: 'import' },
        createdAt: now,
        updatedAt: now,
        roles: roles.map(sanitizeRole),
        scenario: scenario ? sanitizeScenario(scenario) : undefined,
        auxScenarios: auxScenarios.map(sanitizeScenario),
        playerRoleId: typeof sessionCore.playerRoleId === 'string' ? sessionCore.playerRoleId : null,
        summary: typeof sessionCore.summary === 'string' ? maskMagicTeaPartyText(sessionCore.summary).value : undefined,
        summarySections: sanitizeSummarySections(sessionCore.summarySections),
        summaryMeta,
        protocolShadow,
        updateSnapshot,
        lastChoices: Array.isArray(sessionCore.lastChoices)
          ? (sessionCore.lastChoices as { id: string; text: string }[]).map((choice) => ({
              id: choice.id,
              text: maskMagicTeaPartyText(choice.text).value,
            }))
          : undefined,
        branchLabel: typeof sessionCore.branchLabel === 'string' ? sessionCore.branchLabel : undefined,
        forkedFrom,
        draft: typeof sessionCore.draft === 'string' ? maskMagicTeaPartyText(sessionCore.draft).value : undefined,
        settings: buildSessionSettings(ensureRecord(sessionCore.settings)),
      };

      await putMagicTeaPartySession(session);
      const sanitizedMessages = normalizedMessagesFixed.map((message) => sanitizeMessage(message as MagicTeaPartyMessage));
      await Promise.all(sanitizedMessages.map((message) => putMagicTeaPartyMessage(message as any)));
      if (normalizedAssets.length > 0) {
        await Promise.all(normalizedAssets.map((asset) => putMagicTeaPartyTachieAsset(asset as any)));
      }

      return { sessionId, originalSessionId, messageIdMap, forkedFromRaw: forkedFromOriginal, session };
    },
    [
      buildSessionSettings,
      maskOptionalText,
      sanitizeMessage,
      sanitizeRole,
      sanitizeScenario,
      sanitizeSummarySections,
      sanitizeUpdateDrafts,
    ]
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

  const handleExportArchiveZip = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const sessions = await listMagicTeaPartySessions({ limit: 9999 });
      const exports: MagicTeaPartySessionExport[] = [];
      const tachieBlobs: Record<string, Blob | null> = {};

      for (const session of sessions) {
        const messages = await listMagicTeaPartyMessages(session.id);
        const assets = await listMagicTeaPartyTachieAssets(session.id);
        const sessionExport = buildMagicTeaPartySessionExport({
          session,
          messages,
          tachieAssets: assets,
          appVersion: 'unknown',
        });
        exports.push(sessionExport);
        for (const asset of assets) {
          if (tachieBlobs[asset.id] !== undefined) continue;
          tachieBlobs[asset.id] = await getMagicTeaPartyTachieBlob(asset.id);
        }
      }

      const exportedAt = new Date().toISOString();
      const { entries, stats } = await buildMagicTeaPartyArchiveZipEntries({
        sessions: exports,
        tachieBlobs,
        exportedAt,
        appVersion: 'unknown',
      });

      const zipped = zipSync(entries, { level: 6 });
      const zipData = new Uint8Array(zipped);
      const blob = new Blob([zipData], { type: 'application/zip' });
      downloadBlob(blob, buildSafeFileName('magic-tea-party-archive', 'zip', 'magic-tea-party-archive'));
      setNotice(
        stats.missingCount > 0
          ? `已导出 ${stats.sessionCount} 个会话，包含 ${stats.blobCount} 个图片资源（${stats.missingCount} 个图片缺失）。`
          : `已导出 ${stats.sessionCount} 个会话，包含 ${stats.blobCount} 个图片资源。`
      );
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
        const guard = await checkMagicTeaPartySensitiveText({
          text,
          reason: '使用危险符文',
          origin: '/magic-tea-party',
          label: '魔法茶会导入会话',
          filename: file.name,
          mimeType: file.type || 'application/json',
        });
        if (guard.blocked) {
          if (guard.redirectTarget) {
            await router.push(guard.redirectTarget);
          }
          return;
        }
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
          const sanitizedMessages = messages.map(sanitizeMessage);
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
          await Promise.all(sanitizedMessages.map((message) => putMagicTeaPartyMessage(message)));
          setNotice(warnings.length > 0 ? `已导入 ${sanitizedMessages.length} 条消息（${warnings.length} 行已跳过）。` : `已导入 ${sanitizedMessages.length} 条消息。`);
          onSessionImported(sessionId);
          return;
        }

        const parsed = JSON.parse(text);
        const payload = ensureRecord(parsed);
        const schema = payload ? readString(payload.schema) : '';
        if (schema === 'magic-tea-party.session.v1' || schema === 'magic-tavern.session.v1') {
          const { sessionId } = await importSessionPayload(payload as MagicTeaPartySessionExport, baseTitle);
          setNotice('会话已导入。');
          onSessionImported(sessionId);
          return;
        }
        if (schema === 'magic-tea-party.archive.v1' || schema === 'magic-tavern.archive.v1') {
          const sessions = ensureArray<MagicTeaPartySessionExport>((payload as any).sessions);
          if (sessions.length === 0) throw new Error('归档中没有会话数据。');
          const sessionIdMap = new Map<string, string>();
          for (const sessionExport of sessions) {
            const sessionCore = ensureRecord(sessionExport.session);
            if (sessionCore && typeof sessionCore.id === 'string') {
              sessionIdMap.set(sessionCore.id, randomUUID());
            }
          }
          const importResults: Array<{
            sessionId: string;
            originalSessionId: string | null;
            messageIdMap: Map<string, string>;
            forkedFromRaw: MagicTeaPartySession['forkedFrom'] | null;
          }> = [];
          for (const sessionExport of sessions) {
            const sessionCore = ensureRecord(sessionExport.session);
            const originalId = sessionCore && typeof sessionCore.id === 'string' ? sessionCore.id : null;
            const mappedId = originalId && sessionIdMap.has(originalId) ? sessionIdMap.get(originalId) : undefined;
            const result = await importSessionPayload(sessionExport, null, mappedId ? { sessionId: mappedId } : undefined);
            importResults.push({
              sessionId: result.sessionId,
              originalSessionId: result.originalSessionId,
              messageIdMap: result.messageIdMap,
              forkedFromRaw: result.forkedFromRaw,
            });
          }
          const messageMaps = new Map<string, Map<string, string>>();
          importResults.forEach((result) => {
            if (result.originalSessionId) messageMaps.set(result.originalSessionId, result.messageIdMap);
          });
          for (const result of importResults) {
            const forked = result.forkedFromRaw;
            if (!forked || !result.originalSessionId) continue;
            const mappedParentId = sessionIdMap.get(forked.sessionId);
            const parentMessageMap = messageMaps.get(forked.sessionId);
            const mappedMessageId = parentMessageMap?.get(forked.messageId);
            if (!mappedParentId || !mappedMessageId) continue;
            const session = await getMagicTeaPartySession(result.sessionId);
            if (!session) continue;
            await putMagicTeaPartySession({
              ...session,
              forkedFrom: {
                sessionId: mappedParentId,
                messageId: mappedMessageId,
                createdAt: forked.createdAt,
              },
              updatedAt: Date.now(),
            });
          }
          const importedIds = importResults.map((item) => item.sessionId);
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
    [buildSessionSettings, importSessionPayload, onSessionImported, preferences.userDisplayName, router, sanitizeMessage]
  );

  return (
    <div className="rounded-xl border border-pink-100 bg-white p-4">
      <div className="text-sm font-semibold text-gray-800">导入 / 导出</div>
      <div className="mt-2 text-xs text-gray-500">支持魔法茶会 JSON 与 SillyTavern JSONL。ZIP 导出会包含本地图片资源。</div>
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
        <button
          type="button"
          className="rounded-xl border border-pink-200 bg-white px-4 py-2 text-left text-sm font-semibold text-pink-700 hover:bg-pink-50 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={handleExportArchiveZip}
          disabled={busy}
        >
          导出全部会话（ZIP，含图片）
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
