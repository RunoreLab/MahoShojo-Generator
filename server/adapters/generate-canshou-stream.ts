import { defaultGenerateCanshouStreamService } from '@/lib/hosted-api/generate-canshou-stream';

const honoRouteHandler = defaultGenerateCanshouStreamService;

export const GET = honoRouteHandler;
export const HEAD = honoRouteHandler;
export const OPTIONS = honoRouteHandler;
export const POST = honoRouteHandler;
export const PUT = honoRouteHandler;
export const PATCH = honoRouteHandler;
export const DELETE = honoRouteHandler;
