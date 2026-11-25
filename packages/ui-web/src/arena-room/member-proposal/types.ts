import type { ComponentType, MouseEventHandler } from 'react';
import type { ArenaRoomSessionResponse, DataCardRef } from '@mahoshojo/contracts/arena-room';
import type { ArenaMemberProposalModel, ArenaMemberProposalSourceKind } from '@mahoshojo/multiplayer-core/member-proposal';
import type { LanguageOption } from '../../arena/StoryOptionsPanel';

export type ArenaMemberReferenceRequest = Readonly<{ source: 'data-card' | 'preset'; kind: DataCardRef['kind']; id: string; versionToken?: string }>;
export type ArenaMemberReferenceView = Readonly<{ id: string; versionToken: string }>;
export type ArenaMemberScenarioView = Readonly<{ key: string; name: string; source: 'data-card' | 'preset' | 'host-local'; access: 'reference' | 'stub'; reference: ArenaMemberReferenceView | null }>;
export type ArenaMemberMaterialView = ArenaMemberScenarioView;
export type ArenaMemberCombatantView = ArenaMemberScenarioView & Readonly<{ type: 'magical-girl' | 'canshou' | 'general-character' | null; characterGuidance: string; teamKey: string | null }>;
export type ArenaMemberTeamView = Readonly<{ key: string; name: string; combatantKeys: readonly string[] }>;
export type ArenaMemberSourcePickerProps = Readonly<{
  open: boolean; kind: ArenaMemberProposalSourceKind; selectedIds: readonly string[]; error: string | null;
  onClose(): void; onSelect(ref: DataCardRef): void; onToggle(ref: DataCardRef, selected: boolean): void;
}>;
export type ArenaMemberProposalRoom = Readonly<{
  session: ArenaRoomSessionResponse | null;
  operation: 'submit' | 'withdraw' | 'resolve' | null;
  resultUnknown: boolean;
  /** Host transport/capability gate. Omitted by hosts without a separate freshness contract. */
  blockedReason?: string | null;
  tracking?: Readonly<{ id: string; phase: 'unknown' | 'ended-needs-read' }> | null;
  outcome?: string | null;
}>;
export type ArenaMemberProposalHost = Readonly<{
  SourcePicker: ComponentType<ArenaMemberSourcePickerProps>;
  ReferenceDetails: ComponentType<{ request: ArenaMemberReferenceRequest | null; onClose(): void }>;
  randomPublicCharacter(): Promise<DataCardRef>;
  resolveReferenceName(request: ArenaMemberReferenceRequest): string | undefined;
  languages?: LanguageOption[];
  languageLabel?(value: string): string | undefined;
  enableUserGuidance: boolean;
  createId(): string;
  presetDownloadHref(kind: 'character' | 'scenario', id: string): string;
  onCharacterPresetDownloadLinkClick?: MouseEventHandler<HTMLAnchorElement>;
  downloadBuiltinWebPackage(digest: string): Promise<void>;
  webPackageViewHost?: import('../../arena/features/web-package/web-package-host').ArenaWebPackageViewHost;
  webConsent: Readonly<{ accepted: boolean; onAccept(remember: boolean): void }>;
}>;
export type ArenaMemberProposalWorkspaceActions = Readonly<{
  submit(intent: NonNullable<ReturnType<ArenaMemberProposalModel['preparePreview']>['intent']>): Promise<void>;
  withdraw(id: string): Promise<void>;
  read(): void | Promise<void>;
  endTracking(id: string): void | Promise<void>;
  sync?(): void;
}>;
export type RoomMemberProposalWorkspaceProps = Readonly<{
  model: ArenaMemberProposalModel;
  scopeIdentity: unknown;
  room: ArenaMemberProposalRoom;
  host: ArenaMemberProposalHost;
  actions: ArenaMemberProposalWorkspaceActions;
}>;
