export const ME_PROFILE_AVATAR_UPDATED_EVENT = 'mahoshojo:me-profile-avatar-updated';

export type MeProfileAvatarUpdatedDetail = {
  userId: number;
  avatarDataUrl: string | null;
};

export function dispatchMeProfileAvatarUpdated(detail: MeProfileAvatarUpdatedDetail) {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent<MeProfileAvatarUpdatedDetail>(ME_PROFILE_AVATAR_UPDATED_EVENT, { detail }));
}
