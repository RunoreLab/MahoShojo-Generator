import type { ArenaRoomGenerationControllerView } from '@/lib/arena-room/controller';

type GenerationView = Pick<
  ArenaRoomGenerationControllerView,
  'phase' | 'finalAuthoritative' | 'errorCode'
> & Partial<Pick<ArenaRoomGenerationControllerView, 'recoveryCode'>>;

const generationRecoveryErrorCodes = new Set([
  'ROOM_GENERATION_RECOVERY_TRANSIENT',
  'ROOM_GENERATION_RECOVERY_NOT_FOUND',
  'ROOM_GENERATION_RECOVERY_PROTOCOL',
]);

export const isArenaRoomGenerationRecoveryCode = (
  code: string | null | undefined,
): boolean => Boolean(code && generationRecoveryErrorCodes.has(code));

export const arenaRoomGenerationRecoveryCode = (
  generation: Pick<ArenaRoomGenerationControllerView, 'errorCode'>
    & Partial<Pick<ArenaRoomGenerationControllerView, 'recoveryCode'>>,
): string | null => {
  if (isArenaRoomGenerationRecoveryCode(generation.recoveryCode)) {
    return generation.recoveryCode ?? null;
  }
  return isArenaRoomGenerationRecoveryCode(generation.errorCode)
    ? generation.errorCode
    : null;
};

/**
 * 房间战报状态 → 用户文案 presentation。
 * 领域层的 phase / finalAuthoritative / authoritative 等内部概念不进入一级文案。
 */
export const arenaRoomGenerationStatusLabel = (generation: GenerationView): string => {
  if (generation.finalAuthoritative) return '战报已完成';
  const recoveryCode = arenaRoomGenerationRecoveryCode(generation);
  if (recoveryCode === 'ROOM_GENERATION_RECOVERY_NOT_FOUND') return '已停止等待';
  if (recoveryCode && generation.phase === 'completed') return '生成已完成';
  if (recoveryCode && generation.phase !== 'resyncing' && generation.phase !== 'failed') {
    return '战报同步受阻';
  }
  switch (generation.phase) {
    case 'completed':
      return '正在确认战报';
    case 'unknown':
      return '正在确认生成状态';
    case 'resyncing':
      return '正在恢复战报';
    case 'running':
    case 'starting':
      return '实时生成中';
    case 'failed':
      return '生成失败';
    case 'cancelled':
      return '生成已取消';
    default:
      return '暂不可用';
  }
};

export const arenaRoomGenerationRecoveryNotice = (
  generation: Pick<ArenaRoomGenerationControllerView, 'phase' | 'errorCode'>
    & Partial<Pick<ArenaRoomGenerationControllerView, 'recoveryCode'>>,
): string | null => {
  const recoveryCode = arenaRoomGenerationRecoveryCode(generation);
  if (!recoveryCode) return null;
  if (recoveryCode === 'ROOM_GENERATION_RECOVERY_NOT_FOUND') {
    return '当前房间已不再生成这份战报。';
  }
  if (recoveryCode === 'ROOM_GENERATION_RECOVERY_PROTOCOL') {
    return '战报状态无法核对，请重新同步。';
  }
  return generation.phase === 'resyncing'
    ? '暂时无法同步战报，正在自动重试…'
    : '暂时无法同步战报，请稍后重新同步。';
};

/** generation unknown：正在向服务器确认是否已开始生成。 */
export const arenaRoomGenerationUnknownNotice
  = '正在向服务器确认生成状态；为避免重复开始，请暂时不要再次点击开始。';

/** 战报分片缺口恢复。 */
export const arenaRoomGenerationGapNotice = '检测到战报内容有缺失，正在自动恢复…';

const generationErrorCodeCopy: Readonly<Record<string, string>> = {
  ARENA_CONTENT_POLICY_REJECTED: '生成内容未通过安全检查；请调整内容后重试。',
  ARENA_PROMPT_BUDGET_EXCEEDED: '本次生成内容超出模型处理上限；请在设置中精简上下文后重试。',
  ARENA_SAFETY_PROMPT_BUDGET_EXCEEDED: '本次生成内容超出模型处理上限；请在设置中精简上下文后重试。',
  ARENA_CUSTOM_PROVIDER_INVALID: '模型服务配置无效，请联系房主检查模型设置。',
  ARENA_PROVIDER_UNKNOWN: '模型服务配置无效，请联系房主检查模型设置。',
  ARENA_MODEL_UNKNOWN: '模型服务配置无效，请联系房主检查模型设置。',
  ARENA_PROVIDER_KEY_EMPTY: '模型服务未配置，请联系房主检查模型设置。',
  GENERATION_REQUEST_CONFLICT: '生成请求发生冲突，请稍后重试。',
  'web-package-output-invalid': 'AI 生成的内容没有通过所选 Web 包的格式校验，重试不会改变结果；请改用普通战报格式或换一个 Web 包。',
  ARENA_MATERIALIZATION_VERSION_UNSUPPORTED: '当前房间数据版本过旧，无法继续生成；请联系房主重新开始。',
};

export type ArenaRoomGenerationErrorCopy = {
  /** 一级用户文案：发生了什么 + 该怎么办。 */
  readonly message: string;
  /** 是否有已知映射；未知代码的详细信息放进“技术详情”。 */
  readonly known: boolean;
};

/** 生成失败错误码 → 用户文案；未知代码回退通用文案，代码本身只进技术详情。 */
export const arenaRoomGenerationErrorCopy = (code: string): ArenaRoomGenerationErrorCopy => {
  const message = generationErrorCodeCopy[code];
  if (message) return { message, known: true };
  return { message: '生成没有完成，请稍后重试。', known: false };
};
