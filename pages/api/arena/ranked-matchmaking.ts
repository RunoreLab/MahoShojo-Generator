import type { NextRequest } from 'next/server';

export const config = {
  runtime: 'edge',
};

type ApiErrorResponse = { success: false; error: string };
export default async function handler(req: NextRequest): Promise<Response> {
  if (req.method !== 'POST') {
    const body = { success: false, error: 'Method Not Allowed' } satisfies ApiErrorResponse;
    return new Response(JSON.stringify(body), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const message = '严格排位匹配已下线：已改为自选对手机制（无需排位匹配票据）。';
  const body = { success: false, error: message } satisfies ApiErrorResponse;
  return new Response(JSON.stringify(body), {
    status: 410,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
