import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ADMIN_RESOURCES, type AdminResource, type AdminReadResponse } from '@mahoshojo/contracts/admin';
import { ActionPanel } from './action-panel';
import { AiReviewPanel } from './ai-review-panel';
import { ContentUpdateDiff } from './content-diff';
import { selectedExportIds } from './export-model';
import { AuditEvents, Jobs, Observation, OperationHistory, RelatedDetails, Values } from './observations';
import { api, batchItemAction, cleanQuery, fieldValue, isVersion, textValue, type Action, type Row } from './ui-model';
import './app.css';

const titles: Record<AdminResource, string> = {
  dashboard: '运营概览', users: '用户', 'user-accounts': '账号安全计数', 'data-cards': '内容卡片', 'data-card-updates': '待审更新',
  tags: '标签', 'tag-aliases': '标签别名', badges: '徽章', 'redemption-codes': '兑换码', messages: '站点消息', 'user-messages': '用户消息',
  'report-cases': '举报案件', 'report-appeals': '申诉', 'crowd-review': '众裁案件', inspectors: '巡查员', ratings: '竞技评分', 'rating-events': '积分事件',
  'risk-audits': '风险审计', generations: '生成记录', 'pvp-rooms': '旧 PVP 房间', 'large-objects': '对象与业务维护', analytics: '活跃分析', 'ai-availability': '渠道可用性',
};
const specials: Record<string, string> = { 'arena-observation': '新多人只读观测', jobs: '作业与下载', operations: '操作恢复与查询', models: '可用模型', 'audit-events': '管理操作审计' };
const labels: Record<string, string> = { id: '编号', name: '名称', username: '用户名', user_id: '用户编号', created_at: '创建时间', updated_at: '更新时间', title: '标题', status: '状态', type: '类型', is_public: '可见性', review_status: '审核状态', description: '描述', data: '内容', content: '正文', metric_date: '统计日期', expires_at: '到期时间', currentCard: '当前卡片（与待审更新对照）', currentCase: '当前举报案件', reports: '相关举报', badges: '持有徽章', users: '用户总数', cards: '有效卡片', pending_cards: '待审卡片', open_cases: '待处理案件', authentication_events: '认证事件数', reset_requests: '密码重置请求数', verifications: '验证记录数', account_links: '账号关联数' };
const searchResources = ['users', 'user-accounts', 'data-cards', 'data-card-updates', 'tags', 'tag-aliases', 'badges', 'messages', 'user-messages', 'ratings', 'generations', 'ai-availability'];
const userResources = ['user-accounts', 'data-cards', 'data-card-updates', 'user-messages', 'report-cases', 'report-appeals', 'inspectors', 'rating-events', 'risk-audits', 'generations', 'pvp-rooms', 'large-objects'];
const statuses: Record<string, string[]> = { users: ['active', 'banned'], 'data-cards': ['pending', 'approved', 'rejected'], tags: ['user', 'system', 'admin'], 'report-cases': ['open', 'under_review', 'resolved', 'dismissed'], 'report-appeals': ['submitted', 'under_review', 'resolved', 'withdrawn'], 'crowd-review': ['pending_dispatch', 'active', 'waiting_more_votes', 'concluded', 'escalated', 'cancelled'], inspectors: ['active', 'suspended', 'revoked'], ratings: ['strict', 'free'], 'rating-events': ['pending', 'applied', 'skipped', 'failed'], 'risk-audits': ['skipped', 'failed'], generations: ['started', 'completed', 'aborted', 'failed'] };

function App() {
  const initial = new URLSearchParams(location.search); const view = initial.get('view') ?? 'dashboard';
  const resource = ADMIN_RESOURCES.includes(view as AdminResource) ? view as AdminResource : 'dashboard'; const special = Object.hasOwn(specials, view);
  const [session, setSession] = useState<{ principalId: string; capabilities: string[] } | null>(null);
  const [data, setData] = useState<AdminReadResponse | null>(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  const [actions, setActions] = useState<Action[]>([]); const [actionError, setActionError] = useState('');
  const [selected, setSelected] = useState<Row | null>(null); const [active, setActive] = useState<Action | null>(null);
  const [refresh, setRefresh] = useState(0); const [detailLoading, setDetailLoading] = useState(false); const [checked, setChecked] = useState<string[]>([]);
  const detailSequence = useRef(0); const actionSection = useRef<HTMLDivElement>(null);
  useEffect(() => {
    api('/api/admin/session').then(setSession).catch(e => setError(e.message));
    api('actions').then(value => setActions(value.actions)).catch(e => setActionError(e.message));
  }, []);
  useEffect(() => {
    let live = true; setLoading(true); setError(''); setChecked([]);
    if (special) { setLoading(false); return; }
    const allowed = ['id', 'q', 'status', 'visibility', 'userId', 'limit', 'cursor'];
    if (resource === 'badges' && initial.get('action') === 'badges.revoke') allowed.splice(allowed.indexOf('userId'), 1);
    const query = cleanQuery(new URLSearchParams(location.search), allowed);
    api(resource + '?' + query).then(value => { if (live) { setData(value); if (query.has('id') && value.items[0]) setSelected(previous => previous ?? value.items[0]); } }).catch(e => { if (live) { setData(null); setError(e.message); } }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [resource, refresh, special]);
  useEffect(() => { if (selected && initial.get('action') === 'badges.revoke') setActive(actions.find(action => action.name === 'badges.revoke') ?? null); }, [actions, selected]);
  const rows = data?.items ?? []; const columns = rows.length ? Object.keys(rows[0]).filter(key => !['data', 'content', 'payload_json'].includes(key) && !isVersion(key)).slice(0, 8) : [];
  const applicable = actions.filter(action => action.name !== 'jobs.cancel' && (action.resource === resource || (['ai.review', 'jobs.export'].includes(action.name) && (resource === 'data-cards' || (action.name === 'ai.review' && resource === 'data-card-updates'))))).map(action => ({ ...action, resource }));
  async function detail(row: Row) {
    const sequence = ++detailSequence.current; setDetailLoading(true); setActive(null); setSelected(null); setError('');
    try {
      const found = row.id === undefined ? row : (await api(resource + '?id=' + encodeURIComponent(String(row.id)))).items[0];
      if (sequence === detailSequence.current) { if (!found) throw new Error('记录已删除或已不可见。'); setSelected(found); }
    } catch (e) { if (sequence === detailSequence.current) setError(e instanceof Error ? e.message : '详情读取失败'); }
    finally { if (sequence === detailSequence.current) setDetailLoading(false); }
  }
  async function openAction(action: Action) {
    setActionError('');
    if (action.name === 'jobs.export') {
      try { const exportIds = selectedExportIds(checked, selected); setSelected({ exportIds, name: `${exportIds.length} 条选中记录` }); }
      catch (e) { setActionError(e instanceof Error ? e.message : '导出范围无效'); return; }
    }
    if (action.name === 'ai.review') {
      const ids = checked.length ? [...checked] : selected?.id ? [String(selected.id)] : [];
      if (!ids.length || ids.length > 10) { setActionError('AI 审核每次请选择 1–10 项，或先查看一条详情。'); return; }
      setDetailLoading(true);
      try {
        const details = await Promise.all(ids.map(id => api(resource + '?id=' + encodeURIComponent(id))));
        if (details.some(value => !value.items[0])) throw new Error('目标已不可见，请重新选择。');
        setSelected({ aiRows: details.map(value => value.items[0]), name: `${ids.length} 项 AI 审核` });
      } catch (e) { setActionError(e instanceof Error ? e.message : '读取审核范围失败'); return; }
      finally { setDetailLoading(false); }
    }
    if (action.name.endsWith('.batch') && !checked.length) { setActionError('请先勾选需要批量处理的记录。'); return; }
    if (action.name.endsWith('.batch') && checked.length) {
      setDetailLoading(true);
      try {
        const base = batchItemAction(action, actions); const items: Row[] = [];
        if (!base) throw new Error('批量字段目录不可用，请重新加载操作目录。');
        for (let offset = 0; offset < checked.length; offset += 5) {
          const details = await Promise.all(checked.slice(offset, offset + 5).map(id => api(resource + '?id=' + encodeURIComponent(id))));
          for (const response of details) {
            if (!response.items[0]) throw new Error('选中目标已不可见，请重新查询列表。');
            items.push(base ? Object.fromEntries(base.fields.map(field => [field.name, fieldValue(base, field, response.items[0]) ?? ''])) : response.items[0]);
          }
        }
        setSelected({ batchItems: items, name: `${items.length} 条已选记录` });
      } catch (e) { setActionError(e instanceof Error ? e.message : '批量目标读取失败'); return; }
      finally { setDetailLoading(false); }
    }
    setActive(action); requestAnimationFrame(() => actionSection.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }
  function filterSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const query = cleanQuery(new URLSearchParams(new FormData(event.currentTarget) as unknown as Record<string, string>)); location.assign('/?' + query);
  }
  let actionSelection = selected;
  if (active?.name === 'badges.revoke' && selected && initial.get('action') === 'badges.revoke') actionSelection = { ...selected, userId: initial.get('userId'), assignmentId: initial.get('assignmentId'), obtainedAt: initial.get('obtainedAt') };
  return <div className="workspace"><aside><a className="brand" href="/">MAHOSHOJO<span>管理工作台</span></a><nav aria-label="管理导航">{ADMIN_RESOURCES.map(item => <a key={item} href={'/?view=' + item} aria-current={!special && resource === item ? 'page' : undefined}>{titles[item]}</a>)}{Object.entries(specials).map(([key, label]) => <a key={key} href={'/?view=' + key} aria-current={view === key ? 'page' : undefined}>{label}</a>)}</nav><footer>{session?.principalId ?? '身份验证中'}<a href="/cdn-cgi/access/logout">退出登录</a></footer></aside>
    <main><header><div className="eyebrow">网站运营 / {special ? specials[view] : titles[resource]}</div><h1>{special ? specials[view] : titles[resource]}</h1><p>查看记录、核对上下文，再执行管理操作。</p></header>
      {special ? <>{view === 'jobs' && <Jobs actions={actions} principalId={session?.principalId} />}{view === 'operations' && session && <OperationHistory principalId={session.principalId} />}{view === 'models' && <Observation path="models" title="已配置的 Provider 与模型（只读）" />}{view === 'audit-events' && <AuditEvents />}{view === 'arena-observation' && <><form method="get" className="toolbar" onSubmit={filterSubmit}><input type="hidden" name="view" value={view} /><label>房间编号<input name="roomId" defaultValue={initial.get('roomId') ?? ''} /></label><button>查看房间</button><a className="button quiet" href="/?view=arena-observation">房间列表</a></form><ArenaPage query={cleanQuery(initial, ['roomId', 'cursor'])} /></>}</>
      : <>{resource !== 'dashboard' && <div className="toolbar"><form method="get" onSubmit={filterSubmit}><input type="hidden" name="view" value={resource} /><label>记录编号<input name="id" defaultValue={initial.get('id') ?? ''} placeholder="精确查询" /></label>
        {searchResources.includes(resource) && <label>关键词<input name="q" defaultValue={initial.get('q') ?? ''} /></label>}{userResources.includes(resource) && <label>用户编号<input name="userId" type="number" min="1" defaultValue={initial.get('userId') ?? ''} /></label>}
        {statuses[resource] && <label>{resource === 'tags' ? '标签范围' : resource === 'ratings' ? '队列' : '状态'}<select name="status" defaultValue={initial.get('status') ?? ''}><option value="">全部</option>{statuses[resource].map(status => <option key={status}>{status}</option>)}</select></label>}
        {resource === 'data-cards' && <label>可见性<select name="visibility" defaultValue={initial.get('visibility') ?? ''}><option value="">全部</option><option value="-1">封禁</option><option value="0">私有</option><option value="1">公开</option></select></label>}
        <label>每页<select name="limit" defaultValue={initial.get('limit') ?? '50'}><option>25</option><option>50</option><option>100</option></select></label><button type="submit">查询</button><a className="button quiet" href={'/?view=' + resource}>重置</a></form><button className="quiet" disabled={loading} onClick={() => setRefresh(value => value + 1)}>刷新列表</button></div>}
        {actionError && <p className="notice error" role="alert">操作目录或上下文不可用：{actionError}</p>}{error && <div role="alert" className="notice error">{error}</div>}
        {loading ? <div className="empty" role="status">正在读取…</div> : !error && !rows.length ? <div className="empty"><h2>暂无符合条件的记录</h2><p>可调整筛选条件后再次查询。</p></div> : !error && (resource === 'dashboard' ? <section className="summary-grid">{Object.entries(rows[0]).map(([key, value]) => <article key={key}><p>{labels[key] ?? key}</p><strong>{textValue(value)}</strong></article>)}</section> : <section className="table-wrap" aria-label={titles[resource]}><table><thead><tr><th><input type="checkbox" aria-label="选择当前页" checked={rows.length > 0 && checked.length === rows.length} onChange={event => setChecked(event.target.checked ? rows.slice(0, 100).map(row => String(row.id)) : [])} /></th>{columns.map(key => <th key={key}>{labels[key] ?? key}</th>)}<th>详情</th></tr></thead><tbody>{rows.map((row, index) => <tr key={String(row.id ?? index)} aria-selected={selected?.id === row.id}><td><input type="checkbox" aria-label={'选择记录 ' + row.id} checked={checked.includes(String(row.id))} onChange={event => setChecked(values => event.target.checked ? [...values, String(row.id)].slice(0, 100) : values.filter(id => id !== String(row.id)))} /></td>{columns.map(key => <td key={key}><span>{key === 'is_public' ? ({ '-1': '封禁', '0': '私有', '1': '公开' }[String(row[key])] ?? '未知') : textValue(row[key])}</span></td>)}<td><button className="quiet" disabled={detailLoading} onClick={() => void detail(row)}>查看</button></td></tr>)}</tbody></table></section>)}
        <div className="pagination"><span>{rows.length} 条记录{checked.length > 0 && ` · 已选 ${checked.length} 条`}</span>{initial.has('cursor') && <a className="button quiet" href={(() => { const first = cleanQuery(initial); first.delete('cursor'); return '/?' + first; })()}>返回第一页</a>}{data?.nextCursor && <a className="button" href={(() => { const next = cleanQuery(initial); next.set('view', resource); next.set('cursor', data.nextCursor!); return '/?' + next; })()}>下一页 →</a>}</div>
        {detailLoading && <p role="status">正在读取详情与版本…</p>}
        {selected && !selected.aiRows && <section className="detail"><div className="section-title"><h2>记录详情</h2><div className="actions">{selected.id !== undefined && <button className="quiet" disabled={detailLoading} onClick={() => void detail(selected)}>刷新详情与版本</button>}<button className="quiet" onClick={() => { setSelected(null); setActive(null); }}>收起</button></div></div><dl>{Object.entries(selected).filter(([key]) => !isVersion(key) && key !== 'batchItems').map(([key, value]) => <div key={key}><dt>{labels[key] ?? key}</dt><dd><Values value={value} /></dd></div>)}</dl></section>}
        {selected?.id && resource === 'data-card-updates' && <section className="detail"><ContentUpdateDiff selected={selected} /></section>}
        {selected && <RelatedDetails key={String(selected.id)} resource={resource} selected={selected} />}
        {applicable.length > 0 && <section className="detail"><h2>管理操作</h2><p>修改现有记录前先查看详情；批量操作逐项核对版本，最多选择 100 条。未显示的写能力尚未启用或无权限。</p><div className="actions">{applicable.map(action => <button key={action.name} disabled={detailLoading} onClick={() => void openAction(action)}>{action.label}</button>)}</div></section>}
        <div ref={actionSection}>{active && session && (active.name === 'ai.review' ? <AiReviewPanel key={JSON.stringify(selected?.aiRows)} resource={resource} rows={selected?.aiRows as Row[] ?? []} actions={actions} principalId={session.principalId} close={() => setActive(null)} /> : <ActionPanel key={active.name + ':' + String(selected?.id ?? '') + ':' + String(selected?.expectedVersion ?? '') + ':' + JSON.stringify(selected?.batchItems ?? null) + ':' + JSON.stringify(selected?.exportIds ?? null)} action={active} baseAction={batchItemAction(active, actions)} selected={actionSelection} principalId={session.principalId} close={() => setActive(null)} applied={() => setRefresh(value => value + 1)} />)}</div>
        {resource === 'analytics' && <Observation path="analytics-summary" title="活跃、频次与历史估算" />}{resource === 'ai-availability' && <Observation path="availability-summary" title="渠道观测与快照新鲜度" />}{resource === 'risk-audits' && <Observation path="risk-summary" title="风险聚合" />}
      </>}{special && error && <p role="alert" className="notice error">{error}</p>}
    </main></div>;
}
function ArenaPage({ query }: { query: URLSearchParams }) {
  const [value, setValue] = useState<any>(); const [error, setError] = useState('');
  const path = query.toString();
  useEffect(() => { let live = true; api('arena-observation?' + path).then(result => { if (live) setValue(result); }).catch(e => { if (live) setError(e.message); }); return () => { live = false; }; }, [path]);
  return <section className="detail"><h2>房间观测</h2><p>此接口仅读取目录和现有检查点，不唤醒房间、不延长存活时间。</p>{error ? <p role="alert">{error}</p> : value === undefined ? <p>正在读取…</p> : <><Values value={value} />{value.nextCursor && <a className="button" href={'/?view=arena-observation&cursor=' + encodeURIComponent(value.nextCursor)}>下一页 →</a>}</>}</section>;
}
createRoot(document.getElementById('root')!).render(<App />);
