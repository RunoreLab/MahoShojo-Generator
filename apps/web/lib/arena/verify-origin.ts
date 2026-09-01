type OriginVerificationResponse = Readonly<{
  isValid?: unknown;
}>;

/**
 * 只信任服务端验签的明确肯定结果；网络、HTTP 或响应异常都按未验签处理。
 */
export const verifyArenaContentOrigin = async (payload: unknown): Promise<boolean> => {
  try {
    const response = await fetch('/api/verify-origin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) return false;
    const result: OriginVerificationResponse = await response.json();
    return result.isValid === true;
  } catch {
    return false;
  }
};
