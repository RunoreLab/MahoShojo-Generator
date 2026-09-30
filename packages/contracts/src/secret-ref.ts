import { z } from './zod';

/**
 * 持久 secret 引用的唯一权威定义。
 *
 * 该引用会直接成为操作系统凭据存储的目标名，因此只允许 ASCII 字母、数字、点、下划线、
 * 冒号与连字符。这条规则同时：
 *
 * - 阻止把凭据存储当成任意键值仓库；
 * - 保证 Provider Profile 在**编写时**就拒绝那些到运行期才会暴露的不可用引用；
 * - 让 Rust 侧可以把同一份 fixture 当作接受/拒绝的共同判据。
 *
 * 放在这里而不是 `desktop-ipc` 里，是因为它同时被 Provider Profile 契约与 Desktop IPC
 * 契约消费，必须位于两者之下。
 */

export const MAX_SECRET_REF_LENGTH = 256;

export const SECRET_REF_PATTERN = /^[A-Za-z0-9._:-]+$/u;

export const SecretRefSchema = z
  .string()
  .min(1)
  .max(MAX_SECRET_REF_LENGTH)
  .regex(SECRET_REF_PATTERN, 'must only contain ASCII letters, digits, dot, underscore, colon or hyphen');
export type SecretRef = z.infer<typeof SecretRefSchema>;

export const isSecretRef = (value: string): boolean =>
  value.length > 0 && value.length <= MAX_SECRET_REF_LENGTH && SECRET_REF_PATTERN.test(value);
