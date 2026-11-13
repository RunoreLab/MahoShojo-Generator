import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ONLINE_DATA_CARD_TYPES } from '@mahoshojo/contracts/data-cards';
import type { WebPackageRef } from '@mahoshojo/contracts/web-package';
import { ARENA_ROOM_PRESET_CATALOG } from '@mahoshojo/multiplayer-core/preset-catalog';
import { BUILTIN_WEB_PACKAGE_PRESETS, builtinWebPackageSource, packWebPackageZip } from '@mahoshojo/web-package';
import { scanWebPackageBase, type WebPackageRiskProfile } from '@mahoshojo/web-package/security';
import { CardLibraryModal, type CardLibraryHost, type CardLibrarySelectionContext } from '@mahoshojo/ui-web/card-library';
import type { ArenaMemberProposalHost, ArenaMemberReferenceRequest, ArenaMemberSourcePickerProps } from '@mahoshojo/ui-web/arena-room';
import { WebPackageRiskSummary } from '@mahoshojo/ui-web/arena-report';
import { buildSafeFileName } from '@mahoshojo/ui-web/client';
import { BaseModal } from '@mahoshojo/ui-web/modal';
import { DesktopCardLibraryLink, useDesktopCardLibraryHost } from '../../platform/card-library-host';
import { downloadBinaryFile } from '../../platform/download-text-file';
import { DesktopCardDetailsModal } from '../card-details/card-details-modal';
import {
  createDesktopMemberPublicLibraryHost, desktopMemberPresetHref, desktopMemberSelectionId,
  loadDesktopMemberReferenceDetails, readDesktopMemberPublicCard, readDesktopMemberRandomCharacter,
} from './room-member-source-data';

type LoadedPublicCard = Awaited<ReturnType<typeof readDesktopMemberPublicCard>>;
type SourceScope = { isCurrent(): boolean; host: CardLibraryHost; onRead(value: LoadedPublicCard): void };

export function DesktopArenaMemberPublicSourcePicker({ host, isCurrent, onRead, ...props }: ArenaMemberSourcePickerProps & SourceScope) {
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const automaticClose = useRef(false);
  useLayoutEffect(() => {
    setSourceError(null); setBusy(false);
    return () => { pending.current?.abort(); pending.current = null; automaticClose.current = false; };
  }, [props.open, props.kind, host, isCurrent]);
  const close = () => {
    // The shared single picker calls onClose synchronously after onSelectCard.
    // Keep it open for fresh validation; a subsequent user Close still cancels the read.
    if (automaticClose.current) { automaticClose.current = false; return; }
    pending.current?.abort(); pending.current = null; setBusy(false); props.onClose();
  };
  const choose = async (context: CardLibrarySelectionContext, selected?: boolean) => {
    if (!props.open || !isCurrent() || pending.current) return;
    const controller = new AbortController(); pending.current = controller;
    setBusy(true); setSourceError(null);
    try {
      const id = desktopMemberSelectionId(context);
      const loaded = await readDesktopMemberPublicCard(host.online, id, props.kind === 'auxScenario' ? 'scenario' : props.kind, controller.signal);
      if (controller.signal.aborted || !isCurrent() || pending.current !== controller) return;
      onRead(loaded);
      // Capture the workspace callback at dispatch; its owner/model/generation fence is authoritative.
      if (selected === undefined) props.onSelect(loaded.ref); else props.onToggle(loaded.ref, selected);
    } catch (cause) {
      if (!controller.signal.aborted && isCurrent()) setSourceError(cause instanceof Error ? cause.message : '在线数据卡选择失败');
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  };
  return <CardLibraryModal host={host} isOpen={props.open} onClose={close} visibleTabs={['public']} initialTab="public"
    selectedType={props.kind === 'character' ? 'character' : props.kind === 'material' ? 'all' : 'scenario'}
    allowedTypes={props.kind === 'material' ? [...ONLINE_DATA_CARD_TYPES] : [props.kind === 'character' ? 'character' : 'scenario']}
    titleOverride={props.kind === 'auxScenario' ? '选择辅助情景' : props.kind === 'material' ? '选择素材' : undefined}
    selectionMode={props.kind === 'scenario' ? 'single' : 'multi'} selectedCardIds={[...props.selectedIds]} selectedCountOverride={props.selectedIds.length}
    allowDeckImport={false} allowCardDetails={false}
    onSelectCard={props.kind === 'scenario' ? (_card, context) => { automaticClose.current = true; void choose(context); } : undefined}
    onToggleCard={props.kind !== 'scenario' ? (_card, selected, context) => { void choose(context, selected); } : undefined}
    externalError={sourceError ?? props.error ?? (busy ? '正在确认当前公开来源…' : null)} />;
}

function ReferenceDetails({ request, onClose, host, isCurrent }: { request: ArenaMemberReferenceRequest; onClose(): void } & Pick<SourceScope, 'host' | 'isCurrent'>) {
  const [loaded, setLoaded] = useState<Awaited<ReturnType<typeof loadDesktopMemberReferenceDetails>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoaded(null); setError(null);
    if (!isCurrent()) return () => controller.abort();
    void loadDesktopMemberReferenceDetails(request, host.online, controller.signal).then(result => {
      if (!controller.signal.aborted && isCurrent()) setLoaded(result);
    }).catch(cause => {
      if (!controller.signal.aborted && isCurrent()) setError(cause instanceof Error ? cause.message : '详情暂时无法读取');
    });
    return () => controller.abort();
  }, [request, host, isCurrent, retry]);
  if (!loaded) return <BaseModal isOpen onClose={onClose} title="房间引用详情" maxWidthClassName="max-w-md">
    {error ? <div role="alert"><p>{error}</p><button type="button" className="mt-3 rounded-lg border px-3 py-2" onClick={() => setRetry(value => value + 1)}>重试</button></div> : <p role="status">正在加载详情…</p>}
  </BaseModal>;
  return <DesktopCardDetailsModal isOpen onClose={onClose} {...loaded} />;
}

function BuiltinPackageRisk({ packageRef, isCurrent }: { packageRef: WebPackageRef; isCurrent(): boolean }) {
  const [profile, setProfile] = useState<WebPackageRiskProfile | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true; setProfile(null); setFailed(false);
    void builtinWebPackageSource.resolve(packageRef).then(base => {
      if (active && isCurrent()) setProfile(scanWebPackageBase(base));
    }).catch(() => { if (active && isCurrent()) setFailed(true); });
    return () => { active = false; };
  }, [packageRef, isCurrent]);
  return profile ? <WebPackageRiskSummary profile={profile} /> : <p role="status" className="text-xs text-gray-500">{failed ? '安全预检暂不可用，不能据此认为包内容安全。' : '正在检查内置包能力…'}</p>;
}

export async function downloadDesktopMemberBuiltinPackage(digest: string, isCurrent: () => boolean): Promise<void> {
  if (!isCurrent()) return;
  const preset = BUILTIN_WEB_PACKAGE_PRESETS.find(item => item.packageRef.digest === digest);
  if (!preset) throw new Error('多人提案仅支持内置 Web 包');
  const base = await builtinWebPackageSource.resolve(preset.packageRef);
  if (!isCurrent()) return;
  const archive = await packWebPackageZip(base);
  if (isCurrent()) downloadBinaryFile(buildSafeFileName(`${base.manifest.id}@${base.manifest.version}`, 'zip', 'mahoshojo-web-package'), archive, 'application/zip');
}

const nameKey = (request: Pick<ArenaMemberReferenceRequest, 'kind' | 'id'>) => JSON.stringify([request.kind, request.id]);
const rememberedConsent = (key: string) => { try { return localStorage.getItem(key) === 'accepted'; } catch { return false; } };

/** Desktop IO only. Editing, previews and operation lifecycles stay in the shared workspace/model. */
export function useDesktopArenaMemberSources({ scopeIdentity, isCurrent, roomId, languages, requests = [] }: {
  scopeIdentity: symbol | null; isCurrent(): boolean; roomId: string;
  languages: readonly { code: string; name: string }[]; requests?: readonly ArenaMemberReferenceRequest[];
}): ArenaMemberProposalHost {
  const library = useDesktopCardLibraryHost();
  const host = useMemo(() => createDesktopMemberPublicLibraryHost(library), [library]);
  const scope = useMemo(() => ({ scopeIdentity, isCurrent }), [scopeIdentity, isCurrent]);
  const currentScope = useRef<typeof scope | null>(scope);
  useLayoutEffect(() => { currentScope.current = scope; return () => { currentScope.current = null; }; }, [scope]);
  const current = useMemo(() => () => currentScope.current === scope && scope.scopeIdentity !== null && scope.isCurrent(), [scope]);
  const [names, setNames] = useState<{ scope: typeof scope; values: Record<string, string> }>({ scope, values: {} });
  const rememberName = useMemo(() => (value: LoadedPublicCard) => {
    if (current()) setNames(previous => ({ scope, values: { ...(previous.scope === scope ? previous.values : {}), [nameKey(value.ref)]: value.name } }));
  }, [scope, current]);
  // Stable identities only: token churn must not create an exact-version cache or read fence.
  const requestKey = JSON.stringify([...new Set(requests.filter(request => request.source === 'data-card').map(nameKey))].sort());
  useEffect(() => {
    const controller = new AbortController();
    if (!current()) return () => controller.abort();
    const identities = JSON.parse(requestKey) as string[];
    // A room is bounded, but keep public name hydration sequential rather than fan out every reference.
    void (async () => {
      for (const key of identities) {
        if (controller.signal.aborted || !current()) return;
        const [kind, id] = JSON.parse(key) as [ArenaMemberReferenceRequest['kind'], string];
        try { const result = await readDesktopMemberPublicCard(host.online, id, kind, controller.signal); if (!controller.signal.aborted) rememberName(result); }
        catch { /* Failed public reads retain the shared ID fallback; never hydrate from a local copy. */ }
      }
    })();
    return () => controller.abort();
  }, [requestKey, host, current, rememberName]);
  const slots = useMemo(() => ({
    SourcePicker: (props: ArenaMemberSourcePickerProps) => <DesktopArenaMemberPublicSourcePicker {...props} host={host} isCurrent={current} onRead={rememberName} />,
    ReferenceDetails: ({ request, onClose }: { request: ArenaMemberReferenceRequest | null; onClose(): void }) => request
      ? <ReferenceDetails key={JSON.stringify(request)} request={request} onClose={onClose} host={host} isCurrent={current} /> : null,
  }), [host, current, rememberName]);
  const consentKey = `mahoshojo.desktop.arena.web-consent.room.${roomId}`;
  const [acceptedScope, setAcceptedScope] = useState<typeof scope | null>(null);
  return {
    ...slots,
    randomPublicCharacter: async () => {
      if (!current()) throw new Error('房间来源作用域已改变');
      const result = await readDesktopMemberRandomCharacter((command, args) => invoke(command, args as never), host.online, new AbortController().signal, current);
      if (!current()) throw new Error('房间来源作用域已改变');
      rememberName(result); return result.ref;
    },
    resolveReferenceName: request => request.source === 'preset'
      ? ARENA_ROOM_PRESET_CATALOG.find(item => item.kind === request.kind && item.id === request.id)?.displayName
      : names.scope === scope ? names.values[nameKey(request)] : undefined,
    languages: [...languages], languageLabel: code => languages.find(language => language.code === code)?.name,
    enableUserGuidance: true, createId: () => crypto.randomUUID(), presetDownloadHref: desktopMemberPresetHref,
    downloadBuiltinWebPackage: digest => downloadDesktopMemberBuiltinPackage(digest, current),
    webPackageViewHost: {
      renderRisk: ref => <BuiltinPackageRisk packageRef={ref} isCurrent={current} />,
      renderHelpLink: label => <DesktopCardLibraryLink href="/encyclopedia/web-report" className="ml-1 underline">{label}</DesktopCardLibraryLink>,
    },
    webConsent: { accepted: acceptedScope === scope || rememberedConsent(consentKey), onAccept: remember => {
      if (!current()) return;
      setAcceptedScope(scope);
      if (remember) { try { localStorage.setItem(consentKey, 'accepted'); } catch { /* This page's acknowledgement remains valid. */ } }
    } },
  };
}
