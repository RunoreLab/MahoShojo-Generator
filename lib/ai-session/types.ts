export type AiSessionProviderMode = 'system' | 'custom';

export type AiSessionCursorDirection = 'next' | 'prev';

export type AiSessionListOptions = {
  limit?: number;
  direction?: AiSessionCursorDirection;
};

export const AI_SESSION_DB_NAME = 'ai-continuous-dialogue:v1';
export const AI_SESSION_DB_VERSION = 2;

export const AI_SESSION_STORE_NAMES = {
  battleStorySessions: 'battleStorySessions',
  battleStoryChapters: 'battleStoryChapters',
  battleStoryCheckpoints: 'battleStoryCheckpoints',
  cardEditSessions: 'cardEditSessions',
  cardEditCheckpoints: 'cardEditCheckpoints',
} as const;

export type AiSessionStoreName = (typeof AI_SESSION_STORE_NAMES)[keyof typeof AI_SESSION_STORE_NAMES];
