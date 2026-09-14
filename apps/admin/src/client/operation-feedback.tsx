import { outcomeState, statusLabels, textValue, type Row } from './ui-model';

export function OperationFeedback({ outcome, targets = [] }: { outcome: Row; targets?: string[] }) {
  const rawItems = outcome.items ?? outcome.operations;
  const items = Array.isArray(rawItems) ? rawItems as Row[] : [outcome];
  return <section aria-label="逐项操作结果"><p role="status" className="notice">{statusLabels[outcomeState(outcome)] ?? outcomeState(outcome)}</p>
    <div className="table-wrap"><table><thead><tr><th>目标</th><th>结果</th><th>决定／错误</th></tr></thead><tbody>{items.map((item, index) => {
      const result = item.result as Row | null; const decision = result?.decision;
      return <tr key={index}><td>{targets[index] ?? textValue(result?.id ?? `第 ${index + 1} 项`)}</td><td>{statusLabels[String(item.status)] ?? textValue(item.status)}</td><td>{decision === 'approved' ? '通过' : decision === 'rejected' ? '拒绝' : textValue(item.error)}</td></tr>;
    })}</tbody></table></div><details><summary>操作查询信息</summary><pre className="json-data">{textValue(outcome)}</pre></details>
  </section>;
}
