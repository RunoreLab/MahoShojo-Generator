// 提示词 token 的轻量近似估算。
//
// 这是跨 Provider 共用的 UI/预算近似，不代表任一模型的真实 tokenizer：
// BMP 非 ASCII 按一 code point 一 token；astral symbol（常见于 emoji）按四
// token 保守估算；ASCII 按四字符一 token。Hosted 的资源预算与详情页上下文
// 估算共用这一份实现，避免两端各自维护导致口径漂移。
export const estimateTokensFromText = (text: string): number => {
  if (!text) return 0;
  let ascii = 0;
  let nonAsciiEstimate = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) {
      ascii += 1;
    } else {
      nonAsciiEstimate += codePoint > 0xffff ? 4 : 1;
    }
  }
  return Math.max(1, Math.ceil(nonAsciiEstimate + ascii / 4));
};
