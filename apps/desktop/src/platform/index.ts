export type { DesktopRuntimeInfo } from './desktop-bridge';
export { DesktopBridgeError, readDesktopRuntimeInfo } from './desktop-bridge';

export { loadDesktopRuntimeInfo } from './runtime-info';

export {
  DELETE_PROVIDER_SECRET_COMMAND,
  HAS_PROVIDER_SECRET_COMMAND,
  SET_PROVIDER_SECRET_COMMAND,
  DesktopSecretBridgeError,
  deleteProviderSecret,
  hasProviderSecret,
  setProviderSecret,
} from './secret-bridge';

export {
  DELETE_PROVIDER_PROFILE_COMMAND,
  GET_PROVIDER_PROFILE_COMMAND,
  LIST_PROVIDER_PROFILE_IDS_COMMAND,
  SAVE_PROVIDER_PROFILE_COMMAND,
  VALIDATE_PROVIDER_EXECUTION_PROFILE_COMMAND,
  DesktopProviderProfileError,
  deleteProviderProfile,
  getProviderProfile,
  listProviderProfileIds,
  parseProviderProfileDocument,
  saveProviderProfile,
} from './provider-profile-bridge';

export {
  CANCEL_DIRECT_AI_COMMAND,
  STREAM_DIRECT_AI_COMMAND,
  DesktopAiError,
  cancelDirectAi,
  openDirectAiStream,
} from './direct-ai-bridge';
export type { DesktopAiExecutionOptions } from './direct-ai-bridge';

export { createDesktopAiExecutionPort } from './desktop-ai-execution';
export type { DirectAiChannel } from './direct-ai-bridge';

export {
  AUDIT_LOCAL_LIBRARY_COMMAND,
  DesktopLocalLibraryAuditError,
  runLocalLibraryAudit,
  summarizeLocalLibraryAudit,
} from './local-library-audit';
export type {
  LocalLibraryAuditBucket,
  LocalLibraryAuditSummary,
} from './local-library-audit';

export {
  DELETE_LOCAL_CARD_COMMAND,
  GET_LOCAL_CARD_COMMAND,
  LIST_LOCAL_CARDS_COMMAND,
  PURGE_LOCAL_CARD_COMMAND,
  RESTORE_LOCAL_CARD_COMMAND,
  SAVE_LOCAL_CARD_COMMAND,
  DesktopLocalCardError,
  IpcLocalCardRepository,
  buildLocalCardListRequest,
  toLocalCardIndex,
} from './local-card-bridge';
export type { InvokeFn as LocalCardInvokeFn } from './local-card-bridge';

export {
  DELETE_WEB_PACKAGE_COMMAND,
  GET_WEB_PACKAGE_COMMAND,
  LIST_WEB_PACKAGES_COMMAND,
  PURGE_WEB_PACKAGE_COMMAND,
  READ_WEB_PACKAGE_ARCHIVE_COMMAND,
  RESTORE_WEB_PACKAGE_COMMAND,
  SAVE_WEB_PACKAGE_COMMAND,
  IpcWebPackageRepository,
  fromBase64Bytes,
  toBase64Bytes,
  toWebPackageIndex,
} from './web-package-bridge';