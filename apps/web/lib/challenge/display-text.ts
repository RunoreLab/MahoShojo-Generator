import type {
  ChallengeNodeType,
  EnemySnapshotV1,
  MapNodeV1,
  PlayerSnapshotV1,
  StrengthTier,
} from '@/lib/challenge/types';

export const formatChallengeNodeTypeLabel = (value: ChallengeNodeType): string => {
  switch (value) {
    case 'battle':
      return '普通战斗';
    case 'elite':
      return '精英战';
    case 'event':
      return '事件';
    case 'rest':
      return '休整';
    case 'shop':
      return '商店';
    case 'boss':
      return '首领战';
    default:
      return '未知节点';
  }
};

export const formatStrengthTierLabel = (value: StrengthTier): string => {
  switch (value) {
    case 'boss':
      return '首领';
    case 'elite':
      return '精英';
    case 'common':
      return '标准';
    default:
      return '未知';
  }
};

export const formatStrengthTierLevelLabel = (value: PlayerSnapshotV1['strengthTier']): string =>
  `${formatStrengthTierLabel(value)}级`;

export const formatMapHintLabel = (value: MapNodeV1['riskHint'] | MapNodeV1['rewardHint']): string => {
  switch (value) {
    case 'high':
      return '高';
    case 'mid':
      return '中';
    case 'low':
      return '低';
    default:
      return '未知';
  }
};

export const formatPlayerSourceTypeLabel = (value: PlayerSnapshotV1['sourceType']): string => {
  switch (value) {
    case 'preset':
      return '预设卡';
    case 'local-card':
      return '本地导入';
    case 'public-card':
      return '公开角色卡';
    default:
      return '未知来源';
  }
};

export const formatEnemySourceTypeLabel = (value: EnemySnapshotV1['sourceType']): string => {
  switch (value) {
    case 'preset':
      return '预设卡';
    case 'public-card':
      return '公开角色卡';
    case 'season-entity':
      return '赛季实体';
    default:
      return '未知来源';
  }
};
