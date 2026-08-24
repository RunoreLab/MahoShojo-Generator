export const getClientIpFromHeaders = (headers: Headers): string | null => {
  const cfIp = headers.get('cf-connecting-ip')?.trim();
  if (cfIp) return cfIp;

  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return forwarded;

  return headers.get('x-real-ip')?.trim() || null;
};
