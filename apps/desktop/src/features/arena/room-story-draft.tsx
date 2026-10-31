import { useEffect, useRef, useSyncExternalStore } from 'react';
import { StoryOptionsPanel, type LanguageOption, type StoryLengthOption } from '@mahoshojo/ui-web/arena';
import type { DesktopArenaSession } from './session';
import type { DesktopArenaRoomSession } from './room-session';

/** Only four local scalar fields; authority, imports, execution and library writes stay outside this editor. */
export function DesktopRoomStoryDraft({ roomOwner, localSession, languages, isEditingAllowed }: {
  roomOwner: DesktopArenaRoomSession;
  localSession: DesktopArenaSession;
  languages: LanguageOption[];
  isEditingAllowed: () => boolean;
}) {
  const room = useSyncExternalStore(roomOwner.subscribe, roomOwner.getSnapshot);
  const local = useSyncExternalStore(localSession.subscribe, localSession.getSnapshot);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const identity = roomOwner.confirmationOwner();
  const authority = room.session;
  const canEdit = () => {
    const current = roomOwner.getSnapshot();
    return mounted.current && identity !== null && roomOwner.confirmationOwner() === identity
      && current.session === authority && authority?.self.role === 'host' && authority.self.membershipState === 'active'
      && current.phase === 'online' && current.snapshotReceived && !current.busy && !current.unknown && !current.configTracking
      && !localSession.isBusy() && !localSession.getSnapshot().pendingRestore && isEditingAllowed();
  };
  if (!authority || authority.self.role !== 'host' || authority.self.membershipState !== 'active') return null;
  const change = (field: 'userGuidance' | 'storyLength' | 'customStoryLength' | 'selectedLanguage', value: string) => {
    if (!canEdit()) return;
    // Consecutive callbacks (custom length -> preset) merge against the latest draft.
    const draft = localSession.getSnapshot().draft;
    if (field === 'userGuidance') localSession.updateDraft({ ...draft, settings: { ...draft.settings, userGuidance: value } });
    else if (field === 'storyLength') localSession.updateDraft({ ...draft, storyLength: value as StoryLengthOption });
    else if (field === 'customStoryLength') localSession.updateDraft({ ...draft, customStoryLength: value });
    else localSession.updateDraft({ ...draft, selectedLanguage: value });
  };
  return <section aria-label="房主本地故事设置" className="mt-4 space-y-3">
    <h3 className="font-semibold">房主本地故事设置</h3>
    <p>这里只修改本机草稿，并尝试自动保存，不更新房间。修改后需重新比较，再明确确认发布；角色与情景可在下方编辑；模型与普通生成仍保持锁定。</p>
    {local.draftError ? <p role="alert">{local.draftError}</p> : null}
    <StoryOptionsPanel idPrefix="room-host-draft" isGenerating={!canEdit()} enableUserGuidance languages={languages}
      userGuidance={local.draft.settings.userGuidance} onUserGuidanceChange={value => change('userGuidance', value)}
      storyLength={local.draft.storyLength as StoryLengthOption} onStoryLengthChange={value => change('storyLength', value)}
      customStoryLength={local.draft.customStoryLength} onCustomStoryLengthChange={value => change('customStoryLength', value)}
      selectedLanguage={local.draft.selectedLanguage} onSelectedLanguageChange={value => change('selectedLanguage', value)} />
  </section>;
}
