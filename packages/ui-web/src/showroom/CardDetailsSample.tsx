import { useState } from 'react';
import { Layers } from 'lucide-react';
import { BasicCardDetailsModal, CardDetailsActions, CardDetailsMoreActions, type CardDetailsSource } from '../card-details';
import { GenerationActionButton } from '../generation-actions';

const sources = {
  public: { kind: 'public' }, owned: { kind: 'owned' },
  local: { kind: 'local', label: '本地库', provenance: '本机未验证签名' },
  cache: { kind: 'cache', lastSuccessAt: '2026-11-01T08:00:00Z' }, preset: { kind: 'preset' },
  saving: { kind: 'public' }, unavailable: { kind: 'public' },
} satisfies Record<string, CardDetailsSource>;

export function CardDetailsSample() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<keyof typeof sources>('public');
  const [message, setMessage] = useState<string | null>(null);
  const canSave = ['public', 'owned', 'cache', 'saving', 'unavailable'].includes(mode);
  return <div className="flex flex-wrap items-center gap-3" aria-label="数据卡详情样板">
    <label className="flex items-center gap-2 text-sm text-(--app-text-muted)">详情状态
      <select aria-label="数据卡详情样板状态" className="rounded-lg border border-(--app-border) bg-(--app-surface-strong) p-2 text-(--app-text)"
        value={mode} onChange={event => setMode(event.target.value as keyof typeof sources)}>
        <option value="public">公开云端卡</option><option value="owned">我的云端卡</option>
        <option value="local">本地卡</option><option value="cache">缓存快照</option><option value="preset">内置预设</option>
        <option value="saving">保存中</option><option value="unavailable">下载校验中</option>
      </select>
    </label>
    <GenerationActionButton onClick={() => { setMessage(null); setOpen(true); }}>打开数据卡详情样板</GenerationActionButton>
    {open && <BasicCardDetailsModal isOpen onClose={() => setOpen(false)} source={sources[mode]}
      card={{ id: 'showroom-card-details', name: '霜月·远行记录与魔法少女角色设定', description: '一张用于检查窄屏阅读、来源提示和操作层级的角色卡。',
        type: 'character', isPublic: true, author: '样板作者', createdAt: '2026-11-01T08:00:00Z', updatedAt: '2026-11-02T09:00:00Z',
        likeCount: 4, favoriteCount: 5, usageCount: 18,
        data: JSON.stringify({ name: '霜月', description: '她沿着星光留下的路径，寻找旧城钟楼的秘密。',
          appearance: '银白短发，随身携带记录旅途的手册。', abilities: ['凝结微光，照亮通道。', '读取散落在旧物上的记忆。'],
          background: '这是一段用于检验独立滚动区域的正文。'.repeat(24) }) }}
      renderMarkdown={content => <p className="app-reading whitespace-pre-wrap text-sm">{content}</p>}
      headerActions={<CardDetailsMoreActions actions={[{ id: 'forge', label: '卡牌工坊', icon: <Layers className="h-4 w-4 shrink-0" aria-hidden="true" />,
        onSelect: () => setMessage('样板已选择卡牌工坊；未离开当前页面。') }]} />}
      metadata={<section className="text-xs text-(--app-text-muted)"><h3 className="font-medium">技术与标签</h3><p>技术值与标签样板位于正文之后。</p></section>}
      footer={<CardDetailsActions onDownload={() => setMessage('样板已触发下载；未生成文件。')}
        downloadDisabled={mode === 'unavailable'} downloadLabel={mode === 'unavailable' ? '校验中…' : '下载 JSON'}
        onSave={canSave ? () => setMessage('已保存到本地库（样板反馈，未写入数据）。') : undefined}
        saveBusy={mode === 'saving'} feedback={message ? <p role="status" className="text-xs text-(--app-text-muted)">{message}</p> : null} />}
    />}
  </div>;
}
