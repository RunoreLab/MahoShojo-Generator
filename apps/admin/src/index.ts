import { createAdminApp, setAdminSecurityHeaders } from './app';
import { loadAdminConfiguration } from './configuration';
import { createAccessJwtVerifier, type AccessJwtVerifierOptions, type AccessVerifier } from './security/access';
import { createPrincipalDirectory } from './security/authorization';
import { resolveAdminPrincipal } from '@mahoshojo/hosted-runtime/admin/principals';
import { readAdminResource, AdminReadInputError } from '@mahoshojo/hosted-runtime/admin/read-models';
import { AdminOperationError } from '@mahoshojo/hosted-runtime/admin/operations';
import type { AdminDatabase } from '@mahoshojo/hosted-runtime/admin/database';
import { READ_CAPABILITIES, AdminHttpError } from './business';
import { createActions, parseEnabledActions, ACTION_CAPABILITIES } from './actions';
import { createExtraReads } from './extra-reads';
import { scanAdminJobs, runAdminJobStep, expireAdminArtifacts, type AdminPrivateBucket } from '@mahoshojo/hosted-runtime/admin/jobs';
import { runAdminAiJob } from '@mahoshojo/hosted-runtime/admin/ai-review';
import { parseAIProvidersFromEnv } from '@mahoshojo/hosted-runtime/node-runtime/providers';
import { createSignatureService } from '@mahoshojo/hosted-runtime/signature';
import { runScheduledAdminAnalyticsSnapshot } from '@mahoshojo/hosted-runtime/admin/actions/analytics';
export type AdminRuntimeBindings = CloudflareBindings & { ADMIN_ENABLED_ACTIONS?: string;ADMIN_ARENA_ORIGIN?:string;ADMIN_ARENA_OBSERVATION_SECRET?:string;ADMIN_AI_PROVIDERS_CONFIG?:string;SIGNATURE_SECRET_KEY?:string;ADMIN_ANALYTICS_PRINCIPAL_ID?:string };
function storage(env:AdminRuntimeBindings):AdminPrivateBucket{
 const select=(key:string)=>key.startsWith('admin/')?env.ADMIN_OBJECTS:env.LARGE_OBJECTS;
 return {get:key=>select(key).get(key),put:(key,body)=>select(key).put(key,body),delete:key=>select(key).delete(key)};
}
async function jobStep(env:AdminRuntimeBindings,id:string,providerFetch?:typeof fetch){
 const job=await env.DB.prepare('SELECT kind FROM admin_jobs WHERE id=?').bind(id).first<{kind:string}>();
 const enabled=parseEnabledActions(env.ADMIN_ENABLED_ACTIONS);
 if(!job)return;
 if(job.kind==='ai-review'){
  if(enabled.includes('ai.review'))await runAdminAiJob(env.DB,storage(env),id,{providers:parseAIProvidersFromEnv({AI_PROVIDERS_CONFIG:env.ADMIN_AI_PROVIDERS_CONFIG,HOSTED_API_ENVIRONMENT:'production'}),fetch:providerFetch});return;
 }
 if(!enabled.includes('jobs.'+job.kind))return;
 await runAdminJobStep(env.DB,storage(env),id);
 const next=await env.DB.prepare("SELECT id FROM admin_jobs WHERE id=? AND status='queued' AND attempts=0").bind(id).first();
 if(next)await env.ADMIN_QUEUE.send({id});
}
export const ADMIN_CAPABILITIES = [...new Set(['admin.shell.read','admin.principals.manage',...Object.values(READ_CAPABILITIES),
 'content.write','tags.write','users.write','badges.write','redemption.write','messages.write','moderation.write',
 'analytics.write','ai.write','ai.review','ratings.write','pvp.write','storage.write','exports.read','data.maintenance','audit.read','arena.observe',...ACTION_CAPABILITIES])];
const configError = (): Response => {
 const response=Response.json({error:'ADMIN_CONFIGURATION_INVALID'},{status:503});setAdminSecurityHeaders(response.headers);return response;
};
export const createAdminWorker = ({ createAccessVerifier = createAccessJwtVerifier, providerFetch }: {
 createAccessVerifier?: (options: AccessJwtVerifierOptions) => AccessVerifier;
 providerFetch?: typeof fetch;
} = {}) => {
 const verifiers = new Map<string,AccessVerifier>();
 return {
  async queue(batch:{messages:{body:unknown;ack():void;retry():void}[]},env:AdminRuntimeBindings){
   for(const message of batch.messages){try{if(typeof message.body==='object'&&message.body!==null&&'id' in message.body&&typeof message.body.id==='string')await jobStep(env,message.body.id,providerFetch);message.ack();}catch{message.retry();}}
  },
  async scheduled(_event:unknown,env:AdminRuntimeBindings){
   await expireAdminArtifacts(env.DB,storage(env));
   for(const job of await scanAdminJobs(env.DB))await env.ADMIN_QUEUE.send({id:job.id});
   const enabled=parseEnabledActions(env.ADMIN_ENABLED_ACTIONS);
   if(enabled.includes('analytics.snapshot'))await runScheduledAdminAnalyticsSnapshot(env.DB,env.ADMIN_ANALYTICS_PRINCIPAL_ID);
  },
  async fetch(request:Request,env:AdminRuntimeBindings):Promise<Response>{
   try {
    const configuration=loadAdminConfiguration(env);
    const key=JSON.stringify([configuration.accessIssuer,configuration.accessAudience,configuration.accessJwksUrl]);
    let verifier=verifiers.get(key);
    if(!verifier){verifier=createAccessVerifier({issuer:configuration.accessIssuer,audience:configuration.accessAudience,jwksUrl:configuration.accessJwksUrl});
     if(verifiers.size>=4)verifiers.delete(verifiers.keys().next().value!); verifiers.set(key,verifier);}
    const native=env as unknown as {DB?:AdminDatabase;ASSETS?:{fetch(request:Request):Promise<Response>}};
    const db=()=>{if(!native.DB)throw new AdminHttpError(503,'ADMIN_UNAVAILABLE');return native.DB;};
    const signature=env.SIGNATURE_SECRET_KEY?createSignatureService({getSigningKey:()=>crypto.subtle.importKey('raw',new TextEncoder().encode(env.SIGNATURE_SECRET_KEY),{name:'HMAC',hash:'SHA-256'},false,['sign','verify'])}):undefined;
    const app=createAdminApp({accessVerifier:verifier,principals:createPrincipalDirectory([]),
     resolvePrincipal:identity=>resolveAdminPrincipal(db(),identity,ADMIN_CAPABILITIES),
     readResource:async(resource,query)=>{
      try{return await readAdminResource(db(),resource,query);}
      catch(error){if(error instanceof AdminReadInputError)throw new AdminHttpError(400,'ADMIN_QUERY_INVALID');
       if(error instanceof AdminOperationError)throw new AdminHttpError(error.status as 400|403|409,error.code);
       throw error;}
     },
     assets:request=>{if(!native.ASSETS)throw new AdminHttpError(503,'ADMIN_ASSET_UNAVAILABLE');return native.ASSETS.fetch(request);},
     actions:createActions(db,env.ADMIN_ENABLED_ACTIONS,signature?.verifySignature,()=>({providers:parseAIProvidersFromEnv({AI_PROVIDERS_CONFIG:env.ADMIN_AI_PROVIDERS_CONFIG,HOSTED_API_ENVIRONMENT:'production'}),bucket:storage(env),fetch:providerFetch,enqueue:id=>env.ADMIN_QUEUE.send({id})})),
     extraReads:createExtraReads(db,()=>storage(env),env),
     operationStatus:async(principalId,key)=>{
      const row=await db().prepare(`SELECT o.id,o.action,o.status,o.result_json,o.created_at,o.updated_at FROM admin_operations o
       JOIN admin_principals p ON p.id=o.actor_principal_id WHERE o.actor_principal_id=? AND o.idempotency_key=?
       AND p.status='active' AND EXISTS (SELECT 1 FROM json_each(p.capabilities_json) c WHERE c.value=o.capability)`)
       .bind(principalId,key).first<{id:string;action:string;status:string;result_json:string|null;created_at:string;updated_at:string}>();
      if(!row){
       const children=await db().prepare(`SELECT o.id,o.action,o.status,o.result_json FROM admin_operations o JOIN admin_principals p ON p.id=o.actor_principal_id
        WHERE o.actor_principal_id=? AND substr(o.idempotency_key,1,?)=? AND p.status='active'
        AND EXISTS (SELECT 1 FROM json_each(p.capabilities_json) c WHERE c.value=o.capability) ORDER BY o.created_at LIMIT 100`).bind(principalId,key.length+1,key+':').all<{id:string;action:string;status:string;result_json:string|null}>();
       if(!children.success)throw new AdminHttpError(503,'ADMIN_UNAVAILABLE');
       if(!children.results.length)throw new AdminHttpError(404,'ADMIN_OPERATION_NOT_FOUND');
       return {status:'partial',operations:children.results.map(({result_json,...safe})=>({...safe,result:result_json?JSON.parse(result_json):null})),message:'已持久化的分项结果；请核对原始范围以判断是否全部完成。'};
      }
      const {result_json,...safe}=row;const result=result_json?JSON.parse(result_json):null;
      if(row.action.endsWith('.batch')){
       const children=await db().prepare(`SELECT o.id,o.action,o.status,o.result_json FROM admin_operations o JOIN admin_principals p ON p.id=o.actor_principal_id
        WHERE o.actor_principal_id=? AND substr(o.idempotency_key,1,?)=? AND o.action=? AND p.status='active'
        AND EXISTS (SELECT 1 FROM json_each(p.capabilities_json) c WHERE c.value=o.capability) ORDER BY o.created_at LIMIT 100`)
        .bind(principalId,key.length+1,key+':',result?.action??'').all<{id:string;action:string;status:string;result_json:string|null}>();
       if(!children.success)throw new AdminHttpError(503,'ADMIN_UNAVAILABLE');
       return {...safe,status:children.results.length===result?.count?'batch':'partial',expectedCount:result?.count,
        operations:children.results.map(({result_json,...child})=>({...child,result:result_json?JSON.parse(result_json):null}))};
      }
      return {...safe,result};
     },
    });
    return await app.fetch(request);
   }catch{return configError();}
  },
 };
};
export default createAdminWorker();
