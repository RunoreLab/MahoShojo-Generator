import { ADMIN_BUSINESS_ACTIONS } from '@mahoshojo/hosted-runtime/admin/business-actions';
import { ADMIN_MESSAGE_ACTIONS } from '@mahoshojo/hosted-runtime/admin/actions/messages';
import { ADMIN_ANALYTICS_ACTIONS } from '@mahoshojo/hosted-runtime/admin/actions/analytics';
import { ADMIN_ARENA_ACTIONS } from '@mahoshojo/hosted-runtime/admin/actions/arena';
import { ADMIN_JOB_ACTIONS } from '@mahoshojo/hosted-runtime/admin/actions/jobs';
import { ADMIN_MODERATION_ACTIONS } from '@mahoshojo/hosted-runtime/admin/actions/moderation';
import { ADMIN_AI_REVIEW_ACTION, createAdminAiReviewJob, type AdminAiReviewExecutionOptions } from '@mahoshojo/hosted-runtime/admin/ai-review';
import { createAdminMetricsActions } from '@mahoshojo/hosted-runtime/admin/actions/metrics';
import { AdminOperationError,executeAdminOperation } from '@mahoshojo/hosted-runtime/admin/operations';
import type { AdminDatabase } from '@mahoshojo/hosted-runtime/admin/database';
import { AdminHttpError, type AdminAction } from './business';
import { AdminBatchMutationSchema } from '@mahoshojo/contracts/admin';

const BASE_ACTIONS = [...ADMIN_BUSINESS_ACTIONS, ...ADMIN_MESSAGE_ACTIONS, ...ADMIN_ANALYTICS_ACTIONS, ...ADMIN_ARENA_ACTIONS, ...ADMIN_JOB_ACTIONS, ...ADMIN_MODERATION_ACTIONS, ADMIN_AI_REVIEW_ACTION,...createAdminMetricsActions()];
const batchNames=new Set(['cards.review','cards.visibility','cards.recommend','card-updates.review','users.ban','users.review-exempt','users.slots','users.prefix','badges.grant','badges.revoke']);
export const REGISTERED_ACTIONS = [...BASE_ACTIONS,...BASE_ACTIONS.filter(action=>batchNames.has(action.name)).map(action=>({
 ...action,name:action.name+'.batch',label:'批量：'+action.label,itemFields:action.fields,fields:[{name:'items',label:'目标数组（每项包含记录编号、版本与变更值）',type:'json' as const,required:true}],
 async execute(db:AdminDatabase,raw:unknown,context:Parameters<typeof action.execute>[2]){
  const input=AdminBatchMutationSchema.parse(raw);const items=[];
  // Freeze the entire intent before starting any child. Appending or changing an item under the same key is a whole-batch conflict.
  await executeAdminOperation(db,{actorPrincipalId:context.principalId,capability:action.capability,action:action.name+'.batch',
   authnContextSafeRef:context.authnContextSafeRef,requestId:context.requestId,reason:input.reason,idempotencyKey:input.idempotencyKey,
   targetType:'admin-batch',targetId:action.name,payload:input},{
    primary:{name:'accept-batch',sql:"UPDATE admin_operations SET target_id=target_id WHERE actor_principal_id=? AND idempotency_key=? AND status='pending' AND {{admin_guard}}",bindings:[context.principalId,input.idempotencyKey]},
    result:{state:'accepted',count:input.items.length,action:action.name},
   });
  for(const [index,item] of input.items.entries()){
   try{items.push({index,...await action.execute(db,{...item,reason:input.reason,idempotencyKey:input.idempotencyKey+':'+index},context) as object});}
   catch(error){items.push({index,status:'failed',error:error instanceof AdminOperationError?error.code:error instanceof Error&&error.name==='ZodError'?'ADMIN_INPUT_INVALID':'ADMIN_UNAVAILABLE'});}
  }
  return {status:'batch',items};
 }
}))];
export const ACTION_CAPABILITIES = [...new Set(REGISTERED_ACTIONS.map(action => action.capability))];
export function parseEnabledActions(enabled: string | undefined): string[] {
  const names: unknown = JSON.parse(enabled ?? '[]');
  if (!Array.isArray(names) || names.some(name => typeof name !== 'string' || !REGISTERED_ACTIONS.some(action => action.name === name))) throw new Error('ADMIN_ACTION_CONFIG_INVALID');
  return names;
}
export function createActions(db: () => AdminDatabase, enabled: string | undefined, verifySignature?: (data:unknown)=>Promise<boolean>, aiOptions?: () => AdminAiReviewExecutionOptions): AdminAction[] {
  const names = parseEnabledActions(enabled);
  return REGISTERED_ACTIONS.filter(action => names.includes(action.name)).map(action=>action.name==='cards.metrics'?createAdminMetricsActions({verifySignature})[0]:action).map(action => ({
    ...action,
    async execute(input, context) {
      try { return action.name === 'ai.review' ? await createAdminAiReviewJob(db(), input, context, aiOptions?.()) : await action.execute(db(), input, context); }
      catch (error) {
        if (error instanceof AdminOperationError && [400,403,409].includes(error.status)) throw new AdminHttpError(error.status as 400|403|409, error.code);
        if (error instanceof Error && error.name === 'ZodError') throw new AdminHttpError(400, 'ADMIN_INPUT_INVALID');
        throw error;
      }
    },
  }));
}
