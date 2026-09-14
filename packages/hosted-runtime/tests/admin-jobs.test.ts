import { describe, expect, it } from 'vitest';
import { adminManagementFixture } from './admin-management-fixture';
import { createAdminJob, cancelAdminJob, runAdminJobStep, previewAdminCleanup, downloadAdminExportBody, expireAdminArtifacts, type AdminPrivateBucket } from '../src/admin/jobs';
const bucket = () => {
  const values = new Map<string,string>();
  const storage: AdminPrivateBucket = { async put(key,body) { values.set(key,typeof body==='string'?body:await new Response(body).text()); }, async get(key) { const value=values.get(key); return value === undefined ? null : { text:async()=>value,body: new Response(value).body! }; }, async delete(key) { values.delete(key); } };
  return { values,storage };
};
describe('持久化管理作业',()=>{
 it('拒绝认证表与无界清理，preview全程只读',async()=>{
  const f=await adminManagementFixture(['data.maintenance']);
  await expect(previewAdminCleanup(f.db,{target:'auth_audit_logs',ids:['1']})).rejects.toThrow();
  await expect(previewAdminCleanup(f.db,{target:'pvp_rounds',ids:[]})).rejects.toThrow();
  expect(f.sqlite.prepare('SELECT count(*) AS n FROM admin_jobs').get()).toEqual({n:0});f.sqlite.close();
 });
 it('导出进度持久化、重复投递不重复执行、撤权后拒绝新步骤',async()=>{
  const f=await adminManagementFixture(['exports.read']);const b=bucket();
  f.sqlite.exec("INSERT INTO users (id,username,email,auth_key) VALUES (1,'fixture','fixture@example.test','never-export'); INSERT INTO data_cards (id,user_id,type,name,data) VALUES ('card',1,'character','合成卡片','{}')");
  const result=await createAdminJob(f.db,{kind:'export',target:'data-cards',ids:['card'],reason:'本地导出',idempotencyKey:'export-1'},f.context);
  await runAdminJobStep(f.db,b.storage,result.result!.jobId);
  await runAdminJobStep(f.db,b.storage,result.result!.jobId);
  expect(b.values.size).toBe(1);expect([...b.values.values()][0]).not.toContain('never-export');
  const next=await createAdminJob(f.db,{kind:'export',target:'data-cards',ids:['card'],reason:'第二次导出',idempotencyKey:'export-2'},f.context);
  f.sqlite.exec("UPDATE admin_principals SET status='disabled'");
  await runAdminJobStep(f.db,b.storage,next.result!.jobId);
  expect(b.values.size).toBe(1);expect(f.sqlite.prepare('SELECT status FROM admin_jobs WHERE id=?').get(next.result!.jobId)?.status).toBe('cancelled');f.sqlite.close();
 });
});

async function objectFixture(){
 const f=await adminManagementFixture(['data.maintenance','exports.read']);const b=bucket();
 f.sqlite.exec("INSERT INTO battle_report_generations(id,started_at,ended_at,duration_ms,status,generation_mode,endpoint,mode,created_at,updated_at) VALUES('gen','2020-01-01','2020-01-01',1,'completed','stream','fixture','classic','2020-01-01','2020-01-01'); INSERT INTO large_objects(id,kind,owner_ref_id,r2_key,bytes,created_at,updated_at) VALUES('object','battle_report_generation_output','gen','business/body',9,'2020-01-01','2020-01-01')");
 b.values.set('business/body','完整战报正文');
 const preview=await previewAdminCleanup(f.db,{target:'large_objects',ids:['object']});
 const input={kind:'cleanup' as const,target:'large_objects',ids:['object'],previewVersion:preview.previewVersion,reason:'本地清理演练',idempotencyKey:'cleanup-object'};
 const result=await createAdminJob(f.db,input,f.context);
 return {...f,b,input,id:result.result!.jobId};
}
describe('作业跨存储可靠性',()=>{
 it('CAS 冲突保留原 R2，对象备份不构成成功审计或进度',async()=>{
  const f=await objectFixture();const put=f.b.storage.put;
  f.b.storage.put=async(key,body)=>{await put(key,body);if(key.endsWith('.body'))f.sqlite.exec("UPDATE large_objects SET updated_at='2021-01-01' WHERE id='object'");};
  await runAdminJobStep(f.db,f.b.storage,f.id);
  expect(f.b.values.get('business/body')).toBe('完整战报正文');
  expect(f.sqlite.prepare('SELECT status,processed_count FROM admin_jobs WHERE id=?').get(f.id)).toEqual({status:'failed',processed_count:0});
  expect(f.sqlite.prepare('SELECT count(*) n FROM admin_object_tombstones').get()?.n).toBe(0);f.sqlite.close();
 });
 it('先摘除元数据并封存旧键，R2失败可重试，原请求仍可幂等重放',async()=>{
  const f=await objectFixture();await runAdminJobStep(f.db,f.b.storage,f.id);
  expect(f.sqlite.prepare('SELECT count(*) n FROM large_objects').get()?.n).toBe(0);
  expect(f.b.values.has('business/body')).toBe(true);
  expect(()=>f.sqlite.exec("INSERT INTO large_objects(id,kind,owner_ref_id,r2_key,bytes,created_at,updated_at) VALUES('new','other','other','business/body',1,'2020','2020')")).toThrow('ADMIN_OBJECT_KEY_RETIRED');
  expect(await createAdminJob(f.db,f.input,f.context)).toHaveProperty('replayed',true);
  await expect(createAdminJob(f.db,{...f.input,reason:'不同的请求'},f.context)).rejects.toThrow('ADMIN_IDEMPOTENCY_CONFLICT');
  const remove=f.b.storage.delete;f.b.storage.delete=async()=>{throw new Error('R2 unavailable');};
  await runAdminJobStep(f.db,f.b.storage,f.id);
  expect(f.sqlite.prepare('SELECT processed_count FROM admin_jobs WHERE id=?').get(f.id)?.processed_count).toBe(0);
  f.b.storage.delete=remove;f.sqlite.exec("UPDATE admin_jobs SET next_attempt_at='2020-01-01'");await runAdminJobStep(f.db,f.b.storage,f.id);
  expect(f.b.values.has('business/body')).toBe(false);
  expect(f.sqlite.prepare('SELECT status FROM admin_jobs WHERE id=?').get(f.id)?.status).toBe('succeeded');f.sqlite.close();
 });
 it('审计忽略导致 detach 全事务回滚',async()=>{
  const f=await objectFixture();f.sqlite.exec("CREATE TRIGGER ignore_step_audit BEFORE INSERT ON admin_audit_events WHEN NEW.action='jobs.cleanup.detach' BEGIN SELECT RAISE(IGNORE); END");
  await runAdminJobStep(f.db,f.b.storage,f.id);
  expect(f.sqlite.prepare('SELECT count(*) n FROM large_objects').get()?.n).toBe(1);
  expect(f.sqlite.prepare('SELECT count(*) n FROM admin_object_tombstones').get()?.n).toBe(0);
  expect(f.b.values.has('business/body')).toBe(true);f.sqlite.close();
 });
 it('恢复使用新业务键且审计失败不插入元数据或增加进度',async()=>{
  const f=await objectFixture();await runAdminJobStep(f.db,f.b.storage,f.id);await runAdminJobStep(f.db,f.b.storage,f.id);
  const restored=await createAdminJob(f.db,{kind:'restore',sourceJobId:f.id,reason:'恢复演练',idempotencyKey:'restore'},f.context);const id=restored.result!.jobId;
  f.sqlite.exec("CREATE TRIGGER ignore_restore_audit BEFORE INSERT ON admin_audit_events WHEN NEW.action='jobs.restore.restore' BEGIN SELECT RAISE(IGNORE); END");
  await runAdminJobStep(f.db,f.b.storage,id);
  expect(f.sqlite.prepare('SELECT count(*) n FROM large_objects').get()?.n).toBe(0);
  expect(f.sqlite.prepare('SELECT processed_count FROM admin_jobs WHERE id=?').get(id)?.processed_count).toBe(0);
  f.sqlite.exec("DROP TRIGGER ignore_restore_audit; UPDATE admin_jobs SET next_attempt_at='2020-01-01'");await runAdminJobStep(f.db,f.b.storage,id);
  const row=f.sqlite.prepare('SELECT r2_key FROM large_objects').get();expect(row?.r2_key).toBe(`recovered/admin/${id}/0`);expect(f.b.values.get(String(row?.r2_key))).toBe('完整战报正文');f.sqlite.close();
 });
 it('摘除后撤权停止删除，并保留可恢复范围',async()=>{
  const f=await objectFixture();await runAdminJobStep(f.db,f.b.storage,f.id);f.sqlite.exec("UPDATE admin_principals SET status='disabled'");await runAdminJobStep(f.db,f.b.storage,f.id);
  expect(f.b.values.has('business/body')).toBe(true);expect(f.sqlite.prepare('SELECT status FROM admin_jobs WHERE id=?').get(f.id)?.status).toBe('cancelled');
  f.sqlite.exec("UPDATE admin_principals SET status='active'");const result=await createAdminJob(f.db,{kind:'restore',sourceJobId:f.id,reason:'恢复撤销任务',idempotencyKey:'restore-revoked'},f.context);expect(result.result?.count).toBe(1);f.sqlite.close();
 });
 it('完整正文授权下载，过期导出有界销毁且活动作业审计保留',async()=>{
  const f=await objectFixture();const result=await createAdminJob(f.db,{kind:'export',target:'generations',ids:['gen'],reason:'全文导出',idempotencyKey:'export-body'},f.context);const id=result.result!.jobId;
  await runAdminJobStep(f.db,f.b.storage,id);expect(await (await downloadAdminExportBody(f.db,f.b.storage,'operator',id,0)).text()).toBe('完整战报正文');
  f.sqlite.exec("UPDATE admin_audit_events SET created_at='2020-01-01'; UPDATE admin_jobs SET result_expires_at='2020-01-01' WHERE kind='export'");
  await expireAdminArtifacts(f.db,f.b.storage);expect(f.b.values.has(`admin/exports/${id}/0.body`)).toBe(false);
  expect(f.sqlite.prepare("SELECT count(*) n FROM admin_audit_events WHERE operation_id=(SELECT operation_id FROM admin_jobs WHERE id=?)").get(f.id)?.n).toBeGreaterThan(0);f.sqlite.close();
 });
 it('未知终结数据不允许清理',async()=>{
  const f=await objectFixture();f.sqlite.exec("UPDATE battle_report_generations SET extra_json='malformed'");await expect(previewAdminCleanup(f.db,{target:'large_objects',ids:['object']})).rejects.toThrow('ADMIN_CLEANUP_TARGET_NOT_ELIGIBLE');f.sqlite.close();
 });
 it('管理员以版本关闭 uncertain，幂等取消不会重新启动作业且 AI 结果到期清理',async()=>{
  const f=await objectFixture();f.sqlite.exec("UPDATE admin_jobs SET kind='ai-review',status='uncertain',cursor_json='{\"dispatched\":true}',updated_at='2020-01-01',result_expires_at='2020-01-01'");
  f.b.values.set(`admin/ai-results/${f.id}.json`,'建议');
  const input={id:f.id,expectedUpdatedAt:'2020-01-01',reason:'已核实供应商，关闭未知结果',idempotencyKey:'cancel-uncertain'};
  expect(await cancelAdminJob(f.db,input,f.context)).toHaveProperty('status','succeeded');expect(await cancelAdminJob(f.db,input,f.context)).toHaveProperty('replayed',true);
  await runAdminJobStep(f.db,f.b.storage,f.id);expect(f.sqlite.prepare('SELECT status FROM admin_jobs WHERE id=?').get(f.id)?.status).toBe('cancelled');
  await expireAdminArtifacts(f.db,f.b.storage);expect(f.b.values.has(`admin/ai-results/${f.id}.json`)).toBe(false);expect(JSON.parse(String(f.sqlite.prepare('SELECT cursor_json FROM admin_jobs WHERE id=?').get(f.id)?.cursor_json))).toEqual({dispatched:true,resultExpired:1});f.sqlite.close();
 });
 it('正文更新竞态使导出冲突且不允许下载混合快照',async()=>{
  const f=await objectFixture();const put=f.b.storage.put;f.b.storage.put=async(key,body)=>{await put(key,body);if(key.includes('/exports/')&&key.endsWith('.body'))f.sqlite.exec("UPDATE large_objects SET updated_at='2021-01-01'");};
  const result=await createAdminJob(f.db,{kind:'export',target:'generations',ids:['gen'],reason:'全文并发导出',idempotencyKey:'export-conflict'},f.context);const id=result.result!.jobId;
  await runAdminJobStep(f.db,f.b.storage,id);expect(f.sqlite.prepare('SELECT status,processed_count FROM admin_jobs WHERE id=?').get(id)).toEqual({status:'failed',processed_count:0});await expect(downloadAdminExportBody(f.db,f.b.storage,'operator',id,0)).rejects.toThrow('ADMIN_EXPORT_UNAVAILABLE');f.sqlite.close();
 });
 it('恢复进行中保留源备份和关联审计，结束后按期限有界清理',async()=>{
  const f=await objectFixture();await runAdminJobStep(f.db,f.b.storage,f.id);await runAdminJobStep(f.db,f.b.storage,f.id);
  const restored=await createAdminJob(f.db,{kind:'restore',sourceJobId:f.id,reason:'跨期恢复演练',idempotencyKey:'retention-restore'},f.context);
  f.sqlite.exec("UPDATE admin_jobs SET result_expires_at='2020-01-01' WHERE kind='cleanup'; UPDATE admin_audit_events SET created_at='2020-01-01'");
  await expireAdminArtifacts(f.db,f.b.storage);expect(f.b.values.has(`admin/recovery/${f.id}/0.body`)).toBe(true);
  expect(f.sqlite.prepare('SELECT count(*) n FROM admin_audit_events WHERE operation_id=(SELECT operation_id FROM admin_jobs WHERE id=?)').get(f.id)?.n).toBeGreaterThan(0);
  await runAdminJobStep(f.db,f.b.storage,restored.result!.jobId);await expireAdminArtifacts(f.db,f.b.storage);
  expect(f.b.values.has(`admin/recovery/${f.id}/0.body`)).toBe(false);f.sqlite.close();
 });
 it('终态恢复的R2孤儿到期删除；R2失败保留游标并可再次补偿',async()=>{
  const f=await objectFixture();await runAdminJobStep(f.db,f.b.storage,f.id);await runAdminJobStep(f.db,f.b.storage,f.id);
  const restore=await createAdminJob(f.db,{kind:'restore',sourceJobId:f.id,reason:'恢复失败演练',idempotencyKey:'orphan-restore'},f.context);const id=restore.result!.jobId;
  const put=f.b.storage.put;f.b.storage.put=async(key,body)=>{await put(key,body);if(key.startsWith('recovered/admin/'))f.sqlite.exec("UPDATE admin_jobs SET status='cancelled',lease_token=NULL WHERE kind='restore'");};
  await runAdminJobStep(f.db,f.b.storage,id);
  const key=`recovered/admin/${id}/0`;expect(f.b.values.has(key)).toBe(true);expect(f.sqlite.prepare('SELECT count(*) n FROM large_objects').get()?.n).toBe(0);
  f.sqlite.prepare("UPDATE admin_jobs SET result_expires_at='2020-01-01' WHERE id=?").run(id);
  const remove=f.b.storage.delete;f.b.storage.delete=async(candidate)=>{if(candidate===key)throw new Error('temporary R2 failure');await remove(candidate);};
  await expect(expireAdminArtifacts(f.db,f.b.storage)).rejects.toThrow('temporary R2 failure');
  expect(f.sqlite.prepare('SELECT cursor_json FROM admin_jobs WHERE id=?').get(id)?.cursor_json).toBeNull();
  f.b.storage.delete=remove;await expireAdminArtifacts(f.db,f.b.storage);
  expect(f.b.values.has(key)).toBe(false);expect(f.sqlite.prepare("SELECT count(*) n FROM admin_audit_events WHERE action='jobs.expire-restore-orphan'").get()?.n).toBe(1);f.sqlite.close();
 });
 it('失败恢复中已提交的正文仍被业务引用，到期补偿不能删除',async()=>{
  const f=await objectFixture();await runAdminJobStep(f.db,f.b.storage,f.id);await runAdminJobStep(f.db,f.b.storage,f.id);
  const restore=await createAdminJob(f.db,{kind:'restore',sourceJobId:f.id,reason:'部分恢复已引用保护',idempotencyKey:'referenced-restore'},f.context);const id=restore.result!.jobId;
  await runAdminJobStep(f.db,f.b.storage,id);
  // A partial restore can finish earlier items and fail a later item; emulate that terminal state for this referenced item.
  f.sqlite.prepare("UPDATE admin_jobs SET status='failed',result_expires_at='2020-01-01' WHERE id=?").run(id);
  await expireAdminArtifacts(f.db,f.b.storage);
  expect(f.b.values.has(`recovered/admin/${id}/0`)).toBe(true);expect(f.sqlite.prepare('SELECT count(*) n FROM large_objects').get()?.n).toBe(1);f.sqlite.close();
 });
 it('取消的detached旧对象到期补偿仍等待活动恢复，随后删除原文但保留tombstone',async()=>{
  const f=await objectFixture();await runAdminJobStep(f.db,f.b.storage,f.id);
  const updated=String(f.sqlite.prepare('SELECT updated_at FROM admin_jobs WHERE id=?').get(f.id)?.updated_at);
  await cancelAdminJob(f.db,{id:f.id,expectedUpdatedAt:updated,reason:'取消摘除作业',idempotencyKey:'cancel-detached'},f.context);
  const restore=await createAdminJob(f.db,{kind:'restore',sourceJobId:f.id,reason:'恢复前保留原文',idempotencyKey:'restore-detached'},f.context);
  f.sqlite.prepare("UPDATE admin_jobs SET result_expires_at='2020-01-01' WHERE id=?").run(f.id);
  await expireAdminArtifacts(f.db,f.b.storage);expect(f.b.values.has('business/body')).toBe(true);
  await runAdminJobStep(f.db,f.b.storage,restore.result!.jobId);
  await expireAdminArtifacts(f.db,f.b.storage);
  expect(f.b.values.has('business/body')).toBe(false);expect(f.b.values.has(`recovered/admin/${restore.result!.jobId}/0`)).toBe(true);
  expect(f.sqlite.prepare('SELECT count(*) n FROM admin_object_tombstones').get()?.n).toBe(1);f.sqlite.close();
 });
});
