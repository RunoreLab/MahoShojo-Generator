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
  COLLECT_LOCAL_GARBAGE_COMMAND,
  DesktopLocalLibraryAuditError,
  DesktopLocalLibraryGcError,
  collectLocalLibraryGarbage,
  gcReclaimedSomething,
  runLocalLibraryAudit,
  summarizeLocalLibraryAudit,
} from './local-library-audit';
export type {
  LocalLibraryAuditBucket,
  LocalLibraryAuditSummary,
} from './local-library-audit';

export {
  CLOUD_AUTH_STATUS_COMMAND,
  CLOUD_LOGIN_AWAIT_COMMAND,
  CLOUD_LOGIN_BEGIN_COMMAND,
  CLOUD_LOGIN_CANCEL_COMMAND,
  CLOUD_ONLINE_STATUS_COMMAND,
  CLOUD_SIGN_OUT_COMMAND,
  DesktopCloudError,
  awaitCloudLogin,
  beginCloudLogin,
  cancelCloudLogin,
  probeCloudOnlineStatus,
  readCloudAuthStatus,
  signOutCloud,
} from './cloud-bridge';
export type { InvokeFn as CloudInvokeFn } from './cloud-bridge';

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

export {
  APPEND_WEB_PACKAGE_RESOURCE_COMMAND,
  BEGIN_WEB_PACKAGE_INSTANCE_COMMAND,
  DesktopWebPackageInstanceError,
  OPEN_WEB_PACKAGE_INSTANCE_COMMAND,
  openWebPackageInstanceInIsolatedWebview,
} from './webpkg-instance-bridge';
export type { OpenedWebPackageInstance } from './webpkg-instance-bridge';

export {
  APPEND_ARCHIVE_EXPORT_CHUNK_COMMAND,
  ARCHIVE_EXPORT_ID_HEADER,
  BEGIN_ARCHIVE_EXPORT_COMMAND,
  LOCAL_LIBRARY_ARCHIVE_LIMITS,
  LocalArchiveExportError,
  MAX_LOCAL_LIBRARY_IPC_CHUNK_BYTES,
  createArchiveExportSource,
  exportLocalLibraryArchive,
} from './local-archive-bridge';
export type {
  ExportLocalLibraryArchiveOptions,
  ExportedLocalLibraryArchive,
  RawInvokeFn,
  StructuredInvokeFn,
} from './local-archive-bridge';

export {
  DESKTOP_LIBRARY_IMPORT_LIMITS,
  LocalLibraryArchiveImportError,
  applyDesktopLibraryArchiveImport,
  inspectDesktopLibraryArchive,
  readFileBytes,
} from './local-archive-import';
export type {
  LocalLibraryArchiveImportFailure,
  LocalLibraryArchiveImportPlan,
  LocalLibraryArchiveImportReport,
  LocalLibraryArchiveImportSkip,
  LocalLibraryArchiveImportSummary,
} from './local-archive-import';