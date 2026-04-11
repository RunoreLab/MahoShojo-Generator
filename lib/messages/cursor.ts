import type { MessageScope, MessageSortKey } from '@/lib/messages/types';

export class InvalidMessageCursorError extends Error {
  constructor(message = '消息分页游标无效') {
    super(message);
    this.name = 'InvalidMessageCursorError';
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const scopeRank: Record<MessageScope, number> = {
  site: 1,
  user: 2,
};

const encodeBase64Url = (value: string): string => {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value, 'utf8').toString('base64url');
  }

  return btoa(String.fromCharCode(...encoder.encode(value)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
};

const decodeBase64Url = (value: string): string => {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value, 'base64url').toString('utf8');
  }

  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return decoder.decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
};

const isMessageScope = (value: unknown): value is MessageScope => value === 'site' || value === 'user';

const parseCursorPayload = (value: unknown): MessageSortKey => {
  if (typeof value !== 'object' || value === null) {
    throw new InvalidMessageCursorError();
  }

  const payload = value as Partial<MessageSortKey>;
  const numericId = payload.numericId;
  if (
    typeof payload.createdAt !== 'string' ||
    !isMessageScope(payload.scope) ||
    typeof numericId !== 'number' ||
    !Number.isInteger(numericId)
  ) {
    throw new InvalidMessageCursorError();
  }

  return {
    createdAt: payload.createdAt,
    scope: payload.scope,
    numericId,
  };
};

export function encodeMessageCursor(key: MessageSortKey): string {
  return encodeBase64Url(JSON.stringify(key));
}

export function decodeMessageCursor(value: string | null): MessageSortKey | null {
  if (value == null) {
    return null;
  }

  try {
    return parseCursorPayload(JSON.parse(decodeBase64Url(value)));
  } catch (error) {
    if (error instanceof InvalidMessageCursorError) {
      throw error;
    }
    throw new InvalidMessageCursorError();
  }
}

export function compareMessageSortKeys(left: MessageSortKey, right: MessageSortKey): number {
  if (left.createdAt !== right.createdAt) {
    return right.createdAt.localeCompare(left.createdAt);
  }

  const leftRank = scopeRank[left.scope];
  const rightRank = scopeRank[right.scope];
  if (leftRank !== rightRank) {
    return rightRank - leftRank;
  }

  return right.numericId - left.numericId;
}

export const MESSAGE_SCOPE_RANK = scopeRank;
