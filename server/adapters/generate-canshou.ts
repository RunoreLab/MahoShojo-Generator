import { defaultGenerateCanshouService } from '@/lib/hosted-api/generate-canshou';

const honoRouteHandler = defaultGenerateCanshouService;

export const GET = honoRouteHandler;
export const HEAD = honoRouteHandler;
export const OPTIONS = honoRouteHandler;
export const POST = honoRouteHandler;
export const PUT = honoRouteHandler;
export const PATCH = honoRouteHandler;
export const DELETE = honoRouteHandler;
