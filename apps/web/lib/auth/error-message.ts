const containsChinese = (value: string): boolean => /[\u4e00-\u9fff]/.test(value);

const isLikelyEnglishMessage = (value: string): boolean => /[A-Za-z]/.test(value) && !containsChinese(value);

const normalizeAuthErrorCode = (message: string): string => {
  return message
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_');
};

const hasAnyToken = (normalizedCode: string, tokens: string[]): boolean => {
  return tokens.some((token) => normalizedCode.includes(token));
};

const isTokenInvalidError = (normalizedCode: string): boolean => {
  return hasAnyToken(normalizedCode, ['INVALID_TOKEN', 'TOKEN_INVALID', 'TOKEN_EXPIRED', 'TOKEN_NOT_FOUND']);
};

export const mapRecoverResetPasswordError = (message: string): string => {
  const normalized = normalizeAuthErrorCode(message);
  if (!normalized) return '设置新密码失败，请稍后重试';
  if (isTokenInvalidError(normalized)) return '重置链接无效、已过期或已被使用，请重新发起找回流程';
  if (hasAnyToken(normalized, ['PASSWORD_TOO_SHORT'])) return '新密码长度不足';
  if (hasAnyToken(normalized, ['PASSWORD_TOO_LONG'])) return '新密码长度过长';
  if (isLikelyEnglishMessage(message)) return '设置新密码失败，请稍后重试';
  return message;
};

export const mapRecoverSignUpError = (message: string): string => {
  const normalized = normalizeAuthErrorCode(message);
  if (!normalized) return '账号迁移认领失败，请稍后重试';
  if (hasAnyToken(normalized, ['USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', 'EMAIL_ALREADY_EXISTS', 'USER_ALREADY_EXISTS'])) {
    return '该邮箱已存在新版账号，系统正在尝试关联后继续完成重置';
  }
  if (hasAnyToken(normalized, ['INVALID_PAYLOAD'])) return '账号迁移认领请求无效，请稍后重试';
  if (isLikelyEnglishMessage(message)) return '账号迁移认领失败，请稍后重试';
  return message;
};

export const mapRegisterError = (message: string): string => {
  const normalized = normalizeAuthErrorCode(message);
  if (!normalized) return '密码注册失败，请稍后重试';
  if (hasAnyToken(normalized, ['USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', 'EMAIL_ALREADY_EXISTS'])) {
    return '邮箱已被注册，请直接登录或使用找回密码';
  }
  if (hasAnyToken(normalized, ['USERNAME_ALREADY_EXISTS', 'NAME_ALREADY_EXISTS'])) return '用户名已存在';
  if (hasAnyToken(normalized, ['PASSWORD_TOO_SHORT'])) return '密码长度不足';
  if (hasAnyToken(normalized, ['PASSWORD_TOO_LONG'])) return '密码长度过长';
  if (hasAnyToken(normalized, ['INVALID_EMAIL', 'EMAIL_INVALID'])) return '请输入有效的邮箱地址';
  if (hasAnyToken(normalized, ['INVALID_PAYLOAD'])) return '注册信息不完整，请检查后重试';
  if (isLikelyEnglishMessage(message)) return '密码注册失败，请检查输入后重试';
  return message;
};

export const mapSetPasswordError = (message: string): string => {
  const normalized = normalizeAuthErrorCode(message);
  if (!normalized) return '设置密码失败，请稍后重试';
  if (hasAnyToken(normalized, ['PASSWORD_TOO_SHORT'])) return '新密码长度不足';
  if (hasAnyToken(normalized, ['PASSWORD_TOO_LONG'])) return '新密码长度过长';
  if (hasAnyToken(normalized, ['USER_ALREADY_HAS_A_PASSWORD'])) return '当前账号已经设置过密码';
  if (hasAnyToken(normalized, ['USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', 'EMAIL_ALREADY_EXISTS'])) {
    return '该邮箱已存在新版账号，请使用密码登录或找回密码完成迁移';
  }
  if (isTokenInvalidError(normalized)) return '设置密码凭证已失效，请刷新页面后重试';
  if (isLikelyEnglishMessage(message)) return '设置密码失败，请稍后重试';
  return message;
};

export const mapChangePasswordError = (message: string): string => {
  const normalized = normalizeAuthErrorCode(message);
  if (!normalized) return '修改密码失败，请稍后重试';
  if (
    hasAnyToken(normalized, [
      'INVALID_PASSWORD',
      'INVALID_CREDENTIAL',
      'INVALID_CREDENTIALS',
      'PASSWORD_NOT_MATCH',
      'CURRENT_PASSWORD_INVALID',
    ])
  ) {
    return '当前密码错误，请重新输入';
  }
  if (hasAnyToken(normalized, ['PASSWORD_TOO_SHORT'])) return '新密码长度不足';
  if (hasAnyToken(normalized, ['PASSWORD_TOO_LONG'])) return '新密码长度过长';
  if (hasAnyToken(normalized, ['CREDENTIAL_ACCOUNT_NOT_FOUND'])) return '当前账号尚未设置密码，请先完成账号迁移';
  if (hasAnyToken(normalized, ['SAME_PASSWORD', 'PASSWORD_SAME', 'NEW_PASSWORD_SHOULD_BE_DIFFERENT'])) {
    return '新密码不能与当前密码相同';
  }
  if (isLikelyEnglishMessage(message)) return '修改密码失败，请检查输入后重试';
  return message;
};

export const mapChangeEmailError = (message: string): string => {
  const normalized = normalizeAuthErrorCode(message);
  if (!normalized) return '修改邮箱失败，请稍后重试';
  if (hasAnyToken(normalized, ['USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', 'EMAIL_ALREADY_EXISTS'])) {
    return '该邮箱已被占用';
  }
  if (hasAnyToken(normalized, ['CHANGE_EMAIL_IS_DISABLED'])) return '当前环境暂未开启改绑邮箱';
  if (hasAnyToken(normalized, ['EMAIL_IS_THE_SAME', 'SAME_EMAIL'])) return '新邮箱不能与当前邮箱相同';
  if (hasAnyToken(normalized, ['INVALID_EMAIL', 'EMAIL_INVALID'])) return '请输入有效的邮箱地址';
  if (isLikelyEnglishMessage(message)) return '修改邮箱失败，请检查输入后重试';
  return message;
};
