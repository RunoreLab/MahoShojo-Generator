const json = (payload: unknown, status: number): Response => new Response(
  JSON.stringify(payload),
  {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    },
  },
);

async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  return json({
    code: 'ARENA_REDO_RETIRED',
    error: '旧版角色重做入口已停用，请重试应用本次服务器角色更新。',
  }, 410);
}

export const appRouteHandler = handler;
export default appRouteHandler;
