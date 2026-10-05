// Only the binding surface consumed by this Worker. Runtime behavior is tested with Miniflare.
/* eslint-disable no-unused-vars -- Ambient names are referenced from Wrangler's generated declaration file. */
type D1Database = import('@mahoshojo/hosted-runtime/admin/database').AdminDatabase;
type Fetcher = { fetch(request: Request): Promise<Response> };
type R2Bucket = import('@mahoshojo/hosted-runtime/admin/jobs').AdminPrivateBucket;
type Queue<T=unknown> = { send(body:T):Promise<void> };
