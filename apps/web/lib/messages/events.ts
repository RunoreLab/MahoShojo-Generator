export const MESSAGES_UPDATED_EVENT = 'mahoshojo:messages-updated';

const canUseWindow = (): boolean => typeof window !== 'undefined';

export const dispatchMessagesUpdatedEvent = (): void => {
  if (!canUseWindow()) {
    return;
  }

  window.dispatchEvent(new CustomEvent(MESSAGES_UPDATED_EVENT));
};
