import type { AdminDatabase } from '@mahoshojo/hosted-runtime/admin/database';
import { resolveAdminPrincipal } from '@mahoshojo/hosted-runtime/admin/principals';
import type { AccessVerifier } from '../src/security/access';
import { authorizeIdentity } from '../src/security/authorization';
import { AdminSecurityError } from '../src/security/errors';

/** Control-tool-only diagnosis. Never returns the token, external identity or unrelated principals. */
export async function readAdminPrincipalStatus(
  db: AdminDatabase,
  verifier: AccessVerifier,
  assertion: string,
  allowedCapabilities: readonly string[],
) {
  const identity = await verifier.verify(assertion);
  const principal = await resolveAdminPrincipal(db, identity, allowedCapabilities);
  let denialCode: 'ADMIN_PRINCIPAL_MISSING' | 'ADMIN_PRINCIPAL_DISABLED' | 'ADMIN_CAPABILITY_MISSING' | null = null;
  try {
    authorizeIdentity(identity, {resolve: () => principal}, 'admin.shell.read');
  } catch (error) {
    if (!(error instanceof AdminSecurityError) || (error.code !== 'ADMIN_PRINCIPAL_MISSING'
      && error.code !== 'ADMIN_PRINCIPAL_DISABLED' && error.code !== 'ADMIN_CAPABILITY_MISSING')) throw error;
    denialCode = error.code;
  }
  return {access: 'valid' as const, identityKind: identity.kind, principal: principal?.status ?? 'missing',
    shellAllowed: denialCode === null, denialCode};
}
