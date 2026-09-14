import { useEffect, useRef, useState } from 'react';
import { AI_PROVIDER_CATALOG, CUSTOM_AI_MODEL_OPTION_VALUE, resolveAIProviderModel } from '@mahoshojo/ai-core/provider-catalog';
import { AdminAiReviewResultSchema } from '@mahoshojo/contracts/admin';
import { api, statusLabels, textValue, type Action, type Row } from './ui-model';
import { decisionItem, initialReviewDecision, reviewContextMatches, reviewTarget, submitReviewOperation, type ReviewResult } from './ai-review-model';
import { OperationFeedback } from './operation-feedback';

export function AiReviewPanel({ resource, rows, principalId, actions, close }: {
  resource: string; rows: Row[]; principalId: string; actions: Action[]; close(): void;
}) {
  const [providerId, setProviderId] = useState('system'); const [modelId, setModelId] = useState('default');
  const [customModel, setCustomModel] = useState(''); const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<string[]>([]); const [modelError, setModelError] = useState('');
  const [reason, setReason] = useState(''); const [error, setError] = useState(''); const [pending, setPending] = useState(false);
  const [confirmed, setConfirmed] = useState(false); const [jobId, setJobId] = useState(''); const [key, setKey] = useState('');
  const [newAttempt, setNewAttempt] = useState(false);
  const sending = useRef(false);
  useEffect(() => { let live = true;
    api('models').then(value => { if (live) setModels([...new Set<string>(value.items.map((item: { model: string }) => item.model))]); })
      .catch(e => { if (live) setModelError(e.message); });
    return () => { live = false; };
  }, []);
  const provider = AI_PROVIDER_CATALOG.find(item => item.id === providerId)!;
  const choices = providerId === 'system' ? [{ value: 'default', label: '默认模型' }, ...models.filter(id => id !== 'default').map(id => ({ value: id, label: id }))] : provider.models;
  const resolvedModel = modelId === CUSTOM_AI_MODEL_OPTION_VALUE ? customModel.trim() : modelId;
  async function submit() {
    if (sending.current) return;
    sending.current = true; setPending(true); setError('');
    try {
      if (rows.length < 1 || rows.length > 10) throw new Error('每次请选择 1–10 项。');
      if (providerId !== 'system' && (!apiKey.trim() || !resolveAIProviderModel(provider, resolvedModel))) throw new Error('请填写有效模型与 API Key。');
      const payload = { targets: rows.map(row => reviewTarget(resource, row)), selection: { providerId, modelId: resolvedModel }, reason: reason.trim() };
      const result = await submitReviewOperation(principalId, { name: 'ai.review', label: '生成 AI 审核建议' }, payload, providerId === 'system' ? undefined : apiKey.trim(), newAttempt);
      setKey(result.record.key); setConfirmed(false);
      const job = result.outcome.result as Row | null;
      if (job?.jobId) setJobId(String(job.jobId));
      else throw new Error('未能创建作业，请查询操作记录。');
    } catch (e) { setError((e instanceof Error ? e.message : '请求中断') + ' 请先查询操作记录，不要重复调用。'); }
    finally { setApiKey(''); setPending(false); sending.current = false; }
  }
  return <section className="detail" aria-label="AI 辅助审核"><div className="section-title"><h2>AI 辅助审核</h2><button className="quiet" disabled={pending} onClick={close}>关闭</button></div>
    <p>本次 {rows.length} 项。仅生成建议，最终审核需人工确认。BYOK 密钥只用于本次请求，关闭页面后可查询已保存结果，但不保证继续生成。</p>
    <ul>{rows.map(row => <li key={String(row.id)}>{String(row.name ?? row.id)} · {String(row.id)}</li>)}</ul>
    {!jobId && <form className="action-form" onSubmit={e => { e.preventDefault(); setConfirmed(true); }}>
      <fieldset disabled={pending || confirmed}><legend>AI 渠道</legend>
        <label>供应商<select value={providerId} onChange={e => { const next = AI_PROVIDER_CATALOG.find(item => item.id === e.target.value)!; setProviderId(next.id); setModelId(next.models[0]?.value ?? 'default'); setApiKey(''); setCustomModel(''); }}>{AI_PROVIDER_CATALOG.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>模型<select value={modelId} onChange={e => setModelId(e.target.value)}>{choices.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}{providerId !== 'system' && !choices.some(item => item.value === CUSTOM_AI_MODEL_OPTION_VALUE) && <option value={CUSTOM_AI_MODEL_OPTION_VALUE}>自定义模型</option>}</select></label>
        {modelId === CUSTOM_AI_MODEL_OPTION_VALUE && <label>模型 ID<input value={customModel} required maxLength={200} onChange={e => setCustomModel(e.target.value)} /></label>}
        {providerId !== 'system' && <label>API Key<input type="password" value={apiKey} required autoComplete="off" maxLength={4096} onChange={e => setApiKey(e.target.value)} /></label>}
        {providerId === 'system' && (modelError || !models.length) && <p role="status">{modelError || '系统渠道暂无可用配置，可选择 BYOK。'}</p>}
        <label>操作理由<textarea value={reason} required maxLength={1000} onChange={e => setReason(e.target.value)} /></label>
        {error && <label><input type="checkbox" checked={newAttempt} onChange={e => setNewAttempt(e.target.checked)} />将已完成或执行前失败的同范围作业作为新请求（可能再次计费，提交前会核实上次状态）</label>}
      </fieldset>
      {!confirmed && <button disabled={pending || (providerId === 'system' && !models.length)}>核对审核范围</button>}
      {confirmed && <div className="confirmation"><h3>确认生成建议</h3><p>{provider.name} · {resolvedModel} · {rows.length} 项</p><p>{reason}</p><button type="button" disabled={pending} onClick={() => void submit()}>{pending ? '正在提交…' : '确认调用 AI'}</button><button type="button" className="quiet" disabled={pending} onClick={() => setConfirmed(false)}>返回修改</button></div>}
    </form>}
    {error && <p role="alert" className="notice error">{error}</p>}
    <p><a className="button quiet" href="/?view=operations">操作恢复与查询</a>{key && <> 查询键：<code>{key}</code></>}</p>
    {jobId && <AiReviewResult jobId={jobId} actions={actions} principalId={principalId} />}
  </section>;
}

export function AiReviewResult({ jobId, actions, principalId }: { jobId: string; actions: Action[]; principalId?: string }) {
  const [result, setResult] = useState<ReviewResult>(); const [details, setDetails] = useState<Record<string, Row>>({});
  const [decisions, setDecisions] = useState<Record<string, string>>({}); const [acknowledged, setAcknowledged] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [status, setStatus] = useState('');
  const [reason, setReason] = useState(''); const [confirmKind, setConfirmKind] = useState<'card' | 'update' | null>(null);
  const [outcomes, setOutcomes] = useState<Array<{ outcome: Row; targets: string[] }>>([]); const [pending, setPending] = useState(false); const [submitted, setSubmitted] = useState<string[]>([]);
  const sending = useRef(false); const generation = useRef(0);
  async function load() {
    const sequence = ++generation.current; setLoading(true); setError(''); setConfirmKind(null);
    try {
      const jobs = await api('jobs'); if (sequence !== generation.current) return;
      const job = jobs.items.find((item: Row) => item.id === jobId);
      if (!job) throw new Error('作业不可见或已过期。');
      setStatus(String(job.status));
      if (job.status !== 'succeeded') { setResult(undefined); return; }
      const value = AdminAiReviewResultSchema.parse(await api('ai-review-result?id=' + encodeURIComponent(jobId)));
      const found: Record<string, Row> = {};
      await Promise.all((value.contexts ?? []).map(async context => {
        const response = await api((context.kind === 'card' ? 'data-cards' : 'data-card-updates') + '?id=' + encodeURIComponent(context.targetId));
        if (response.items[0]) found[context.id] = response.items[0];
      }));
      if (sequence !== generation.current) return;
      setResult({ ...value, contexts: value.contexts ?? [] }); setDetails(found); setAcknowledged({});
      setDecisions(Object.fromEntries(value.reviews.map(review => [review.id, initialReviewDecision(review.suggestion, value.contexts?.find(context => context.id === review.id), found[review.id])])));
    } catch (e) { if (sequence === generation.current) { setResult(undefined); setError(e instanceof Error ? e.message : '查询失败'); } }
    finally { if (sequence === generation.current) setLoading(false); }
  }
  useEffect(() => { void load(); return () => { generation.current++; }; }, [jobId]); // Only explicit refreshes query status; never retry paid requests.
  function selectedContexts(kind: 'card' | 'update') {
    return result?.contexts.filter(context => context.kind === kind && decisions[context.id] && details[context.id] && !submitted.includes(context.id)
      && ((reviewContextMatches(context, details[context.id]) && !context.coverage.contentTruncated && !context.coverage.contentParseError) || acknowledged[context.id])) ?? [];
  }
  function reviewAction(kind: 'card' | 'update') {
    const name = kind === 'card' ? 'cards.review' : 'card-updates.review';
    return actions.find(item => item.name === name + '.batch') ?? actions.find(item => item.name === name);
  }
  async function apply() {
    if (!confirmKind || !principalId || sending.current) return;
    const action = reviewAction(confirmKind); if (!action) return;
    const contexts = selectedContexts(confirmKind); if (!contexts.length) return;
    sending.current = true; setPending(true); setError('');
    try {
      const items = contexts.map(context => decisionItem(context, details[context.id], decisions[context.id]));
      if (action.name.endsWith('.batch')) {
        const { outcome } = await submitReviewOperation(principalId, action, { items, reason: reason.trim() });
        setOutcomes(previous => [...previous, { outcome, targets: contexts.map(context => context.name + ' · ' + context.targetId) }]); setSubmitted(previous => [...previous, ...contexts.map(context => context.id)]);
      } else {
        // A deployment may enable only single-item writers. Stop on an unknown result, preserving completed items.
        for (const [index, item] of items.entries()) {
          const { outcome } = await submitReviewOperation(principalId, action, { ...item, reason: reason.trim() });
          setOutcomes(previous => [...previous, { outcome, targets: [contexts[index].name + ' · ' + contexts[index].targetId] }]); setSubmitted(previous => [...previous, contexts[index].id]);
        }
      }
      setConfirmKind(null);
    } catch (e) { setError((e instanceof Error ? e.message : '提交中断') + ' 请先查询操作状态。'); }
    finally { sending.current = false; setPending(false); }
  }
  return <section className="detail" aria-label="AI 审核建议"><div className="section-title"><h2>审核建议与人工决定</h2><button className="quiet" disabled={loading || pending} onClick={() => void load()}>查询进度／刷新当前内容</button></div>
    <p>作业 {jobId} · {statusLabels[status] ?? status} · <a href={'/?view=jobs&jobId=' + encodeURIComponent(jobId)}>在作业页查看</a></p>
    {status === 'uncertain' && <p className="notice warning">请求可能已产生费用，结果不确定；不会自动重试。</p>}{loading && <p role="status">正在读取结果与当前版本…</p>}
    {error && <p role="alert" className="notice error">{error}</p>}
    {result && <><p>渠道：{result.provider ?? '历史记录未保存'} · 模型：{result.model} · 用量：{textValue(result.usage)}</p>
      {result.reviews.map(review => { const context = result.contexts.find(item => item.id === review.id); const current = details[review.id];
        const needsCheck = !context || !reviewContextMatches(context, current) || context.coverage.contentTruncated || context.coverage.contentParseError;
        const isSubmitted = submitted.includes(review.id);
        return <article key={review.id}><h3>{context?.name ?? review.id}</h3><p>AI 建议：{review.suggestion === 'approved' ? '通过' : '拒绝／需复核'} · {review.reason}</p>
          {context && <a className="button quiet" target="_blank" rel="noreferrer" href={'/?' + new URLSearchParams({ view: context.kind === 'card' ? 'data-cards' : 'data-card-updates', id: context.targetId })}>{context.kind === 'update' ? '查看更新与原稿' : '查看当前详情'}</a>}
          {needsCheck && <p className="notice warning">{!context ? '历史结果缺少版本，仅供参考，请从目标详情重新审核。' : !current ? '目标已不可见，不能提交。' : !reviewContextMatches(context, current) ? '内容已变化，请查看当前内容后重新决定。' : 'AI 未完整读取内容，请查看完整原文后决定。'}</p>}
          {needsCheck && context && current && <label><input type="checkbox" disabled={pending || !!confirmKind || isSubmitted} checked={!!acknowledged[review.id]} onChange={e => setAcknowledged(values => ({ ...values, [review.id]: e.target.checked }))} />我已核对当前完整内容</label>}
          {context && current && <label>人工决定<select value={decisions[review.id] ?? ''} disabled={pending || !!confirmKind || isSubmitted || (needsCheck && !acknowledged[review.id])} onChange={e => setDecisions(values => ({ ...values, [review.id]: e.target.value }))}><option value="">暂不处理</option><option value="approved">通过</option><option value="rejected">拒绝</option></select></label>}
          {isSubmitted && <p>已提交，请核对下方逐项结果；后续操作从最新详情发起。</p>}
        </article>;
      })}
      {principalId && <form className="action-form" onSubmit={e => e.preventDefault()}><label>人工审核理由<textarea required maxLength={1000} disabled={pending || !!confirmKind} value={reason} onChange={e => setReason(e.target.value)} /></label>
        {(['card', 'update'] as const).map(kind => { const action = reviewAction(kind); const count = selectedContexts(kind).length;
          return action && <button key={kind} type="button" disabled={!count || !reason.trim() || loading || pending || !!confirmKind} onClick={() => setConfirmKind(kind)}>核对{kind === 'card' ? '卡片' : '更新'}审核（{count} 项）</button>;
        })}
        {confirmKind && <section className="confirmation"><h3>确认人工审核</h3><ul>{selectedContexts(confirmKind).map(context => <li key={context.id}>{context.name} · {decisions[context.id] === 'approved' ? '通过' : '拒绝'}</li>)}</ul><p>{reason}</p><p>逐项校验版本，冲突项不会覆盖。拒绝操作按现行规则通知作者。</p><button type="button" disabled={pending} onClick={() => void apply()}>确认提交审核</button><button type="button" className="quiet" disabled={pending} onClick={() => setConfirmKind(null)}>返回修改</button></section>}
      </form>}
      {outcomes.map((entry, index) => <OperationFeedback key={index} {...entry} />)}
      <p><a className="button quiet" href="/?view=operations">查询逐项操作结果</a></p>
    </>}
  </section>;
}
