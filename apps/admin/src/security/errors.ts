export type AdminSecurityErrorCode =
  | 'ACCESS_TOKEN_INVALID'
  | 'ACCESS_IDENTITY_INVALID'
  | 'ADMIN_PRINCIPAL_MISSING'
  | 'ADMIN_PRINCIPAL_DISABLED'
  | 'ADMIN_CAPABILITY_MISSING'
  | 'ADMIN_ROUTE_UNDECLARED'
  | 'ADMIN_ROUTE_POLICY_INVALID'
  | 'ADMIN_PRINCIPAL_CONFIG_INVALID'
  | 'ADMIN_CSRF_REJECTED'
  | 'ADMIN_AUDIT_INVALID';

export class AdminSecurityError extends Error {
  readonly code: AdminSecurityErrorCode;

  constructor(code: AdminSecurityErrorCode) {
    super(code);
    this.name = 'AdminSecurityError';
    this.code = code;
  }
}
