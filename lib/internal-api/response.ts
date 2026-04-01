export const json = (payload: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(payload), {
    status: init?.status ?? 200,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

export const methodNotAllowed = (): Response => json({ error: 'Method not allowed' }, { status: 405 });

export const readOptionalJson = async <T = Record<string, unknown>>(
  req: Request,
): Promise<{ data: T } | { response: Response }> => {
  try {
    const raw = await req.text();
    if (raw.trim().length === 0) {
      return { data: {} as T };
    }

    return { data: JSON.parse(raw) as T };
  } catch {
    return { response: json({ error: '请求体不是有效 JSON' }, { status: 400 }) };
  }
};
