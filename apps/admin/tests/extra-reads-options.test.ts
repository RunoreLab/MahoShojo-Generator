import { beforeEach, expect, test, vi } from 'vitest';
import type { AdminDatabase } from '@mahoshojo/hosted-runtime/admin/database';
import type { AdminPrivateBucket } from '@mahoshojo/hosted-runtime/admin/jobs';
const mocks=vi.hoisted(()=>({analytics:vi.fn(),matches:vi.fn()}));
vi.mock('@mahoshojo/hosted-runtime/admin/analytics',()=>({readAdminAnalytics:mocks.analytics,readAdminAvailability:vi.fn()}));
vi.mock('@mahoshojo/hosted-runtime/admin/arena-management',()=>({readAdminArenaRisk:vi.fn(),readAdminPvpRoomDetail:vi.fn(),readAdminPvpMatchDetail:vi.fn(),listAdminPvpMatches:mocks.matches}));
import { createExtraReads } from '../src/extra-reads';
const db={} as AdminDatabase;
const routes=createExtraReads(()=>db,()=>({}) as AdminPrivateBucket,{});
const request=(path:string)=>routes.find(route=>route.path===path.split('?')[0])!.execute(new Request('https://admin.test'+path),'operator','request');
beforeEach(()=>{mocks.analytics.mockResolvedValue({frequency:{sample:'all'}});mocks.matches.mockResolvedValue({items:[{id:'match'}],nextCursor:'match'});});

test('分析允许名单参数完整传给共享读取器；省略参数保留共享默认值',async()=>{
 await request('/api/admin/v1/analytics-summary?lookbackDays=365&sample=all&cohort=month&activeWindowDays=180');
 expect(mocks.analytics).toHaveBeenCalledWith(db,{lookbackDays:365,sample:'all',cohort:'month',activeWindowDays:180});
 await request('/api/admin/v1/analytics-summary');
 expect(mocks.analytics).toHaveBeenLastCalledWith(db,{lookbackDays:undefined,sample:undefined,cohort:undefined,activeWindowDays:undefined});
});
test.each(['lookbackDays=0','lookbackDays=366','lookbackDays=7.1','lookbackDays=1e2','lookbackDays=','sample=unknown','sample=','cohort=day','activeWindowDays=181','activeWindowDays=-1','lookbackDays=7&lookbackDays=30','sample=all&sample=tracked','cursor=anything','sql=SELECT'])('分析非法/重复/未声明参数在读取前返回400: %s',async suffix=>{
 await expect(request('/api/admin/v1/analytics-summary?'+suffix)).rejects.toMatchObject({status:400,code:'ADMIN_QUERY_INVALID'});
 expect(mocks.analytics).not.toHaveBeenCalled();
});
test('比赛分页透传游标及允许名单筛选，默认50且最多100',async()=>{
 const response=await request('/api/admin/v1/pvp-matches?roomId=room&cursor=match-2&limit=100&status=completed&userId=7');
 expect(mocks.matches).toHaveBeenCalledWith(db,{roomId:'room',cursor:'match-2',limit:100,status:'completed',userId:7});
 expect(await response.json()).toMatchObject({nextCursor:'match'});
 await request('/api/admin/v1/pvp-matches');expect(mocks.matches.mock.lastCall?.[1].limit).toBe(50);
});
test.each(['limit=101','limit=0','limit=1.5','limit=1e2','cursor=','roomId=','status=unknown','userId=0','userId=9007199254740992','cursor=a&cursor=b','order=created_at'])('比赛分页非法参数不查询数据库: %s',async suffix=>{
 await expect(request('/api/admin/v1/pvp-matches?'+suffix)).rejects.toMatchObject({status:400});expect(mocks.matches).not.toHaveBeenCalled();
});
test('服务读取失败继续抛出，不伪装为空数据',async()=>{
 mocks.analytics.mockRejectedValue(new Error('ADMIN_DATABASE_UNAVAILABLE'));
 await expect(request('/api/admin/v1/analytics-summary')).rejects.toThrow('ADMIN_DATABASE_UNAVAILABLE');
});
