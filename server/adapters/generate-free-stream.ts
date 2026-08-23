import { defaultGenerateFreeStreamService } from '@/lib/hosted-api/generate-free-stream';

const honoRouteHandler = defaultGenerateFreeStreamService;

export const GET = honoRouteHandler;
export const HEAD = honoRouteHandler;
export const OPTIONS = honoRouteHandler;
export const POST = honoRouteHandler;
export const PUT = honoRouteHandler;
export const PATCH = honoRouteHandler;
export const DELETE = honoRouteHandler;
