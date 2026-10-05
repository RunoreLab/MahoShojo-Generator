import { expect,test } from 'vitest';
import { fileURLToPath } from 'node:url';
import { createLocalFixture } from '../scripts/local-fixture';

test('批量每项CAS、部分失败、同批重试不重复写且查询保留结果',async()=>{
 const fixture=await createLocalFixture(fileURLToPath(new URL('../../../',import.meta.url)),undefined,true);
 try{
  fixture.env.ADMIN_ENABLED_ACTIONS=JSON.stringify(['cards.review.batch']);
  const headers={'Cf-Access-Jwt-Assertion':fixture.token,Origin:'http://127.0.0.1:8799','Sec-Fetch-Site':'same-origin','X-Mahoshojo-Admin-CSRF':'1','Content-Type':'application/json'};
  const request=(path:string,body?:unknown)=>fixture.worker.fetch(new Request('http://127.0.0.1:8799'+path,{headers,...(body?{method:'POST',body:JSON.stringify(body)}:{})}),fixture.env);
  const directory=await (await request('/api/admin/v1/actions')).json() as {actions:{name:string;itemFields?:{name:string}[]}[]};
  expect(directory.actions.map(action=>action.name)).toEqual(['cards.review.batch']);
  expect(directory.actions[0].itemFields?.map(field=>field.name)).toEqual(['id','expectedVersion','decision']);
  const detail=await (await request('/api/admin/v1/data-cards?id=fixture-card-1')).json() as {items:{expectedVersion:string}[]};
  const input={reason:'批量审核测试',idempotencyKey:'batch-intent',items:[{id:'fixture-card-1',expectedVersion:detail.items[0].expectedVersion,decision:'approved'},{id:'fixture-card-2',expectedVersion:'stale',decision:'approved'}]};
  const first=await (await request('/api/admin/v1/actions/cards.review.batch',input)).json() as {items:{status:string;operationId:string}[]};
  expect(first.items.map(item=>item.status)).toEqual(['succeeded','conflict']);
  expect(await (await request('/api/admin/v1/actions/cards.review.batch',input)).json()).toMatchObject({items:[{operationId:first.items[0].operationId,replayed:true},{operationId:first.items[1].operationId,replayed:true}]});
  const status=await (await request('/api/admin/v1/operation?idempotencyKey=batch-intent')).json() as {operations:unknown[]};
  expect(status.operations).toHaveLength(2);
  const expanded={...input,items:[...input.items,{...input.items[0],id:'appended-card'}]};
  expect((await request('/api/admin/v1/actions/cards.review.batch',expanded)).status).toBe(409);
  expect(await fixture.db.prepare("SELECT count(*) n FROM admin_operations WHERE idempotency_key='batch-intent:2'").first()).toEqual({n:0});
  expect((await request('/api/admin/v1/actions/cards.review.batch',{...input,items:[{...input.items[0],reason:'override'}]})).status).toBe(400);
 }finally{await fixture.dispose();}
},30000);
