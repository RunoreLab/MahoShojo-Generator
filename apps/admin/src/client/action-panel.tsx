import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, fieldValue, isVersion, operationFingerprint, outcomeState, parseFields, parseJson, savedOperations, saveOperation, statusLabels, textValue, type Action, type Row, type SavedOperation } from './ui-model';

const choices = (action: string, name: string): Array<[string, string]> | undefined => {
  if (name === 'decision') return [['approved', '通过'], ['rejected', '拒绝']];
  if (name === 'visibility') return [['-1', '封禁'], ['0', '私有'], ['1', '公开']];
  if (name === 'scope') return [['user', '用户标签'], ['system', '系统标签'], ['admin', '管理标签']];
  if (name === 'priority') return [['low', '低'], ['normal', '普通'], ['high', '高']];
  if (name === 'cleanupMode') return [['preserve', '保留恢复状态'], ['runtime', '清理运行态'], ['ephemeral', '清理临时状态']];
  if (name === 'nextStatus') return action === 'inspectors.status' ? [['active', '正常'], ['suspended', '暂停'], ['revoked', '撤销']] : [['under_review', '重新复核'], ['resolved', '结案'], ['dismissed', '驳回']];
  if (name === 'resolutionCode') return action === 'appeals.review' ? [['upheld', '维持原裁决'], ['overturned_no_violation', '改判无违规'], ['reopened_under_review', '重新复核']] : [['confirmed_violation', '确认违规'], ['content_removed', '内容已移除'], ['self_remediated', '作者已整改'], ['no_violation', '无违规'], ['malicious_report', '恶意举报']];
  if (name === 'caseDecision') return [['violation', '违规'], ['no_violation', '无违规'], ['reopen_under_review', '重新复核']];
  if (name === 'target' && action === 'jobs.export') return [['data-cards', '数据卡'], ['generations', '战报']];
  if (name === 'templateKey') return (action === 'messages.site.create' ? ['site.generic.notice', 'site.service.degraded', 'site.maintenance.notice', 'site.activity.notice', 'site.policy.notice', 'site.issue.update'] : ['user.generic.notice', 'user.moderation.data_card_rejected', 'user.moderation.data_card_banned', 'user.moderation.data_card_reported', 'user.moderation.report_case_resolved']).map(value => [value, value]);
};

export function ActionPanel({ action, selected, principalId, baseAction, close, applied }: {
  action: Action; selected: Row | null; principalId: string; baseAction?: Action; close(): void; applied(): void;
}) {
  const [result, setResult] = useState<unknown>();
  const [state, setState] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [models, setModels] = useState<Array<{ provider: string; model: string }>>([]);
  const [provider, setProvider] = useState('');
  const [scope, setScope] = useState('');
  const [confirmation, setConfirmation] = useState<Row | null>(null);
  const [record, setRecord] = useState<SavedOperation | null>(null);
  const [preview, setPreview] = useState<Row | null>(null);
  const [snapshotVersion, setSnapshotVersion] = useState<unknown>();
  const [snapshotLoaded, setSnapshotLoaded] = useState(false);
  const sending = useRef(false);
  const batchItems = action.name.endsWith('.batch') && Array.isArray(selected?.batchItems) ? selected.batchItems as Row[] : null;
  const formAction = batchItems && baseAction ? { ...action, fields: baseAction.fields.filter(field => !['id', 'cardId'].includes(field.name) && !isVersion(field.name)) } : action;
  useEffect(() => {
    let live = true;
    if (action.name === 'ai.review') api('models').then(data => { if (live) setModels(data.items); }).catch(e => { if (live) setError(e.message); });
    if (action.name === 'ai-availability.refresh-snapshot') api('availability-summary').then(data => {
      if (live) { setSnapshotVersion(data.storedSnapshot?.updated_at); setSnapshotLoaded(true); }
    }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [action.name]);
  const requiredVersionMissing = (action.name === 'ai.review' && !selected?.expectedVersion) || action.fields.some(field => field.required && isVersion(field.name) && fieldValue(action, field, selected) == null && !(field.name === 'previewVersion' && preview?.previewVersion));
  const tags = parseJson(selected?.tags);
  const scopedTags = Array.isArray(tags) ? tags.filter(tag => tag.scope === scope).map(tag => String(tag.id)) : undefined;
  const readOnlyTarget = action.fields.some(field => isVersion(field.name) && field.required);

  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    try {
      const parsed = parseFields(formAction, new FormData(event.currentTarget));
      const { reason, ...shared } = parsed;
      const payload = batchItems && baseAction ? { items: batchItems.map(item => ({ ...item, ...shared })), reason } : parsed;
      if (requiredVersionMissing) throw new Error('请先读取目标详情，获取当前版本。');
      setConfirmation(payload);
    } catch (e) { setError(e instanceof Error ? e.message : '表单无效'); }
  }
  async function dispatch(payload: Row, fresh = false) {
    if (sending.current) return;
    sending.current = true; setPending(true); setError('');
    try {
      const fingerprint = await operationFingerprint(action.name, payload);
      const prior = savedOperations(principalId).find(item => item.fingerprint === fingerprint);
      if (prior && !fresh) {
        setRecord(prior); setState(prior.state); setError('相同操作已有提交记录。请查询下方状态，避免重复执行。'); return;
      }
      const entry: SavedOperation = { key: crypto.randomUUID(), fingerprint, action: action.name, label: action.label, createdAt: new Date().toISOString(), state: 'unknown' };
      // Persist only non-sensitive recovery metadata before sending. Storage failure prevents dispatch.
      saveOperation(principalId, entry); setRecord(entry); setState('pending'); setResult(undefined);
      const outcome = await api('actions/' + action.name, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Mahoshojo-Admin-CSRF': '1' }, body: JSON.stringify({ ...payload, idempotencyKey: entry.key }) });
      const nextState = outcomeState(outcome);
      const updated = { ...entry, state: nextState }; saveOperation(principalId, updated); setRecord(updated); setResult(outcome); setState(nextState);
      setConfirmation(null);
      if (nextState !== 'preview') applied();
      if (outcome.dryRun && outcome.targets) setPreview(outcome);
    } catch (e) { setState('unknown'); setError((e instanceof Error ? e.message : '请求中断') + ' 请先查询操作状态，再决定后续处理。'); }
    finally { sending.current = false; setPending(false); }
  }
  async function queryRecord() {
    if (!record) return;
    try { const outcome = await api('operation?idempotencyKey=' + encodeURIComponent(record.key)); const nextState = outcomeState(outcome);
      setResult(outcome); setState(nextState); const updated = { ...record, state: nextState }; saveOperation(principalId, updated); setRecord(updated); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : '查询失败'); }
  }
  return <section className="detail" aria-label={action.label}>
    <div className="section-title"><h2>{action.label}</h2><button className="quiet" onClick={close} disabled={pending}>关闭</button></div>
    {selected && <p>当前目标：<strong>{textValue(selected.name ?? selected.username ?? selected.title ?? selected.id)}</strong> · {String(selected.id ?? '')}</p>}
    {requiredVersionMissing && <p className="notice error">请先在列表中查看目标详情。版本信息会自动读取，不能手工填写。</p>}
    {action.name === 'ai.review' && <p>仅生成审核建议，不自动裁决。请求发出后如果结果不确定，不会再次调用模型；请在作业页检查结果与用量。</p>}
    {action.name === 'jobs.cancel' && <p>取消会停止后续步骤；已完成的业务变更与已经发出的 AI 请求仍可能存在。对于不确定作业，请先核实结果，并在理由中记录核实情况。</p>}
    {action.name === 'jobs.cleanup' && <p>请先完成下方清理预览，再将预览应用到操作；任何目标变更都必须重新预览。</p>}
    {action.name === 'jobs.export' && <><p>仅导出以下已冻结的记录范围，结果保存 24 小时。下载时会重新检查权限。</p><ul>{(fieldValue(action, { name: 'ids', label: '', type: 'json' }, selected) as string[] ?? []).map(id => <li key={id}>{id}</li>)}</ul></>}
    {batchItems && <><p>共 {batchItems.length} 项；以下修改值应用到每个已选目标。每项版本自动读取并单独校验。各项独立执行，可能部分成功；请逐项核对结果。</p><details><summary>查看已选目标</summary><ul>{batchItems.map((item, index) => <li key={index}>{String(item.id)}</li>)}</ul></details></>}
    <form onSubmit={prepare} className="action-form">
      {formAction.fields.map(field => {
        let value = fieldValue(action, field, selected);
        if (action.name === 'jobs.export' && ['target', 'ids'].includes(field.name)) return <input key={field.name} type="hidden" name={field.name} value={value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)} />;
        if (batchItems) value = batchItems.every(item => JSON.stringify(item[field.name]) === JSON.stringify(batchItems[0][field.name])) ? batchItems[0][field.name] : undefined;
        if (field.name === 'expectedVersion' && action.name === 'ai-availability.refresh-snapshot') value = snapshotVersion;
        if (field.name === 'expectedTagIds') value = scopedTags;
        if (action.name === 'jobs.cleanup' && preview) value = preview[field.name];
        if (action.name === 'ai-availability.cleanup' && field.name === 'targets' && preview) value = preview.targets;
        if (isVersion(field.name) || field.name === 'expectedTagIds' || (action.name === 'ai.review' && field.name === 'targets') || (action.name === 'jobs.cleanup' && ['target', 'ids'].includes(field.name))) return <input key={field.name} type="hidden" name={field.name} value={value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)} />;
        const options = action.name === 'ai.review' && field.name === 'provider'
          ? [...new Set(models.map(item => item.provider))].map(name => [name, name] as [string, string])
          : field.name === 'model' ? [...new Set(models.filter(item => item.provider === provider).map(item => item.model))].map(model => [model, model] as [string, string]) : choices(baseAction?.name ?? action.name, field.name);
        const defaultValue = value === undefined ? '' : value === null ? (field.type === 'json' ? 'null' : '') : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
        const mayClear = ['prefix', 'description'].includes(field.name);
        return <label key={field.name}>{field.label}{field.required && !mayClear ? ' *' : ''}
          {field.type === 'boolean' ? <select name={field.name} required={field.required} defaultValue={defaultValue}><option value="">请选择{field.required ? '' : '（使用服务器默认值）'}</option><option value="true">是</option><option value="false">否</option></select>
          : options ? <select key={field.name === 'model' ? provider : field.name} name={field.name} required={field.required} defaultValue={defaultValue} onChange={field.name === 'scope' ? event => setScope(event.target.value) : field.name === 'provider' ? event => setProvider(event.target.value) : undefined}><option value="">请选择</option>{options.map(([option, label]) => <option key={option} value={option}>{label}</option>)}</select>
          : field.type === 'json' || ['bodyText', 'description'].includes(field.name) ? <textarea name={field.name} required={field.required && !mayClear} defaultValue={defaultValue} readOnly={action.name === 'ai.review' && field.name === 'targets' && Boolean(selected?.expectedVersion)} />
          : <input name={field.name} type={field.type === 'number' ? 'number' : 'text'} required={field.required && !mayClear} readOnly={readOnlyTarget && ['id', 'cardId'].includes(field.name)} defaultValue={defaultValue} />}
        </label>;
      })}
      {action.name === 'cards.tags' && <p>所选范围当前标签：{scopedTags ? scopedTags.join('、') || '无' : '未读取，请刷新详情'}</p>}
      {action.name === 'jobs.cleanup' && <CleanupHandoff onPreview={setPreview} />}
      {preview && <details open><summary>已核对预览范围</summary><pre className="json-data">{textValue(preview)}</pre></details>}
      <label>操作理由 *<textarea name="reason" required maxLength={1000} /></label>
      <button disabled={pending || requiredVersionMissing || (action.name === 'jobs.cleanup' && !preview) || (action.name === 'cards.tags' && !scopedTags) || (action.name === 'ai-availability.refresh-snapshot' && !snapshotLoaded)}>核对操作</button>
    </form>
    {confirmation && <section className="confirmation" aria-label="确认操作"><h3>确认「{action.label}」</h3><p>请核对目标、修改值与理由。版本信息由服务器校验，冲突时不会覆盖。</p><dl>{Object.entries(confirmation).filter(([key]) => !isVersion(key)).map(([key, value]) => <div key={key}><dt>{key === 'items' ? '逐项目标与修改值' : action.fields.find(field => field.name === key)?.label ?? '操作理由'}</dt><dd>{textValue(Array.isArray(value) ? value.map(item => typeof item === 'object' && item ? Object.fromEntries(Object.entries(item).filter(([key]) => !isVersion(key))) : item) : value)}</dd></div>)}</dl><button disabled={pending} onClick={() => void dispatch(confirmation)}>{pending ? '正在提交…' : '确认执行'}</button> <button className="quiet" disabled={pending} onClick={() => setConfirmation(null)}>返回修改</button>
      {record && ['succeeded', 'preview'].includes(record.state) && <button className="quiet" disabled={pending} onClick={() => { if (confirm('已确认上次操作完成。是否将相同内容作为新的独立操作执行？')) void dispatch(confirmation, true); }}>作为新的独立操作执行</button>}
    </section>}
    {error && <p role="alert" className="notice error">{error}</p>}
    {state && <p role="status" className={'notice ' + (['conflict', 'unknown', 'uncertain'].includes(state) ? 'warning' : '')}>{statusLabels[state] ?? state}{state === 'conflict' && '。请重新读取详情并再次核对。'}</p>}
    {result !== undefined && <pre className="json-data">{textValue(result)}</pre>}
    {action.name === 'jobs.export' && (result as { result?: { jobId?: string } } | undefined)?.result?.jobId && <p><a className="button" href={'/?view=jobs&jobId=' + encodeURIComponent((result as { result: { jobId: string } }).result.jobId)}>查看导出进度与下载</a></p>}
    {record && <p>操作查询键：<code>{record.key}</code> <button className="quiet" onClick={() => void queryRecord()} disabled={pending}>查询此操作状态</button> <a className="button quiet" href="/?view=operations">全部提交记录</a></p>}
  </section>;
}

function CleanupHandoff({ onPreview }: { onPreview(value: Row): void }) {
  const [targets, setTargets] = useState<string[]>([]); const [error, setError] = useState('');
  const [target, setTarget] = useState(''); const [ids, setIds] = useState('');
  useEffect(() => { api('cleanup-targets').then(data => setTargets(data.targets)).catch(e => setError(e.message)); }, []);
  return <fieldset><legend>只读范围预览</legend><label>目标<select value={target} onChange={e => setTarget(e.target.value)}><option value="">请选择</option>{targets.map(item => <option key={item}>{item}</option>)}</select></label><label>记录编号 JSON 数组<textarea value={ids} onChange={e => setIds(e.target.value)} placeholder={'["record-id"]'} /></label><button type="button" onClick={async () => { try { const result = await api('cleanup-preview?' + new URLSearchParams({ target, ids })); onPreview(result); setError(''); } catch (e) { setError(e instanceof Error ? e.message : '预览失败'); } }}>预览并应用范围</button>{error && <p role="alert">{error}</p>}</fieldset>;
}
