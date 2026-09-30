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
