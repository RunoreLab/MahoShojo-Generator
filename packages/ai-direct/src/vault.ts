/**
 * Runtime-neutral boundary for platform-backed secret storage.
 * Implementations must keep plaintext values out of ordinary app persistence and logs.
 */
export interface SecureVault {
  setSecret(_ref: string, _value: string): Promise<void>;
  getSecret(_ref: string): Promise<string | null>;
  deleteSecret(_ref: string): Promise<void>;
}
