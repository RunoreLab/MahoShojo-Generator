import { useMemo, useState } from 'react';
import { buildContentDiff } from './content-diff-model';
import { textValue, type Row } from './ui-model';

function FullText({ label, value }: { label: string; value: unknown }) {
  const [open, setOpen] = useState(false);
  return <details onToggle={event => setOpen(event.currentTarget.open)}><summary>{label}（完整原文）</summary>{open && <pre className="json-data">{textValue(value)}</pre>}</details>;
}
const kindLabels = { added: '新增', removed: '删除', modified: '修改' };

export function ContentUpdateDiff({ selected }: { selected: Row }) {
  const result = useMemo(() => buildContentDiff(selected), [selected]);
  return <section aria-label="待审更新内容对照"><h3>待审更新内容对照</h3>
    <p>原稿与待审更新的有效稿对照；更新中未填写的字段沿用原稿。JSON 路径使用 JSON Pointer，数组按索引比较。</p>
    {!result.hasCurrent && <p className="notice warning">当前卡片不可用，无法确认有效稿或计算差异，请重新读取详情。</p>}
    {result.fields.map(field => <section key={field.field}><h4>{field.label}{field.inherited ? '（沿用原稿）' : ''}</h4>
      {field.notices.map(notice => <p key={notice} className="notice warning">{notice}</p>)}
      {field.changes.length > 0 ? <div className="table-wrap"><table><thead><tr><th>字段路径</th><th>变更</th><th>原稿</th><th>有效稿</th></tr></thead><tbody>{field.changes.map(item => <tr key={item.path}><th scope="row">{item.path}</th><td>{kindLabels[item.kind]}</td><td><pre className="json-data">{item.before}</pre></td><td><pre className="json-data">{item.after}</pre></td></tr>)}</tbody></table></div> : result.hasCurrent && <p>{field.notices.length ? '已检查范围内未发现差异；对照不完整。' : '无变化'}</p>}
      <FullText label="原稿" value={field.before} /><FullText label="待审更新提交值" value={selected[field.field]} /><FullText label="有效稿" value={field.after} />
    </section>)}
  </section>;
}
