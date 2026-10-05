// Defense against recognizable accidental credential pastes, not a detector for arbitrary secrets.
// Callers must still minimize audit data and use non-secret references.
const CREDENTIAL_PATTERN = /(?:\bBearer\s+\S+|\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]+\.|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:Authorization|password|auth[_-]?key|access[_-]?token|session[_-]?token|api[_-]?(?:key|token)|secret)\s*["']?\s*[:=]\s*\S+|\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+@|\bsk-(?:[A-Za-z0-9_-]{8,})|\bsk_(?:live|prod)_[A-Za-z0-9_-]{8,}|\bAIza[A-Za-z0-9_-]{20,}|\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{16,})/iu;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;

export class AdminAuditTextError extends Error {
  constructor(readonly code: 'ADMIN_AUDIT_TEXT_INVALID' | 'ADMIN_AUDIT_TEXT_UNSAFE') { super(code); }
}

/** Never include rejected text in errors: it may itself contain a credential. */
export function assertSafeAuditText(value: unknown, maxLength = 1024): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength || CONTROL_CHARACTER_PATTERN.test(value)) {
    throw new AdminAuditTextError('ADMIN_AUDIT_TEXT_INVALID');
  }
  if (CREDENTIAL_PATTERN.test(value)) throw new AdminAuditTextError('ADMIN_AUDIT_TEXT_UNSAFE');
}
