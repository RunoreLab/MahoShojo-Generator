import { afterEach, expect, test, vi } from 'vitest';
import { adminManagementFixture } from './admin-management-fixture';
import { runScheduledAdminAnalyticsSnapshot } from '../src/admin/actions/analytics';
import { readAdminAnalytics } from '../src/admin/analytics';
const cleanup:Array<()=>void>=[];
afterEach(()=>{cleanup.splice(0).forEach(close=>close());vi.useRealTimers();});
async function fixture(capabilities=['analytics.write']){
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-12T00:10:00.000Z'));
 const f=await adminManagementFixture(capabilities);cleanup.push(()=>f.sqlite.close());return f;
}
test('每日一日一步并补最多七个缺日；重复cron不重采，不冒用Access身份',async()=>{
 const f=await fixture();
 expect(await runScheduledAdminAnalyticsSnapshot(f.db,'operator')).toEqual({ran:true,metricDate:'2026-09-12',approximateWindowMetrics:false});
 expect(f.sqlite.prepare('SELECT count(*) n FROM admin_user_analytics_daily').get()?.n).toBe(1);
 expect(await runScheduledAdminAnalyticsSnapshot(f.db,'operator')).toEqual({ran:true,metricDate:'2026-09-11',approximateWindowMetrics:true});
 for(let index=0;index<6;index++)await runScheduledAdminAnalyticsSnapshot(f.db,'operator');
 expect(await runScheduledAdminAnalyticsSnapshot(f.db,'operator')).toEqual({ran:false,reason:'up-to-date'});
 expect(f.sqlite.prepare('SELECT count(*) n,min(metric_date) oldest FROM admin_user_analytics_daily').get()).toEqual({n:8,oldest:'2026-09-05'});
 const audits=f.sqlite.prepare("SELECT request_id,reason,authn_context_safe_ref FROM admin_audit_events WHERE action='analytics.snapshot'").all();
 expect(audits).toHaveLength(8);expect(audits.every(row=>row.authn_context_safe_ref==='scheduled-delegation:operator'&&String(row.reason).includes('人类管理员委托'))).toBe(true);
 expect(new Set(audits.map(row=>row.request_id)).size).toBe(8);
});
test('未配置、撤权、缺能力和非人类principal不写快照或审计',async()=>{
 const f=await fixture();expect(await runScheduledAdminAnalyticsSnapshot(f.db,undefined)).toEqual({ran:false,reason:'not-configured'});
 f.sqlite.exec("UPDATE admin_principals SET status='disabled'");expect(await runScheduledAdminAnalyticsSnapshot(f.db,'operator')).toEqual({ran:false,reason:'delegation-inactive'});
 f.sqlite.exec("UPDATE admin_principals SET status='active',capabilities_json='[]'");expect(await runScheduledAdminAnalyticsSnapshot(f.db,'operator')).toEqual({ran:false,reason:'delegation-inactive'});
 f.sqlite.exec("UPDATE admin_principals SET kind='service',capabilities_json='[\"analytics.write\"]'");expect(await runScheduledAdminAnalyticsSnapshot(f.db,'operator')).toEqual({ran:false,reason:'delegation-inactive'});
 expect(f.sqlite.prepare('SELECT count(*) n FROM admin_user_analytics_daily').get()?.n).toBe(0);
 expect(f.sqlite.prepare("SELECT count(*) n FROM admin_audit_events WHERE action='analytics.snapshot'").get()?.n).toBe(0);
});
test('UTC 00:05前不采集，审计失败原子回滚，后续cron可重试',async()=>{
 const f=await fixture();vi.setSystemTime(new Date('2026-09-12T00:00:00.000Z'));
 expect(await runScheduledAdminAnalyticsSnapshot(f.db,'operator')).toEqual({ran:false,reason:'before-daily-window'});
 vi.setSystemTime(new Date('2026-09-12T00:10:00.000Z'));
 f.sqlite.exec("CREATE TRIGGER fail_scheduled_audit BEFORE INSERT ON admin_audit_events WHEN NEW.action='analytics.snapshot' BEGIN SELECT RAISE(IGNORE); END");
 await expect(runScheduledAdminAnalyticsSnapshot(f.db,'operator')).rejects.toThrow();
 expect(f.sqlite.prepare('SELECT count(*) n FROM admin_user_analytics_daily').get()?.n).toBe(0);
 f.sqlite.exec('DROP TRIGGER fail_scheduled_audit');expect(await runScheduledAdminAnalyticsSnapshot(f.db,'operator')).toMatchObject({ran:true,metricDate:'2026-09-12'});
});
test('活跃窗口兼容旧180天上限，并拒绝更大范围',async()=>{
 const f=await fixture();expect(await readAdminAnalytics(f.db,{activeWindowDays:180})).toHaveProperty('composition');
 await expect(readAdminAnalytics(f.db,{activeWindowDays:181})).rejects.toThrow('ADMIN_ANALYTICS_INPUT_INVALID');
});
