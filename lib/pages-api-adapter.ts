type NodeLikeRequest = {
  method?: string;
  url?: string;
  headers?: Headers | Record<string, string | string[] | undefined>;
  body?: unknown;
};

type NodeLikeResponse = {
  status: (statusCode: number) => NodeLikeResponse;
  setHeader: (name: string, value: string | string[]) => void;
  send?: (body: unknown) => void;
  write?: (chunk: unknown) => void;
  end: (body?: unknown) => void;
};

const BODYLESS_METHODS = new Set(['GET', 'HEAD']);

const isWebRequest = (req: unknown): req is Request => {
  return req instanceof Request || (
    typeof req === 'object' &&
    req !== null &&
    typeof (req as Request).json === 'function' &&
    typeof (req as Request).arrayBuffer === 'function' &&
    typeof (req as Request).headers?.get === 'function'
  );
};

const appendHeaders = (headers: Headers, source: NodeLikeRequest['headers']): void => {
  if (!source) return;
  if (source instanceof Headers) {
    source.forEach((value, key) => headers.set(key, value));
    return;
  }

  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string') headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(','));
  }
};

const getHeaderValue = (headers: NodeLikeRequest['headers'], name: string): string | null => {
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get(name);
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
};

const getNodeRequestOrigin = (req: NodeLikeRequest): string => {
  const host = getHeaderValue(req.headers, 'x-forwarded-host') || getHeaderValue(req.headers, 'host');
  const proto = getHeaderValue(req.headers, 'x-forwarded-proto') || 'https';
  return host ? `${proto.split(',')[0]?.trim() || 'https'}://${host.split(',')[0]?.trim() || host}` : 'https://mahoshojo.local';
};

const buildBody = (req: NodeLikeRequest): BodyInit | null => {
  const method = (req.method || 'GET').toUpperCase();
  if (BODYLESS_METHODS.has(method)) return null;

  if (req.body === undefined || req.body === null) return null;
  if (typeof req.body === 'string') return req.body;
  if (req.body instanceof ArrayBuffer || ArrayBuffer.isView(req.body)) return req.body as BodyInit;
  return JSON.stringify(req.body);
};

const toWebRequest = (req: Request | NodeLikeRequest): Request => {
  if (isWebRequest(req)) return req;

  const headers = new Headers();
  appendHeaders(headers, req.headers);

  const method = req.method || 'GET';
  const body = buildBody(req);
  return new Request(new URL(req.url || '/', getNodeRequestOrigin(req)).toString(), {
    method,
    headers,
    body,
  });
};

const sendResponseBody = async (res: NodeLikeResponse, response: Response): Promise<void> => {
  if (!response.body) {
    res.end();
    return;
  }

  if (typeof res.write === 'function') {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
    return;
  }

  const body = new Uint8Array(await response.arrayBuffer());
  if (typeof res.send === 'function') res.send(body);
  else res.end(body);
};

const sendWebResponse = async (res: NodeLikeResponse, response: Response): Promise<void> => {
  res.status(response.status);
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  await sendResponseBody(res, response);
};

export const withPagesApiResponse = (
  handler: (req: any) => Promise<Response> | Response,
) => {
  return async function pagesApiResponseAdapter(req: Request | NodeLikeRequest, res?: NodeLikeResponse): Promise<Response | void> {
    const response = await handler(toWebRequest(req));
    if (!res || typeof res.status !== 'function') return response;
    await sendWebResponse(res, response);
  };
};
