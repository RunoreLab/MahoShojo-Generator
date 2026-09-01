import { z } from './zod';

import { OpaqueKeySchema, WireErrorMessageSchema } from './primitives';

export const ArenaErrorCode = z.enum([
  'unauthorized',
  'forbidden',
  'capability-denied',
  'stale',
  'precondition-failed',
  'reference-changed',
  'protocol-incompatible',
  'payload-too-large',
  'rate-limited',
  'duplicate',
  'idempotent-replay',
  'not-found',
  'room-closed',
  'generation-failed',
  'invalid-message',
  'validation-failed',
  'conflict',
]);
export type ArenaErrorCode = z.infer<typeof ArenaErrorCode>;

/** Canonical schema alias retained for callers that use the `*Schema` naming convention. */
export const ArenaErrorCodeSchema = ArenaErrorCode;

/** Canonical wire error envelope; provider and credential fields are never wire data. */
export const ArenaErrorSchema = z
  .object({
    code: ArenaErrorCodeSchema,
    message: WireErrorMessageSchema.optional(),
    requestId: OpaqueKeySchema.optional(),
  })
  .strict();
export type ArenaError = z.infer<typeof ArenaErrorSchema>;

/**
 * A parser failure that callers can classify without depending on Zod's
 * diagnostic text. `cause` is intentionally local and is never serialized.
 */
export class ArenaContractError extends Error {
  public readonly code: ArenaErrorCode;
  public readonly requestId?: string;
  public readonly cause?: unknown;
  private readonly wireMessage?: string;

  public constructor(code: ArenaErrorCode, message?: string, requestId?: string, cause?: unknown) {
    super(message ?? code);
    this.name = 'ArenaContractError';
    this.code = code;
    this.requestId = requestId;
    Object.defineProperty(this, 'wireMessage', {
      value: message,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'cause', {
      value: cause,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }

  public toJSON(): ArenaError {
    const output: ArenaError = { code: this.code };
    if (this.wireMessage !== undefined && WireErrorMessageSchema.safeParse(this.wireMessage).success) {
      output.message = this.wireMessage;
    }
    if (this.requestId !== undefined && OpaqueKeySchema.safeParse(this.requestId).success) {
      output.requestId = this.requestId;
    }
    return output;
  }
}
