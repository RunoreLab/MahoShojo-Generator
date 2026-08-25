export const estimateTokensFromText = (text: string): number => {
  if (!text) return 0;
  let cjk = 0;
  let nonCjk = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x7f) {
      nonCjk += 1;
      continue;
    }
    // 粗略识别 CJK：更接近“1 字≈1 token”的直觉；其余按非 CJK 计入分摊
    if (code >= 0x4e00 && code <= 0x9fff) {
      cjk += 1;
    } else {
      nonCjk += 1;
    }
  }
  return Math.max(1, Math.ceil(cjk + nonCjk / 4));
};

