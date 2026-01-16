"use client";

import { useEffect, useMemo, useState } from 'react';

import TachieGenerator from '@/components/TachieGenerator';
import { ErrorMessage } from '@/components/ErrorMessage';
import { randomUUID } from '@/lib/crypto';
import {
  deleteMagicTavernTachieAsset,
  deleteMagicTavernTachieAssets,
  listMagicTavernTachieAssets,
  putMagicTavernTachieAsset,
} from '@/lib/magic-tavern/storage';
import type { MagicTavernMessage, MagicTavernRole, MagicTavernScenario, MagicTavernSession, MagicTavernTachieAsset } from '@/lib/magic-tavern/types';

type MagicTavernImageKind = NonNullable<MagicTavernTachieAsset['kind']>;

const MAX_PROMPT_CHARS = 10_000;
const MAX_REFERENCE_CHARS = 2_000;
const MAX_ASSETS_PER_SESSION = 24;

const bufferToHex = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

const sha256Hex = async (value: string): Promise<string> => {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return bufferToHex(digest);
};

const truncateText = (value: string, maxChars: number): string => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars))}...[已截断]`;
};

const getMessagePlainText = (message: MagicTavernMessage, roleNameLookup: (roleId: string) => string): string => {
  const segments = Array.isArray(message.segments) ? message.segments : null;
  if (segments && segments.length > 0) {
    const lines: string[] = [];
    for (const seg of segments) {
      if (!seg) continue;
      if (seg.type === 'narration') {
        if (seg.text?.trim()) lines.push(seg.text.trim());
        continue;
      }
      if (seg.type === 'dialogue') {
        const speaker = seg.speakerName?.trim() || roleNameLookup(seg.speakerId) || seg.speakerId;
        const text = seg.text?.trim();
        if (text) lines.push(`${speaker}: ${text}`);
        continue;
      }
    }
    return lines.join('\n').trim();
  }
  return (message.content ?? '').trim();
};

const pickDefaultReferenceText = (messages: MagicTavernMessage[], roleNameLookup: (roleId: string) => string): string => {
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant' && (m.content || '').trim() && m.status !== 'error');
  if (lastAssistant) return truncateText(getMessagePlainText(lastAssistant, roleNameLookup), MAX_REFERENCE_CHARS);
  const lastUser = [...messages].reverse().find((m) => m.role === 'user' && (m.content || '').trim());
  if (lastUser) return truncateText(getMessagePlainText(lastUser, roleNameLookup), MAX_REFERENCE_CHARS);
  return '';
};

const buildRoleAppearanceHint = (role: MagicTavernRole): string => {
  const card = role.card && typeof role.card === 'object' ? (role.card as Record<string, unknown>) : {};
  const appearance = card.appearance;
  if (!appearance) return '';

  if (typeof appearance === 'string') return appearance.trim();
  if (typeof appearance !== 'object' || Array.isArray(appearance)) return '';

  const outfit = typeof (appearance as any).outfit === 'string' ? String((appearance as any).outfit).trim() : '';
  const accessories = typeof (appearance as any).accessories === 'string' ? String((appearance as any).accessories).trim() : '';
  const colorScheme = typeof (appearance as any).colorScheme === 'string' ? String((appearance as any).colorScheme).trim() : '';
  const overallLook = typeof (appearance as any).overallLook === 'string' ? String((appearance as any).overallLook).trim() : '';
  return [outfit, accessories, colorScheme, overallLook].filter(Boolean).join('，');
};

const buildRoleSummaryHint = (role: MagicTavernRole): string => {
  const appearance = buildRoleAppearanceHint(role);
  if (appearance) return `${role.name}：${appearance}`;
  return role.name;
};

const buildSuggestedPrompt = (params: {
  kind: MagicTavernImageKind;
  styleId: string;
  referenceText: string;
  scenario?: MagicTavernScenario | null;
  roles: MagicTavernRole[];
  mainRoleId?: string | null;
  includedRoleIds?: string[];
}): string => {
  const styleHint =
    params.kind === 'tachie'
      ? 'Xiabanmo, 二次元, 魔法少女, 角色立绘, 全身, 单人, 站姿, 细节丰富, 高质量, 干净背景, 不要水印, 不要文字'
      : 'Xiabanmo, 二次元, 魔法少女, 视觉小说, 剧情插画, 场景插图, cinematic lighting, 高质量, 干净画面, 不要水印, 不要文字';

  const scenarioTitle = params.scenario?.title?.trim() || '魔法酒馆';
  const snippet = truncateText(params.referenceText || '', MAX_REFERENCE_CHARS);

  if (params.kind === 'tachie') {
    const role = params.mainRoleId ? params.roles.find((r) => r.id === params.mainRoleId) : null;
    const roleName = role?.name?.trim() || '角色';
    const roleHint = role ? buildRoleAppearanceHint(role) : '';
    const parts = [
      `角色：${roleName}`,
      roleHint ? `外观要点：${roleHint}` : '',
      snippet ? `剧情片段（用于表情/动作/氛围）：${snippet}` : '',
      `场景：${scenarioTitle}`,
      `风格：${styleHint}`,
    ].filter(Boolean);
    return truncateText(parts.join('\n'), MAX_PROMPT_CHARS);
  }

  const includedRoleIds = Array.isArray(params.includedRoleIds) ? params.includedRoleIds : [];
  const includedRoles = includedRoleIds
    .map((id) => params.roles.find((r) => r.id === id))
    .filter((r): r is MagicTavernRole => Boolean(r));
  const castHint = includedRoles.length > 0 ? includedRoles.map(buildRoleSummaryHint).join('；') : '';

  const parts = [
    `场景：${scenarioTitle}`,
    castHint ? `登场角色：${castHint}` : '',
    snippet ? `剧情片段：${snippet}` : '',
    '构图建议：画面中留出对白/字幕空间（视觉小说 UI 友好）。',
    `风格：${styleHint}`,
  ].filter(Boolean);
  return truncateText(parts.join('\n'), MAX_PROMPT_CHARS);
};

export function MagicTavernTachiePanel(props: {
  session: Pick<MagicTavernSession, 'id'> & {
    roles: MagicTavernRole[];
    scenario?: MagicTavernScenario;
  };
  messages: MagicTavernMessage[];
  referenceText?: string;
  onReferenceTextChange?: (value: string) => void;
}) {
  const roleNameLookup = useMemo(() => {
    const map = new Map((props.session.roles ?? []).map((role) => [role.id, role.name]));
    return (roleId: string) => map.get(roleId) || '';
  }, [props.session.roles]);

  const [assets, setAssets] = useState<MagicTavernTachieAsset[]>([]);
  const [assetError, setAssetError] = useState<string | null>(null);

  const [kind, setKind] = useState<MagicTavernImageKind>('tachie');
  const [styleId, setStyleId] = useState<string>('default');
  const [mainRoleId, setMainRoleId] = useState<string>('');
  const [includedRoleIds, setIncludedRoleIds] = useState<string[]>([]);
  const [referenceTextInternal, setReferenceTextInternal] = useState<string>('');

  const [prompt, setPrompt] = useState<string>('');
  const [promptDirty, setPromptDirty] = useState(false);

  const referenceText = typeof props.referenceText === 'string' ? props.referenceText : referenceTextInternal;
  const setReferenceText = (value: string) => {
    if (typeof props.onReferenceTextChange === 'function') {
      props.onReferenceTextChange(value);
      return;
    }
    setReferenceTextInternal(value);
  };

  useEffect(() => {
    let canceled = false;
    setAssetError(null);
    setAssets([]);
    void (async () => {
      try {
        const next = await listMagicTavernTachieAssets(props.session.id);
        if (canceled) return;
        setAssets(next);
      } catch (error) {
        if (canceled) return;
        setAssetError(error instanceof Error ? error.message : '读取立绘缓存失败');
      }
    })();
    return () => {
      canceled = true;
    };
  }, [props.session.id]);

  useEffect(() => {
    if (typeof props.onReferenceTextChange === 'function') return;
    setReferenceTextInternal((prev) => prev || pickDefaultReferenceText(props.messages, roleNameLookup));
  }, [props.messages, props.onReferenceTextChange, roleNameLookup]);

  useEffect(() => {
    const roles = props.session.roles ?? [];
    if (kind === 'tachie') {
      const fallbackId = roles.length > 0 ? roles[0].id : '';
      setMainRoleId((prev) => (prev || fallbackId));
      return;
    }
    setIncludedRoleIds((prev) => (prev.length > 0 ? prev : roles.slice(0, 2).map((r) => r.id)));
  }, [kind, props.session.roles]);

  const suggestedPrompt = useMemo(() => {
    return buildSuggestedPrompt({
      kind,
      styleId,
      referenceText,
      scenario: props.session.scenario ?? null,
      roles: props.session.roles ?? [],
      mainRoleId: mainRoleId || null,
      includedRoleIds,
    });
  }, [includedRoleIds, kind, mainRoleId, props.session.roles, props.session.scenario, referenceText, styleId]);

  useEffect(() => {
    if (promptDirty) return;
    setPrompt(suggestedPrompt);
  }, [promptDirty, suggestedPrompt]);

  const saveAsset = async (result: { imageUrl: string; seed?: number; auditStatus?: number; generateUuid?: string }) => {
    const now = Date.now();
    const normalizedReference = (referenceText || '').trim();
    const fragmentHash = await sha256Hex(`${kind}:${normalizedReference}`.slice(0, 20_000));
    const cacheKey = await sha256Hex(
      JSON.stringify({
        v: 1,
        kind,
        sessionId: props.session.id,
        roleId: kind === 'tachie' ? mainRoleId || null : null,
        includedRoleIds: kind === 'illustration' ? includedRoleIds.slice().sort() : [],
        styleId,
        fragmentHash,
        prompt: (prompt || '').slice(0, 20_000),
      })
    );

    const asset: MagicTavernTachieAsset = {
      id: randomUUID(),
      sessionId: props.session.id,
      kind,
      ...(kind === 'tachie' && mainRoleId ? { roleId: mainRoleId } : {}),
      cacheKey,
      fragmentHash,
      styleId,
      prompt: truncateText(prompt, MAX_PROMPT_CHARS),
      imageUrl: result.imageUrl,
      seed: result.seed,
      auditStatus: result.auditStatus,
      generateUuid: result.generateUuid,
      createdAt: now,
      lastUsedAt: now,
    };

    await putMagicTavernTachieAsset(asset);

    setAssets((prev) => {
      const next = [asset, ...prev.filter((item) => item.id !== asset.id)].sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0));
      return next;
    });

    const nextAll = await listMagicTavernTachieAssets(props.session.id);
    if (nextAll.length > MAX_ASSETS_PER_SESSION) {
      const over = nextAll.slice(MAX_ASSETS_PER_SESSION);
      await Promise.all(over.map((item) => deleteMagicTavernTachieAsset(item.id)));
      const trimmed = nextAll.slice(0, MAX_ASSETS_PER_SESSION);
      setAssets(trimmed);
    } else {
      setAssets(nextAll);
    }
  };

  const handleDelete = async (assetId: string) => {
    setAssetError(null);
    try {
      await deleteMagicTavernTachieAsset(assetId);
      setAssets((prev) => prev.filter((item) => item.id !== assetId));
    } catch (error) {
      setAssetError(error instanceof Error ? error.message : '删除失败');
    }
  };

  const handleClear = async () => {
    setAssetError(null);
    try {
      await deleteMagicTavernTachieAssets(props.session.id);
      setAssets([]);
    } catch (error) {
      setAssetError(error instanceof Error ? error.message : '清理失败');
    }
  };

  const hasRoles = (props.session.roles ?? []).length > 0;
  const promptForGenerator = truncateText(prompt, MAX_PROMPT_CHARS);

  return (
    <div className="rounded-xl border border-pink-100 bg-white p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-800">插画 / 立绘</div>
          <div className="mt-1 text-xs text-gray-500">
            立绘用于角色展示；插画用于“视觉小说式”的剧情画面。生成结果仅保存在本地浏览器缓存中。
          </div>
        </div>
        <button
          type="button"
          className="flex-none rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void handleClear()}
          disabled={assets.length === 0}
          title="清空本会话已生成的立绘/插画缓存"
        >
          清空缓存
        </button>
      </div>

      {assetError ? (
        <ErrorMessage
          message={assetError}
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          linkClassName="text-red-700 underline underline-offset-2 hover:opacity-95"
        />
      ) : null}

      {assets.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {assets.slice(0, 6).map((asset) => {
            const kindLabel = asset.kind === 'illustration' ? '剧情插画' : '角色立绘';
            const roleLabel = asset.roleId ? roleNameLookup(asset.roleId) || asset.roleId : '';
            const title = [kindLabel, roleLabel].filter(Boolean).join(' · ');
            const url = asset.imageUrl || asset.blobRef || '';
            return (
              <div key={asset.id} className="rounded-xl border border-pink-100 bg-white overflow-hidden">
                <div className="flex items-center justify-between gap-3 px-3 py-2 bg-pink-50">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-pink-800">{title || '已生成图片'}</div>
                    <div className="text-[11px] text-gray-500">{asset.createdAt ? new Date(asset.createdAt).toLocaleString() : ''}</div>
                  </div>
                  <button
                    type="button"
                    className="flex-none text-xs text-gray-500 hover:text-gray-700"
                    onClick={() => void handleDelete(asset.id)}
                    title="删除"
                  >
                    删除
                  </button>
                </div>
                {url ? (
                  <a href={url} target="_blank" rel="noreferrer" className="block">
                    <img src={url} alt={title || '生成图片'} className="h-44 w-full object-cover" loading="lazy" />
                  </a>
                ) : (
                  <div className="h-44 w-full bg-gray-50 flex items-center justify-center text-xs text-gray-500">暂无可用图片链接</div>
                )}
                <div className="px-3 py-2 text-[11px] text-gray-500 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    className="underline underline-offset-2 hover:text-gray-700"
                    onClick={() => {
                      const text = (asset.prompt || '').trim();
                      if (!text) return;
                      setPrompt(text);
                      setPromptDirty(true);
                    }}
                    disabled={!asset.prompt}
                    title="将本次生成提示词复制到编辑区"
                  >
                    复用提示词
                  </button>
                  <span className="truncate">{asset.seed ? `seed=${asset.seed}` : ''}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg bg-pink-50 px-4 py-3 text-sm text-pink-800">还没有生成插画/立绘。先选择模式与参考片段，然后点击生成。</div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <label className="text-xs font-semibold text-gray-600">生成类型</label>
          <select className="input-field" value={kind} onChange={(e) => setKind(e.target.value as MagicTavernImageKind)}>
            <option value="tachie">角色立绘</option>
            <option value="illustration">剧情插画</option>
          </select>
        </div>
        <div className="grid gap-1">
          <label className="text-xs font-semibold text-gray-600">风格</label>
          <select className="input-field" value={styleId} onChange={(e) => setStyleId(e.target.value)}>
            <option value="default">默认（魔法少女二次元）</option>
            <option value="vn">视觉小说插画（更强调氛围）</option>
          </select>
        </div>
      </div>

      {kind === 'tachie' ? (
        <div className="grid gap-1">
          <label className="text-xs font-semibold text-gray-600">目标角色</label>
          <select
            className="input-field"
            value={mainRoleId}
            onChange={(e) => setMainRoleId(e.target.value)}
            disabled={!hasRoles}
          >
            {(props.session.roles ?? []).length === 0 ? <option value="">（尚未选择角色）</option> : null}
            {(props.session.roles ?? []).map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
          <div className="text-[11px] text-gray-500">提示：会根据角色外观摘要 + 剧情片段生成“表情/动作一致”的立绘。</div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-xs font-semibold text-gray-600">登场角色（可选）</div>
          {(props.session.roles ?? []).length === 0 ? (
            <div className="text-xs text-gray-500">尚未选择角色；仍可仅根据剧情片段生成插画。</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {(props.session.roles ?? []).map((role) => {
                const checked = includedRoleIds.includes(role.id);
                return (
                  <label key={role.id} className="inline-flex items-center gap-2 rounded-full bg-gray-50 px-3 py-1 text-xs text-gray-700">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...includedRoleIds, role.id]
                          : includedRoleIds.filter((id) => id !== role.id);
                        setIncludedRoleIds(next);
                      }}
                    />
                    {role.name}
                  </label>
                );
              })}
            </div>
          )}
          <div className="text-[11px] text-gray-500">提示：勾选的角色会以“外观要点摘要”形式写入提示词（更像视觉小说的同屏插画）。</div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <label className="text-xs font-semibold text-gray-600">剧情片段 / 参考描述</label>
          <button
            type="button"
            className="text-xs text-pink-700 hover:underline"
            onClick={() => setReferenceText(pickDefaultReferenceText(props.messages, roleNameLookup))}
            title="从最近一条对话自动填入参考片段"
          >
            用最近对话填充
          </button>
        </div>
        <textarea
          className="input-field h-24 resize-y"
          value={referenceText}
          onChange={(e) => setReferenceText(truncateText(e.target.value, MAX_REFERENCE_CHARS))}
          placeholder="例如：雨夜的酒馆里，星见澪抬起眼睛，指尖的光点像火萤一样跳动……"
        />
        <div className="text-[11px] text-gray-500">建议只保留 1~3 段关键描写（越聚焦越稳定）。</div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <label className="text-xs font-semibold text-gray-600">最终提示词（可编辑）</label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="text-xs text-gray-600 hover:underline"
              onClick={() => {
                setPrompt(suggestedPrompt);
                setPromptDirty(false);
              }}
              title="恢复为推荐提示词"
            >
              重置
            </button>
            <button
              type="button"
              className="text-xs text-pink-700 hover:underline"
              onClick={() => {
                setPrompt(suggestedPrompt);
                setPromptDirty(true);
              }}
              title="用推荐提示词覆盖当前编辑区（并视为已手动修改）"
            >
              生成推荐提示词
            </button>
          </div>
        </div>
        <textarea
          className="input-field h-32 resize-y"
          value={prompt}
          onChange={(e) => {
            setPrompt(truncateText(e.target.value, MAX_PROMPT_CHARS));
            setPromptDirty(true);
          }}
          placeholder="这里会自动生成推荐提示词；也可以按你的偏好修改。"
        />
        <div className="text-[11px] text-gray-500">提示词越长越不稳定；建议保持在 1,000~2,000 字内。</div>
      </div>

      <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
        <TachieGenerator
          prompt={styleId === 'vn' && kind === 'illustration' ? `${promptForGenerator}\n（额外约束：更强调镜头感与氛围，画面层次丰富）` : promptForGenerator}
          onResult={(result) => {
            if (!result.success || !result.imageUrl) return;
            void saveAsset({
              imageUrl: result.imageUrl,
              seed: result.seed,
              auditStatus: result.auditStatus,
              generateUuid: result.generateUuid,
            });
          }}
        />
      </div>
    </div>
  );
}
