import type { ArenaRoomHostWorkspaceDirtyReason } from '@/lib/arena-room/host-workspace';

/**
 * 房间 UI 产品术语 registry。
 * 领域概念（Arena / baseline / revision / authoritative）保留在代码与 API；
 * 用户界面统一使用这里的文案，不直接插值内部字段。
 */

/** 房主工作区“脏原因”→ 用户文案（配置面板与生成确认共用同一份）。 */
export const arenaRoomDirtyReasonCopy: Readonly<
  Record<ArenaRoomHostWorkspaceDirtyReason, string>
> = {
  'baseline-missing': '还没有把本地内容发布到这个房间',
  'host-local-content': '本地内容（角色、情景、素材）有未发布的修改',
  'shared-config': '本地编辑与当前房间设置不同',
  'working-copy-invalid': '当前编辑内容无法安全发布',
};

export type ArenaRoomConfigSyncLabelInput = {
  readonly needsAttention: boolean;
  readonly synchronizing: boolean;
};

/** 房间配置同步状态 → 顶栏短标签（不暴露 revision 数字）。 */
export const arenaRoomConfigSyncLabel = ({ needsAttention, synchronizing }: ArenaRoomConfigSyncLabelInput): string => {
  if (needsAttention) return '配置需要处理';
  if (synchronizing) return '正在同步配置';
  return '配置已同步';
};

/** 历史战报保留期提示（历史列表与最近战报共用）。 */
export const arenaRoomHistoryExpiredNotice = '这场战报已超过保留期，无法再查看。';
export const arenaRoomHistoryNotArchivedNotice = '这场战报当时未成功归档，没有可恢复的正文。';

/** 生成记录上“包含协作变更”的通用标记文案。 */
export const arenaRoomCollaborativeTag = '包含成员提案';
