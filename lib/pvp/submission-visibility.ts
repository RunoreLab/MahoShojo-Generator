export const canViewOtherSubmissions = (phase: unknown, showAllSubmissions: boolean): boolean => {
  // 提交阶段隐藏他人卡组详情，避免“先提交的人被针对性克制”。
  // 其他阶段则按房间规则决定是否公开所有人提交详情。
  return typeof phase === 'string' && phase === 'submitting' ? false : showAllSubmissions === true;
};

