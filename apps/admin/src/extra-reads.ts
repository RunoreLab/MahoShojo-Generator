import { readAdminAnalytics, readAdminAvailability, type AdminAnalyticsOptions } from '@mahoshojo/hosted-runtime/admin/analytics';
import { readAdminArenaRisk, readAdminPvpRoomDetail, readAdminPvpMatchDetail, listAdminPvpMatches } from '@mahoshojo/hosted-runtime/admin/arena-management';
import { readAdminArenaObservation } from '@mahoshojo/hosted-runtime/admin/arena-observation';
import { previewAdminCleanup, readAdminJobs, downloadAdminExport, downloadAdminExportBody, ADMIN_CLEANUP_TARGETS, type AdminPrivateBucket } from '@mahoshojo/hosted-runtime/admin/jobs';
import type { AdminDatabase } from '@mahoshojo/hosted-runtime/admin/database';
import { AdminOperationError } from '@mahoshojo/hosted-runtime/admin/operations';
import { AdminHttpError } from './business';
import { parseAIProvidersFromEnv } from '@mahoshojo/hosted-runtime/node-runtime/providers';
import { adminAiSystemModels, readAdminAiJobResult } from '@mahoshojo/hosted-runtime/admin/ai-review';
type Environment={ADMIN_ARENA_ORIGIN?:string;ADMIN_ARENA_OBSERVATION_SECRET?:string;ADMIN_AI_PROVIDERS_CONFIG?:string};
function query(request:Request,allowed:string[]){const params=new URL(request.url).searchParams;if([...params.keys()].some(k=>!allowed.includes(k))||[...params.keys()].length!==new Set(params.keys()).size)throw new AdminHttpError(400,'ADMIN_QUERY_INVALID');return params;}
function idQuery(request:Request){const id=query(request,['id']).get('id');if(!id||id.length>128)throw new AdminHttpError(400,'ADMIN_QUERY_INVALID');return id;}
function integerParameter(params:URLSearchParams,name:string,max:number):number|undefined{
 const value=params.get(name);if(value===null)return undefined;
 if(!/^[1-9]\d*$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)>max)throw new AdminHttpError(400,'ADMIN_QUERY_INVALID');
 return Number(value);
}
function analyticsQuery(request:Request):AdminAnalyticsOptions{
 const params=query(request,['lookbackDays','sample','cohort','activeWindowDays']);
 const sample=params.get('sample'),cohort=params.get('cohort');
 if(sample!==null&&!['active7d','tracked','all'].includes(sample)||cohort!==null&&!['week','month'].includes(cohort))throw new AdminHttpError(400,'ADMIN_QUERY_INVALID');
 return {lookbackDays:integerParameter(params,'lookbackDays',365),activeWindowDays:integerParameter(params,'activeWindowDays',180),
  sample:sample as AdminAnalyticsOptions['sample']??undefined,cohort:cohort as AdminAnalyticsOptions['cohort']??undefined};
}
export function createExtraReads(db:()=>AdminDatabase,bucket:()=>AdminPrivateBucket,env:Environment){
 const routes=[
  {path:'models',capability:'ai.read',run:async(request:Request)=>{query(request,[]);const items=adminAiSystemModels(parseAIProvidersFromEnv({AI_PROVIDERS_CONFIG:env.ADMIN_AI_PROVIDERS_CONFIG,HOSTED_API_ENVIRONMENT:'production'}));return {items,systemDefault:items[0]??null};}},
  {path:'ai-review-result',capability:'ai.review',run:async(request:Request,principalId:string)=>{const id=query(request,['id']).get('id');if(!id||id.length>128)throw new AdminHttpError(400,'ADMIN_QUERY_INVALID');return readAdminAiJobResult(db(),bucket(),principalId,id);}},
  {path:'audit-events',capability:'audit.read',run:async(request:Request)=>{
   const cursor=query(request,['cursor']).get('cursor');let bound:string[]=[];
   if(cursor){try{const parsed:unknown=JSON.parse(cursor);if(cursor.length>500||!Array.isArray(parsed)||parsed.length!==2||parsed.some(v=>typeof v!=='string'||v.length>128))throw new Error();bound=parsed;}catch{throw new AdminHttpError(400,'ADMIN_QUERY_INVALID');}}
   const result=await db().prepare(`SELECT id,actor_principal_id,capability,action,target_type,target_id,request_id,reason,result,error_code_safe,created_at FROM admin_audit_events ${bound.length?'WHERE (created_at,id)< (?,?)':''} ORDER BY created_at DESC,id DESC LIMIT 101`).bind(...bound).all<Record<string,unknown>>();
   if(!result.success)throw new Error('ADMIN_DATABASE_UNAVAILABLE');const items=result.results.slice(0,100),last=items.at(-1);return {items,nextCursor:result.results.length>100?JSON.stringify([last!.created_at,last!.id]):null};}},
  {path:'report-detail',capability:'moderation.read',run:async(request:Request)=>{const id=query(request,['id']).get('id');if(!id||id.length>128)throw new AdminHttpError(400,'ADMIN_QUERY_INVALID');const row=await db().prepare('SELECT id,case_id,reporter_user_id,reason_code,details,status,target_name_snapshot,target_description_snapshot,target_data_snapshot,target_updated_at_snapshot,created_at FROM reports WHERE id=?').bind(id).first();const references=await db().prepare('SELECT reference_type,reference_id,label_snapshot,url_snapshot,note FROM report_references WHERE report_id=? ORDER BY sort_order LIMIT 100').bind(id).all();if(!references.success)throw new Error('ADMIN_DATABASE_UNAVAILABLE');return {report:row,references:references.results};}},
  {path:'analytics-summary',capability:'analytics.read',run:async(request:Request)=>readAdminAnalytics(db(),analyticsQuery(request))},
  {path:'availability-summary',capability:'ai.read',run:async(request:Request)=>{query(request,[]);return readAdminAvailability(db());}},
  {path:'risk-summary',capability:'ratings.read',run:async(request:Request)=>{query(request,[]);return readAdminArenaRisk(db());}},
  {path:'pvp-room-detail',capability:'pvp.read',run:async(request:Request)=>readAdminPvpRoomDetail(db(),idQuery(request))},
  {path:'pvp-match-detail',capability:'pvp.read',run:async(request:Request)=>readAdminPvpMatchDetail(db(),idQuery(request))},
  {path:'pvp-matches',capability:'pvp.read',run:async(request:Request)=>{
   const params=query(request,['roomId','cursor','limit','status','userId']);
   for(const field of ['roomId','cursor'])if(params.has(field)&&(!params.get(field)||params.get(field)!.length>128))throw new AdminHttpError(400,'ADMIN_QUERY_INVALID');
   if(params.has('status')&&!['active','completed','aborted'].includes(params.get('status')!))throw new AdminHttpError(400,'ADMIN_QUERY_INVALID');
   return listAdminPvpMatches(db(),{roomId:params.get('roomId')??undefined,cursor:params.get('cursor')??undefined,
    limit:integerParameter(params,'limit',100)??50,status:params.get('status')??undefined,userId:integerParameter(params,'userId',Number.MAX_SAFE_INTEGER)});
  }},
  {path:'arena-observation',capability:'arena.observe',run:async(request:Request,principalId:string,requestId:string)=>{
   const params=query(request,['roomId','cursor']);if(!env.ADMIN_ARENA_ORIGIN||!env.ADMIN_ARENA_OBSERVATION_SECRET)throw new AdminHttpError(503,'ADMIN_ARENA_UNAVAILABLE');
   return readAdminArenaObservation({origin:env.ADMIN_ARENA_ORIGIN,secret:env.ADMIN_ARENA_OBSERVATION_SECRET,identity:{principalId,requestId},query:Object.fromEntries(params)});
  }},
  {path:'jobs',capability:'admin.shell.read',run:async(request:Request,principalId:string)=>{query(request,[]);return {items:await readAdminJobs(db(),principalId)};}},
  {path:'cleanup-targets',capability:'data.maintenance',run:async(request:Request)=>{query(request,[]);return {targets:ADMIN_CLEANUP_TARGETS};}},
  {path:'cleanup-preview',capability:'data.maintenance',run:async(request:Request)=>{const params=query(request,['target','ids']);let ids:unknown;try{ids=JSON.parse(params.get('ids')??'null');}catch{throw new AdminHttpError(400,'ADMIN_QUERY_INVALID');}const result=await previewAdminCleanup(db(),{target:params.get('target'),ids});return {target:result.target,ids:result.ids,count:result.count,retentionDays:result.retentionDays,previewVersion:result.previewVersion};}},
  {path:'export-download',capability:'exports.read',run:async(request:Request,principalId:string)=>{
   const params=query(request,['id','part']);const part=params.get('part');if(!part||!/^\d{1,2}$/.test(part))throw new AdminHttpError(400,'ADMIN_QUERY_INVALID');
   const result=await downloadAdminExport(db(),bucket(),principalId,params.get('id')??'',Number(part));
   return new Response(result.body,{headers:{'Content-Type':'application/json','Content-Disposition':'attachment; filename="admin-export.json"'}});
  }},
  {path:'export-body',capability:'exports.read',run:async(request:Request,principalId:string)=>{
   const params=query(request,['id','part']);const part=params.get('part');if(!part||!/^\d{1,2}$/.test(part))throw new AdminHttpError(400,'ADMIN_QUERY_INVALID');
   const result=await downloadAdminExportBody(db(),bucket(),principalId,params.get('id')??'',Number(part));
   return new Response(result.body,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="generation-body"'}});
  }},
 ];
 return routes.map(route=>({path:'/api/admin/v1/'+route.path,capability:route.capability,execute:async(request:Request,principalId:string,requestId:string)=>{
  try{const result=await route.run(request,principalId,requestId);return result instanceof Response?result:Response.json(result);}
  catch(error){if(error instanceof AdminOperationError)throw new AdminHttpError(error.status as 400|403|404|409,error.code);if(error instanceof Error&&(error.name==='ZodError'||/^ADMIN_PVP_(?:ID|LIMIT|USER|STATUS)_INVALID$/.test(error.message)))throw new AdminHttpError(400,'ADMIN_QUERY_INVALID');throw error;}
 }}));
}
