// 数据卡状态工具（前后端通用，无服务端依赖）

export function isDataCardBanned(card: any): boolean {
  return card && card.is_public === -1;
}

export function getDataCardStatus(card: any): {
  status: 'public' | 'private' | 'banned';
  label: string;
  color: string;
} {
  if (!card) {
    return { status: 'private', label: '私有', color: 'gray' };
  }

  if (card.is_public === -1) {
    return { status: 'banned', label: '封禁', color: 'red' };
  } else if (card.is_public === 1) {
    return { status: 'public', label: '公开', color: 'green' };
  } else {
    return { status: 'private', label: '私有', color: 'gray' };
  }
}
