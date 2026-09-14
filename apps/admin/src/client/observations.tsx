import { useEffect, useState } from 'react';
import { api, outcomeState, parseJson, savedOperations, saveOperation, statusLabels, textValue, type Action, type Row } from './ui-model';
import { ActionPanel } from './action-panel';
import { AiReviewResult } from './ai-review-panel';

export function Values({ value, depth = 0 }: { value: unknown; depth?: number }) {
  const parsed = parseJson(value);
  if (parsed === null || parsed === undefined) return <span>—</span>;
  if (depth > 3 || typeof parsed !== 'object') return <span className="text-value">{textValue(parsed)}</span>;
  if (Array.isArray(parsed)) {
    if (!parsed.length) return <p className="empty-inline">暂无记录</p>;
    if (parsed.every(item => item && typeof item === 'object' && !Array.isArray(item))) {
      const columns = [...new Set(parsed.flatMap(item => Object.keys(item)))];
      return <div className="table-wrap"><table><thead><tr>{columns.map(key => <th key={key}>{key}</th>)}</tr></thead><tbody>{parsed.map((item, index) => <tr key={index}>{columns.map(key => <td key={key}><Values value={item[key]} depth={depth + 1} /></td>)}</tr>)}</tbody></table></div>;
    }
    return <ul>{parsed.map((item, index) => <li key={index}><Values value={item} depth={depth + 1} /></li>)}</ul>;
  }
  return <dl>{Object.entries(parsed).map(([key, item]) => <div key={key}><dt>{key}</dt><dd><Values value={item} depth={depth + 1} /></dd></div>)}</dl>;
}
export function Observation({ path, title }: { path: string; title: string }) {
  const [value, setValue] = useState<unknown>(); const [error, setError] = useState(''); const [refresh, setRefresh] = useState(0); const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true; setError(''); setLoading(true); setValue(undefined);
    api(path).then(data => { if (live) setValue(data); }).catch(e => { if (live) setError(e.message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [path, refresh]);
  return <section className="detail"><div className="section-title"><h2>{title}</h2><button className="quiet" disabled={loading} onClick={() => setRefresh(value => value + 1)}>刷新观测</button></div>{error ? <p role="alert" className="notice error">{error}</p> : loading ? <p role="status">正在读取…</p> : <>{(value as Row)?.stale === true && <p className="notice warning">快照已过期，以下为最后已知数据。</p>}<Values value={value} /></>}</section>;
}

export function Jobs({ actions = [], principalId }: { actions?: Action[]; principalId?: string }) {
  const [jobs, setJobs] = useState<Row[]>([]); const [error, setError] = useState(''); const [refresh, setRefresh] = useState(0); const [loading, setLoading] = useState(true); const [resultId, setResultId] = useState(() => typeof location === 'undefined' ? '' : new URLSearchParams(location.search).get('jobId') ?? '');
  const [cancelling, setCancelling] = useState<Row | null>(null);
  const cancelAction = actions.find(action => action.name === 'jobs.cancel');
  useEffect(() => { let live = true; setLoading(true); setError(''); api('jobs').then(value => { if (live) setJobs(value.items); }).catch(e => { if (live) setError(e.message); }).finally(() => { if (live) setLoading(false); }); return () => { live = false; }; }, [refresh]);
  return <><section className="detail"><div className="section-title"><h2>我的持久化作业</h2><button className="quiet" disabled={loading} onClick={() => setRefresh(value => value + 1)}>查询进度</button></div><p>作业在页面关闭后继续保存进度。结果不确定的 AI 请求不会自动重新调用。导出 24 小时后过期，下载时重新检查权限。</p>
    {error ? <p role="alert" className="notice error">{error}</p> : loading ? <p role="status">正在读取…</p> : !jobs.length ? <p>暂无作业</p> : jobs.map(job => {
      const expired = typeof job.result_expires_at === 'string' && Date.parse(job.result_expires_at) <= Date.now();
      return <article key={String(job.id)} className={job.id === resultId ? 'notice' : undefined}><h3>{job.kind === 'ai-review' ? 'AI 审核建议' : job.kind === 'export' ? '私有导出' : job.kind === 'restore' ? '恢复' : '业务清理'} · {statusLabels[String(job.status)] ?? String(job.status)}</h3><p>编号 {String(job.id)} · 已处理 {String(job.processed_count)} 条 · {textValue(job.error_code_safe)}</p><Values value={Object.fromEntries(Object.entries(job).filter(([key]) => !['id', 'kind', 'status', 'error_code_safe', 'processed_count'].includes(key)))} />
        {job.status === 'uncertain' && <p className="notice warning">请求可能已经执行或产生费用。请核对结果及服务端记录，禁止自动重复提交。</p>}
        {expired && <p>结果已过期。</p>}
        {job.kind === 'ai-review' && job.status === 'succeeded' && !expired && <button onClick={() => setResultId(String(job.id))}>查看审核建议与用量</button>}
        {cancelAction && principalId && ['queued', 'running', 'uncertain'].includes(String(job.status)) && <button className="quiet" onClick={() => setCancelling(job)}>核对并取消此作业</button>}
        {job.kind === 'export' && job.status === 'succeeded' && !expired && Array.from({ length: Math.min(100, Math.max(0, Number(job.processed_count) || 0)) }, (_, index) => <span className="download" key={index}><a className="button quiet" href={'/api/admin/v1/export-download?id=' + encodeURIComponent(String(job.id)) + '&part=' + index}>下载第 {index + 1} 条</a>{job.target === 'generations' && <a className="button quiet" href={'/api/admin/v1/export-body?id=' + encodeURIComponent(String(job.id)) + '&part=' + index}>战报正文 {index + 1}</a>}</span>)}
      </article>;
    })}</section>{cancelling && cancelAction && principalId && <ActionPanel key={String(cancelling.id) + ':' + String(cancelling.updated_at)} action={cancelAction} selected={cancelling} principalId={principalId} close={() => setCancelling(null)} applied={() => setRefresh(value => value + 1)} />}{resultId && jobs.some(job => job.id === resultId && job.kind === 'ai-review') && <AiReviewResult key={resultId} jobId={resultId} actions={actions} principalId={principalId} />}</>;
}

export function OperationHistory({ principalId }: { principalId: string }) {
  const [entries, setEntries] = useState(() => savedOperations(principalId)); const [value, setValue] = useState<unknown>(); const [error, setError] = useState(''); const [key, setKey] = useState('');
  useEffect(() => { const update = () => setEntries(savedOperations(principalId)); update(); window.addEventListener('admin-operations-changed', update); window.addEventListener('storage', update); return () => { window.removeEventListener('admin-operations-changed', update); window.removeEventListener('storage', update); }; }, [principalId]);
  async function query(operationKey: string) {
    setError(''); setValue(undefined); setKey(operationKey);
    try { const result = await api('operation?idempotencyKey=' + encodeURIComponent(operationKey)); setValue(result); const entry = entries.find(item => item.key === operationKey); if (entry) saveOperation(principalId, { ...entry, state: outcomeState(result) }); }
    catch (e) { setError(e instanceof Error ? e.message : '查询失败'); }
  }
  return <section className="detail"><h2>操作恢复与查询</h2><p>本浏览器保留最近 100 次提交的查询键，刷新或切换页面后仍可查询。这里只会读取状态，不会重复执行操作。其他设备可粘贴操作键查询。</p><form className="toolbar" onSubmit={event => { event.preventDefault(); void query(key); }}><label>操作查询键<input value={key} required maxLength={128} onChange={e => setKey(e.target.value)} /></label><button>只读查询</button></form>
    {error && <p className="notice error" role="alert">{error}</p>}{value !== undefined && <><p className="notice">{statusLabels[outcomeState(value)] ?? outcomeState(value)}</p><Values value={value} /></>}
    {!entries.length ? <p>此浏览器暂无提交记录。</p> : <div className="table-wrap"><table><thead><tr><th>操作</th><th>提交时间</th><th>最后已知状态</th><th>查询键</th><th>查询</th></tr></thead><tbody>{[...entries].reverse().map(entry => <tr key={entry.key}><td>{entry.label}</td><td>{entry.createdAt}</td><td>{statusLabels[entry.state] ?? entry.state}</td><td><code>{entry.key}</code></td><td><button className="quiet" onClick={() => void query(entry.key)}>查询状态</button></td></tr>)}</tbody></table></div>}
  </section>;
}
export function AuditEvents() {
  const [page, setPage] = useState<{ items: Row[]; nextCursor?: string }>({ items: [] }); const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  const cursor = new URLSearchParams(location.search).get('cursor');
  useEffect(() => { let live = true; api('audit-events' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : '')).then(value => { if (live) setPage(value); }).catch(e => { if (live) setError(e.message); }).finally(() => { if (live) setLoading(false); }); return () => { live = false; }; }, [cursor]);
  return <section className="detail"><h2>管理操作审计</h2><p>审计保留 180 天，记录操作主体、范围、理由与结果。待终结作业的关联记录保留至终结。</p>{error ? <p role="alert" className="notice error">{error}</p> : loading ? <p>正在读取…</p> : <Values value={page.items} />}{page.nextCursor && <a className="button" href={'/?view=audit-events&cursor=' + encodeURIComponent(page.nextCursor)}>下一页 →</a>}</section>;
}

export function RelatedDetails({ resource, selected }: { resource: string; selected: Row }) {
  const reports = parseJson(selected.reports); const badges = parseJson(selected.badges);
  const [reportId, setReportId] = useState(''); const [matchId, setMatchId] = useState('');
  return <>
    {Array.isArray(reports) && reports.length > 0 && <section className="detail"><h2>举报原始材料</h2><div className="actions">{reports.map(report => <button className="quiet" key={report.id} onClick={() => setReportId(String(report.id))}>举报 {String(report.id)}</button>)}</div>{reportId && <Observation path={'report-detail?id=' + encodeURIComponent(reportId)} title="举报详情与引用快照" />}</section>}
    {Array.isArray(badges) && badges.length > 0 && <section className="detail"><h2>徽章持有记录</h2><Values value={badges} /><p>撤销时需要对应持有记录编号及获得时间。</p>{badges.map(badge => <a className="button quiet" key={String(badge.assignmentId)} href={'/?' + new URLSearchParams({ view: 'badges', id: String(badge.badge_id), assignmentId: String(badge.assignmentId), obtainedAt: String(badge.obtainedAt), userId: String(selected.id), action: 'badges.revoke' })}>管理徽章 {String(badge.badge_id)}</a>)}</section>}
    {resource === 'pvp-rooms' && <><Observation path={'pvp-room-detail?id=' + encodeURIComponent(String(selected.id))} title="房间、比赛与恢复诊断" /><Observation path={'pvp-matches?roomId=' + encodeURIComponent(String(selected.id))} title="房间比赛列表" /><form className="toolbar" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); setMatchId(String(form.get('matchId'))); }}><label>比赛编号<input name="matchId" required defaultValue={String(selected.current_match_id ?? '')} /></label><button>查看比赛详情</button></form>{matchId && <Observation path={'pvp-match-detail?id=' + encodeURIComponent(matchId)} title="比赛与恢复上下文" />}</>}
  </>;
}
