import { describe, expect, test } from 'vitest';
import {
  mapChangeEmailError,
  mapChangePasswordError,
  mapRecoverResetPasswordError,
  mapRecoverSignUpError,
  mapRegisterError,
  mapSetPasswordError,
} from '@/lib/auth/error-message';

describe('auth error message mapper', () => {
  test('重置密码错误可兼容 Invalid token 变体', () => {
    expect(mapRecoverResetPasswordError('Invalid token')).toBe('重置链接无效、已过期或已被使用，请重新发起找回流程');
    expect(mapRecoverResetPasswordError('INVALID_TOKEN')).toBe('重置链接无效、已过期或已被使用，请重新发起找回流程');
  });

  test('重置流程认领错误可映射邮箱冲突', () => {
    expect(mapRecoverSignUpError('USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL')).toBe(
      '该邮箱已存在新版账号，系统正在尝试关联后继续完成重置',
    );
  });

  test('注册接口错误可映射为中文', () => {
    expect(mapRegisterError('EMAIL_ALREADY_EXISTS')).toBe('邮箱已被注册，请直接登录或使用找回密码');
  });

  test('设置密码错误可映射英文短语', () => {
    expect(mapSetPasswordError('User already has a password')).toBe('当前账号已经设置过密码');
  });

  test('修改密码错误可映射 Invalid password', () => {
    expect(mapChangePasswordError('Invalid password')).toBe('当前密码错误，请重新输入');
  });

  test('修改邮箱错误可映射英文短语', () => {
    expect(mapChangeEmailError('Change email is disabled')).toBe('当前环境暂未开启改绑邮箱');
  });
});
