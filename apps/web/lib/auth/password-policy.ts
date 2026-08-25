export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_REQUIRED_CATEGORY_COUNT = 3;

export type PasswordStrengthLevel = 'weak' | 'medium' | 'strong';

export type PasswordPolicyIssue =
  | 'min-length'
  | 'insufficient-character-categories'
  | 'contains-username'
  | 'contains-email-local-part';

export type PasswordStrength = {
  level: PasswordStrengthLevel;
  score: number;
  maxScore: number;
  length: number;
  categoryCount: number;
  hasLowercase: boolean;
  hasUppercase: boolean;
  hasDigit: boolean;
  hasSymbol: boolean;
};

export type PasswordPolicyContext = {
  username?: string | null;
  email?: string | null;
};

export type PasswordPolicyResult = {
  ok: boolean;
  issues: PasswordPolicyIssue[];
  strength: PasswordStrength;
};

const normalizeText = (value: string | null | undefined): string => {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
};

const extractEmailLocalPart = (email: string | null | undefined): string => {
  const normalized = normalizeText(email);
  if (!normalized) return '';
  const local = normalized.split('@')[0] ?? '';
  return local.trim();
};

const containsMeaningfulSegment = (passwordLowercase: string, candidate: string): boolean => {
  const normalized = candidate.trim();
  if (normalized.length < 3) return false;
  return passwordLowercase.includes(normalized.toLowerCase());
};

const getStrengthLevel = (score: number): PasswordStrengthLevel => {
  if (score >= 3) return 'strong';
  if (score >= 2) return 'medium';
  return 'weak';
};

export const evaluatePasswordStrength = (password: string): PasswordStrength => {
  const value = typeof password === 'string' ? password : '';
  const length = value.length;
  const hasLowercase = /[a-z]/.test(value);
  const hasUppercase = /[A-Z]/.test(value);
  const hasDigit = /\d/.test(value);
  const hasSymbol = /[^A-Za-z0-9]/.test(value);
  const categoryCount = [hasLowercase, hasUppercase, hasDigit, hasSymbol].filter(Boolean).length;

  let score = 0;
  if (length >= PASSWORD_MIN_LENGTH) score += 1;
  if (categoryCount >= PASSWORD_REQUIRED_CATEGORY_COUNT) score += 1;
  if (length >= 12) score += 1;
  if (categoryCount === 4) score += 1;

  return {
    level: getStrengthLevel(score),
    score,
    maxScore: 4,
    length,
    categoryCount,
    hasLowercase,
    hasUppercase,
    hasDigit,
    hasSymbol,
  };
};

export const validatePasswordPolicy = (
  password: string,
  context: PasswordPolicyContext = {},
): PasswordPolicyResult => {
  const value = typeof password === 'string' ? password : '';
  const strength = evaluatePasswordStrength(value);
  const issues: PasswordPolicyIssue[] = [];

  if (strength.length < PASSWORD_MIN_LENGTH) {
    issues.push('min-length');
  }

  if (strength.categoryCount < PASSWORD_REQUIRED_CATEGORY_COUNT) {
    issues.push('insufficient-character-categories');
  }

  const passwordLowercase = value.toLowerCase();
  const normalizedUsername = normalizeText(context.username);
  if (containsMeaningfulSegment(passwordLowercase, normalizedUsername)) {
    issues.push('contains-username');
  }

  const emailLocalPart = extractEmailLocalPart(context.email);
  if (containsMeaningfulSegment(passwordLowercase, emailLocalPart)) {
    issues.push('contains-email-local-part');
  }

  return {
    ok: issues.length === 0,
    issues,
    strength,
  };
};

export const getPasswordPolicyIssueMessage = (issue: PasswordPolicyIssue): string => {
  switch (issue) {
    case 'min-length':
      return `密码长度至少需要 ${PASSWORD_MIN_LENGTH} 位`;
    case 'insufficient-character-categories':
      return '密码需至少包含大写字母、小写字母、数字、符号中的 3 类';
    case 'contains-username':
      return '密码不能包含用户名';
    case 'contains-email-local-part':
      return '密码不能包含邮箱名前缀';
    default:
      return '密码不符合安全要求';
  }
};

export const getPasswordPolicySummaryMessage = (issues: PasswordPolicyIssue[]): string => {
  if (!Array.isArray(issues) || issues.length === 0) return '';
  return issues.map(getPasswordPolicyIssueMessage).join('；');
};

export const getPasswordStrengthLabel = (level: PasswordStrengthLevel): string => {
  if (level === 'strong') return '强';
  if (level === 'medium') return '中';
  return '弱';
};
