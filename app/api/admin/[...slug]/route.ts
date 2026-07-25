import { resolveAdminHandler } from './handler';

const notFound = (): Response =>
  new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });

async function handleRequest(req: Request, context: { params: Promise<{ slug: string[] }> }): Promise<Response> {
  const { slug } = await context.params;
  const resolved = resolveAdminHandler(slug);

  if (!resolved) {
    return notFound();
  }

  const { handler, params } = resolved;

  // Build context with params for handlers that need them
  const handlerContext = Object.keys(params).length > 0 ? { params } : undefined;

  return handler(req, handlerContext);
}

export const runtime = 'edge';

export const GET = handleRequest;
export const HEAD = handleRequest;
export const POST = handleRequest;
export const PUT = handleRequest;
export const PATCH = handleRequest;
export const DELETE = handleRequest;
export const OPTIONS = handleRequest;
