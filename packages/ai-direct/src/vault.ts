/**
 * Runtime-neutral boundary for platform-backed secret storage.
 *
 * This port is deliberately write-only plus existence. A plaintext read is
 * intentionally absent: once a secret is persisted, no renderer-reachable
 * surface may read it back. Reading plaintext is the platform executor's
 * internal responsibility, immediately before it builds the outgoing request.
 *
 * Callers may hold plaintext only while the user is actively typing it into a
 * credential field; that transient state must not be persisted, logged, or
 * placed into any request DTO.
 */
export interface SecureVault {
  setSecret(_ref: string, _value: string): Promise<void>;
  /** Reports whether a secret is stored under this reference. Never returns the value. */
  hasSecret(_ref: string): Promise<boolean>;
  /** Idempotent: removing an absent reference succeeds. */
  deleteSecret(_ref: string): Promise<void>;
}
