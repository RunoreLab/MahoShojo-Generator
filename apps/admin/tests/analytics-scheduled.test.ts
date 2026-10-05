import { expect, test, vi } from 'vitest';
const mocks=vi.hoisted(()=>({snapshot:vi.fn(async()=>({ran:false})),expire:vi.fn(async()=>({})),scan:vi.fn(async()=>[])}));
vi.mock('@mahoshojo/hosted-runtime/admin/actions/analytics',async importOriginal=>({...await importOriginal<typeof import('@mahoshojo/hosted-runtime/admin/actions/analytics')>(),runScheduledAdminAnalyticsSnapshot:mocks.snapshot}));
vi.mock('@mahoshojo/hosted-runtime/admin/jobs',async importOriginal=>({...await importOriginal<typeof import('@mahoshojo/hosted-runtime/admin/jobs')>(),expireAdminArtifacts:mocks.expire,scanAdminJobs:mocks.scan}));
import { createAdminWorker, type AdminRuntimeBindings } from '../src/index';

test('定时采集由writer开关控制且只使用当次委托与binding；关闭采集仍维护作业与过期审计',async()=>{
 const worker=createAdminWorker();const first={DB:{},ADMIN_ENABLED_ACTIONS:'[]',ADMIN_ANALYTICS_PRINCIPAL_ID:'first'} as unknown as AdminRuntimeBindings;
 await worker.scheduled({},first);expect(mocks.snapshot).not.toHaveBeenCalled();expect(mocks.expire).toHaveBeenCalledTimes(1);expect(mocks.scan).toHaveBeenCalledTimes(1);
 first.ADMIN_ENABLED_ACTIONS='["analytics.snapshot"]';await worker.scheduled({},first);
 expect(mocks.snapshot).toHaveBeenLastCalledWith(first.DB,'first');
 const second={...first,DB:{},ADMIN_ANALYTICS_PRINCIPAL_ID:'second'} as AdminRuntimeBindings;
 await worker.scheduled({},second);expect(mocks.snapshot).toHaveBeenLastCalledWith(second.DB,'second');
});

test('错误的混合writer配置拒绝定时写入，不能只忽略未知动作',async()=>{
 mocks.snapshot.mockClear();
 const env={DB:{},ADMIN_ENABLED_ACTIONS:'["analytics.snapshot","unknown.writer"]',ADMIN_ANALYTICS_PRINCIPAL_ID:'operator'} as unknown as AdminRuntimeBindings;
 await expect(createAdminWorker().scheduled({},env)).rejects.toThrow('ADMIN_ACTION_CONFIG_INVALID');
 expect(mocks.snapshot).not.toHaveBeenCalled();
});
