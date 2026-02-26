type HeadersWithSetCookie = Headers & {
  getSetCookie?: () => string[];
};

export const splitSetCookieHeaderValue = (rawValue: string): string[] => {
  const raw = rawValue.trim();
  if (!raw) return [];

  const cookies: string[] = [];
  let current = '';
  let inExpires = false;

  for (let index = 0; index < raw.length; index += 1) {
    const ch = raw[index]!;

    if (!inExpires && (ch === 'e' || ch === 'E') && raw.slice(index, index + 8).toLowerCase() === 'expires=') {
      inExpires = true;
      current += ch;
      continue;
    }

    if (ch === ';') {
      inExpires = false;
      current += ch;
      continue;
    }

    if (ch === ',' && !inExpires) {
      const candidate = current.trim();
      if (candidate) cookies.push(candidate);
      current = '';
      continue;
    }

    current += ch;
  }

  const candidate = current.trim();
  if (candidate) cookies.push(candidate);

  return cookies;
};

export const appendSetCookieHeaders = (target: Headers, source: Headers): void => {
  const maybeHeaders = source as HeadersWithSetCookie;
  if (typeof maybeHeaders.getSetCookie === 'function') {
    const cookies = maybeHeaders.getSetCookie();
    for (const value of cookies) {
      target.append('Set-Cookie', value);
    }
    return;
  }

  const raw = source.get('set-cookie');
  if (!raw || raw.trim().length === 0) {
    return;
  }

  const cookies = splitSetCookieHeaderValue(raw);
  if (cookies.length === 0) {
    target.append('Set-Cookie', raw);
    return;
  }

  for (const value of cookies) {
    target.append('Set-Cookie', value);
  }
};
