import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';

import Footer from '@/components/Footer';
import MagicalGirlCard from '@/components/MagicalGirlCard';
import CanshouCard from '@/components/CanshouCard';
import GeneralCharacterCard from '@/components/GeneralCharacterCard';
import SaveToCloudButton from '@/components/SaveToCloudButton';
import TachieGenerator from '@/components/TachieGenerator';

import { useAuth } from '@/lib/useAuth';
import { dataCardApi } from '@/lib/auth';
import { copyTextToClipboard } from '@/lib/clipboard';
import { randomUUID } from '@/lib/crypto';
import { COLOR_GRADIENTS, MainColor } from '@/lib/main-color';
import { inferTemplate, TEMPLATE_LABELS, type InferableTemplate } from '@/lib/data-card-converter';
import { mergeTeamDataCards, type TeamMergeOutputTemplate } from '@/lib/team/merge-team-cards';

type Notice = { type: 'success' | 'error' | 'info'; text: string } | null;

type TeamMember = {
  id: string;
  label: string;
  data: Record<string, unknown>;
  template: InferableTemplate;
  source: 'cloud' | 'file' | 'paste';
};

const SOURCE_LABELS: Record<TeamMember['source'], string> = {
  cloud: '云端',
  file: '文件',
  paste: '粘贴',
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'JSON 解析失败');
  }
};

const getDisplayNameFromData = (data: Record<string, unknown>, fallback = '未命名角色'): string => {
  const codename = typeof data.codename === 'string' ? data.codename.trim() : '';
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  return codename || name || fallback;
};

const sanitizeFileName = (value: string): string =>
  value.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_').slice(0, 80) || 'data';

const downloadJson = (data: unknown, suggestedName: string): void => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = suggestedName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const buildTachiePrompt = (data: Record<string, unknown>): string => {
  const codename = typeof data.codename === 'string' ? data.codename.trim() : '';
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const isMagicalGirl = Boolean(codename);

  if (isMagicalGirl && isPlainObject(data.appearance)) {
    const appearance = data.appearance as Record<string, unknown>;
    const appearanceString = Object.entries(appearance)
      .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
      .join(', ');
    return `${appearanceString}, Xiabanmo, 二次元, 魔法少女`;
  }

  if (!isMagicalGirl && name) {
    const parts = [data.appearance, data.materialAndSkin, data.featuresAndAppendages]
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
    return parts.join(', ');
  }

  return '';
};

export default function CharacterPartyPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();

  const [notice, setNotice] = useState<Notice>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [outputTemplate, setOutputTemplate] = useState<TeamMergeOutputTemplate>('auto');

  const [cloudCards, setCloudCards] = useState<any[]>([]);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudSearch, setCloudSearch] = useState('');
  const [cloudSortBy, setCloudSortBy] = useState<'likes' | 'usage' | 'favorites' | 'created_at'>('created_at');

  const [pasteText, setPasteText] = useState('');

  const [showImageModal, setShowImageModal] = useState(false);
  const [savedImageUrl, setSavedImageUrl] = useState<string | null>(null);

  const [isTachieVisible, setIsTachieVisible] = useState(false);

  const addMember = (payload: Record<string, unknown>, source: TeamMember['source'], label?: string) => {
    const inferred = inferTemplate(payload);
    const displayName = (label && label.trim()) ? label.trim() : getDisplayNameFromData(payload);
    setMembers((prev) => [
      ...prev,
      {
        id: randomUUID(),
        label: displayName,
        data: payload,
        template: inferred,
        source,
      }
    ]);
  };

  const handleAddFromCloud = (card: any) => {
    let payload: unknown = card?.data;
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch {
        setNotice({ type: 'error', text: `云端数据卡解析失败：${card?.name || card?.id || '未知卡片'}` });
        return;
      }
    }
    if (!isPlainObject(payload)) {
      setNotice({ type: 'error', text: `云端数据卡格式无效：${card?.name || card?.id || '未知卡片'}` });
      return;
    }

    addMember(payload, 'cloud', typeof card?.name === 'string' ? card.name : undefined);
    setNotice({ type: 'success', text: `已加入队伍：${card?.name || getDisplayNameFromData(payload)}` });
  };

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const results = await Promise.all(
      Array.from(files).map(async (file) => {
        try {
          const text = await file.text();
          const data = parseJson(text);
          if (!isPlainObject(data)) {
            return { ok: false, message: `文件 ${file.name}：JSON 顶层必须是对象` } as const;
          }
          return { ok: true, data, fileName: file.name } as const;
        } catch (error) {
          return { ok: false, message: `文件 ${file.name}：${error instanceof Error ? error.message : '解析失败'}` } as const;
        }
      })
    );

    const ok = results.filter((item) => item.ok) as Array<{ ok: true; data: Record<string, unknown>; fileName: string }>;
    const failed = results.filter((item) => !item.ok) as Array<{ ok: false; message: string }>;

    for (const item of ok) {
      addMember(item.data, 'file', item.fileName.replace(/\.json$/i, '').trim());
    }

    if (failed.length > 0) {
      setNotice({ type: 'error', text: failed.map((item) => item.message).join('；') });
      return;
    }

    setNotice({ type: 'success', text: `已添加 ${ok.length} 个角色卡` });
  };

  const handlePasteAdd = () => {
    if (!pasteText.trim()) {
      setNotice({ type: 'info', text: '请先粘贴 JSON 内容' });
      return;
    }

    try {
      const parsed = parseJson(pasteText.trim());
      const candidates: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
      const objects = candidates.filter((item) => isPlainObject(item)) as Record<string, unknown>[];
      const skipped = candidates.length - objects.length;

      if (objects.length === 0) {
        setNotice({ type: 'error', text: '未识别到可用的角色卡对象（请粘贴 JSON 对象或对象数组）' });
        return;
      }

      for (const obj of objects) {
        addMember(obj, 'paste');
      }
      setPasteText('');

      if (skipped > 0) {
        setNotice({ type: 'info', text: `已添加 ${objects.length} 个角色卡，另有 ${skipped} 条非对象内容已忽略` });
      } else {
        setNotice({ type: 'success', text: `已添加 ${objects.length} 个角色卡` });
      }
    } catch (error) {
      setNotice({ type: 'error', text: `解析失败：${error instanceof Error ? error.message : '未知错误'}` });
    }
  };

  const moveMember = (index: number, direction: -1 | 1) => {
    setMembers((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      const tmp = next[index];
      next[index] = next[target];
      next[target] = tmp;
      return next;
    });
  };

  const mergedResult = useMemo(() => {
    return mergeTeamDataCards(
      members.map((member) => ({ name: member.label, data: member.data })),
      { outputTemplate }
    );
  }, [members, outputTemplate]);

  const mergedData = mergedResult.data;
  const mergedTemplate = mergedResult.template;

  const tachiePrompt = useMemo(() => buildTachiePrompt(mergedData), [mergedData]);

  const gradientStyle = useMemo(() => {
    if (mergedTemplate !== 'magical-girl') return 'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)';
    const appearance = isPlainObject(mergedData.appearance) ? (mergedData.appearance as Record<string, unknown>) : null;
    const colorScheme = typeof appearance?.colorScheme === 'string' ? appearance.colorScheme : '';
    const mainColorName = Object.values(MainColor).find((color) => colorScheme.includes(color)) ?? MainColor.Pink;
    const colors = COLOR_GRADIENTS[mainColorName] ?? COLOR_GRADIENTS[MainColor.Pink];
    return `linear-gradient(135deg, ${colors.first} 0%, ${colors.second} 100%)`;
  }, [mergedTemplate, mergedData]);

  const mergedFileName = useMemo(() => {
    const base = mergedTemplate === 'general'
      ? (typeof mergedData.name === 'string' ? mergedData.name : '通用角色')
      : (typeof mergedData.codename === 'string' ? mergedData.codename : (typeof mergedData.name === 'string' ? mergedData.name : '角色组队'));
    return `数据卡_角色组队_${sanitizeFileName(base)}.json`;
  }, [mergedData, mergedTemplate]);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      setCloudCards([]);
      return;
    }

    let cancelled = false;
    setCloudLoading(true);
    dataCardApi
      .getCards(cloudSearch.trim() || undefined, cloudSortBy)
      .then((cards) => {
        if (cancelled) return;
        setCloudCards(Array.isArray(cards) ? cards : []);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('加载云端数据卡失败:', error);
        setNotice({ type: 'error', text: '加载云端数据卡失败，请稍后重试' });
      })
      .finally(() => {
        if (cancelled) return;
        setCloudLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authLoading, isAuthenticated, cloudSearch, cloudSortBy]);

  const cloudCharacterCards = useMemo(() => {
    return (cloudCards ?? [])
      .filter((card) => card?.type === 'character')
      .map((card) => {
        let payload: unknown = card.data;
        if (typeof payload === 'string') {
          try {
            payload = JSON.parse(payload);
          } catch {
            payload = null;
          }
        }
        const obj = isPlainObject(payload) ? payload : null;
        const tpl = obj ? inferTemplate(obj) : 'unknown';
        const displayName = obj ? getDisplayNameFromData(obj, typeof card?.name === 'string' ? card.name : '未命名角色') : (card?.name || '未知角色');
        return { card, payload: obj, template: tpl, displayName };
      });
  }, [cloudCards]);

  const handleCopyMergedJson = async () => {
    const ok = await copyTextToClipboard(JSON.stringify(mergedData, null, 2));
    setNotice(ok ? { type: 'success', text: '已复制到剪贴板' } : { type: 'error', text: '复制失败：浏览器不支持或权限不足' });
  };

  const handleSaveImageCallback = (imageUrl: string) => {
    setSavedImageUrl(imageUrl);
    setShowImageModal(true);
  };

  return (
    <>
      <Head>
        <title>角色组队 - 魔法少女生成器</title>
        <meta name="description" content="将多个角色卡拼接组合成一张角色卡，支持保存图片/下载/保存到云端与生成 LibLib 立绘。" />
      </Head>

      <div className="magic-background-white">
        <div className="container">
          <div className="card">
            <h1 className="title text-center">🧩 角色组队</h1>
            <p className="subtitle text-center">
              把多个角色卡拼接成一张“队伍角色卡”。字符串与数组会自动加上 <code>【角色名/代号】</code> 前缀，缺失字段会被自动忽略。
            </p>

            {notice && (
              <div
                className={`mt-4 rounded-lg border p-3 text-sm ${notice.type === 'error'
                  ? 'border-red-200 bg-red-50 text-red-700'
                  : notice.type === 'success'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-blue-200 bg-blue-50 text-blue-700'
                  }`}
              >
                {notice.text}
              </div>
            )}

            <div className="mt-6 grid gap-6 md:grid-cols-2">
              <div className="rounded-xl border border-gray-200 bg-white/70 p-4">
                <div className="text-base font-semibold text-gray-800">1) 从云端添加（可选）</div>
                <div className="mt-1 text-xs text-gray-600">登录后可直接选择你的云端数据卡加入队伍。</div>

                {!authLoading && !isAuthenticated ? (
                  <div className="mt-3 text-sm text-gray-700">
                    你尚未登录，先去 <Link className="footer-link" href="/character-manager">档案馆</Link> 登录后再回来吧。
                  </div>
                ) : (
                  <>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <input
                        value={cloudSearch}
                        onChange={(e) => setCloudSearch(e.target.value)}
                        placeholder="搜索云端数据卡（名称/描述）"
                        className="input-field flex-1"
                        disabled={cloudLoading}
                      />
                      <select
                        value={cloudSortBy}
                        onChange={(e) => setCloudSortBy(e.target.value as 'likes' | 'usage' | 'favorites' | 'created_at')}
                        className="input-field sm:w-40"
                        disabled={cloudLoading}
                      >
                        <option value="created_at">最新</option>
                        <option value="usage">使用</option>
                        <option value="favorites">收藏</option>
                        <option value="likes">点赞</option>
                      </select>
                    </div>

                    <div className="mt-3 max-h-80 overflow-y-auto rounded-lg border border-gray-200 bg-white">
                      {cloudLoading ? (
                        <div className="p-3 text-sm text-gray-600">加载中...</div>
                      ) : cloudCharacterCards.length === 0 ? (
                        <div className="p-3 text-sm text-gray-600">暂无角色数据卡</div>
                      ) : (
                        <ul className="divide-y divide-gray-100">
                          {cloudCharacterCards.map(({ card, payload, template, displayName }) => (
                            <li key={String(card.id)} className="flex items-start gap-3 p-3">
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-semibold text-gray-800">
                                  {displayName}
                                </div>
                                <div className="mt-1 text-xs text-gray-500">
                                  模板：{template in TEMPLATE_LABELS ? TEMPLATE_LABELS[template as keyof typeof TEMPLATE_LABELS] : '未知'}
                                </div>
                                {typeof card.description === 'string' && card.description.trim() ? (
                                  <div className="mt-1 line-clamp-2 text-xs text-gray-600">{card.description}</div>
                                ) : null}
                              </div>
                              <button
                                type="button"
                                className="rounded-lg border border-pink-200 bg-pink-50 px-3 py-1 text-xs font-semibold text-pink-700 hover:bg-pink-100 disabled:opacity-50"
                                disabled={!payload}
                                onClick={() => handleAddFromCloud(card)}
                              >
                                加入
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </>
                )}
              </div>

              <div className="rounded-xl border border-gray-200 bg-white/70 p-4">
                <div className="text-base font-semibold text-gray-800">2) 从本地添加</div>
                <div className="mt-1 text-xs text-gray-600">支持上传多个 <code>.json</code> 文件或粘贴 JSON 对象数组。</div>

                <div className="input-group mt-3">
                  <label className="input-label" htmlFor="team-upload-json">上传 JSON 文件（可多选）</label>
                  <input
                    id="team-upload-json"
                    type="file"
                    accept="application/json"
                    multiple
                    className="cursor-pointer input-field file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-pink-50 file:text-pink-700 hover:file:bg-pink-100"
                    onChange={(event) => void handleFilesSelected(event.target.files)}
                  />
                </div>

                <div className="input-group mt-3">
                  <label className="input-label" htmlFor="team-paste-json">粘贴 JSON（对象或对象数组）</label>
                  <textarea
                    id="team-paste-json"
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    className="input-field h-32 resize-y font-mono text-xs"
                    placeholder='示例：[{ "codename": "角色A", ... }, { "codename": "角色B", ... }]'
                  />
                  <button type="button" className="generate-button mt-2 mb-0" onClick={handlePasteAdd}>
                    解析并添加
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-6 rounded-xl border border-gray-200 bg-white/70 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-base font-semibold text-gray-800">队员列表</div>
                  <div className="mt-1 text-xs text-gray-600">顺序会影响合并结果（数组会按队员顺序依次展开）。</div>
                </div>
                <button
                  type="button"
                  className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  disabled={members.length === 0}
                  onClick={() => setMembers([])}
                >
                  清空队伍
                </button>
              </div>

              {members.length === 0 ? (
                <div className="mt-3 text-sm text-gray-600">暂无队员，先从上方添加角色卡吧。</div>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500">
                        <th className="py-2 pr-2">#</th>
                        <th className="py-2 pr-2">队员标识（用于前缀）</th>
                        <th className="py-2 pr-2">模板</th>
                        <th className="py-2 pr-2">来源</th>
                        <th className="py-2 pr-2 text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {members.map((member, index) => (
                        <tr key={member.id}>
                          <td className="py-2 pr-2 text-gray-500">{index + 1}</td>
                          <td className="py-2 pr-2">
                            <input
                              value={member.label}
                              onChange={(e) => {
                                const next = e.target.value;
                                setMembers((prev) => prev.map((item) => item.id === member.id ? { ...item, label: next } : item));
                              }}
                              className="input-field h-9"
                            />
                          </td>
                          <td className="py-2 pr-2 text-gray-700">
                            {member.template in TEMPLATE_LABELS ? TEMPLATE_LABELS[member.template as keyof typeof TEMPLATE_LABELS] : '未知'}
                          </td>
                          <td className="py-2 pr-2 text-gray-700">{SOURCE_LABELS[member.source]}</td>
                          <td className="py-2 pl-2">
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                disabled={index === 0}
                                onClick={() => moveMember(index, -1)}
                              >
                                上移
                              </button>
                              <button
                                type="button"
                                className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                disabled={index === members.length - 1}
                                onClick={() => moveMember(index, 1)}
                              >
                                下移
                              </button>
                              <button
                                type="button"
                                className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100"
                                onClick={() => setMembers((prev) => prev.filter((item) => item.id !== member.id))}
                              >
                                移除
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="mt-6 rounded-xl border border-gray-200 bg-white/70 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-base font-semibold text-gray-800">合并设置</div>
                  <div className="mt-1 text-xs text-gray-600">自动：同模板直接拼接；不同模板会自动转为通用角色卡。</div>
                </div>
                <select
                  value={outputTemplate}
                  onChange={(e) => setOutputTemplate(e.target.value as TeamMergeOutputTemplate)}
                  className="input-field sm:w-64"
                  disabled={members.length === 0}
                >
                  <option value="auto">自动（推荐）</option>
                  <option value="general">强制：通用角色卡（Markdown）</option>
                  <option value="magical-girl">强制：魔法少女（结构化）</option>
                  <option value="canshou">强制：残兽（结构化）</option>
                </select>
              </div>

              {mergedResult.warnings.length > 0 ? (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  <div className="font-semibold">提示</div>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {mergedResult.warnings.map((line, idx) => (
                      <li key={`warn-${idx}`}>{line}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>

            <div className="mt-6">
              <h2 className="text-center text-xl font-bold text-gray-800 mb-4">合并结果预览</h2>

              {mergedTemplate === 'magical-girl' ? (
                <MagicalGirlCard
                  magicalGirl={mergedData as any}
                  gradientStyle={gradientStyle}
                  onSaveImage={handleSaveImageCallback}
                />
              ) : mergedTemplate === 'canshou' ? (
                <CanshouCard
                  canshou={mergedData as any}
                  onSaveImage={handleSaveImageCallback}
                />
              ) : (
                <GeneralCharacterCard
                  general={mergedData as any}
                  onSaveImage={handleSaveImageCallback}
                />
              )}

              <div className="card" style={{ marginTop: '1rem' }}>
                <div className="text-center">
                  <h3 className="text-lg font-medium text-gray-800 mb-4">后续操作</h3>
                  <div className="flex flex-col sm:flex-row gap-3 justify-center">
                    <button
                      onClick={() => downloadJson(mergedData, mergedFileName)}
                      className="generate-button flex-1"
                      disabled={members.length === 0}
                    >
                      下载 JSON
                    </button>
                    {members.length === 0 ? (
                      <button className="generate-button flex-1" disabled>
                        保存到云端
                      </button>
                    ) : (
                      <SaveToCloudButton
                        data={mergedData}
                        cardType="character"
                        buttonText="保存到云端"
                        className="generate-button flex-1"
                        style={{ backgroundColor: '#22c55e', backgroundImage: 'linear-gradient(to right, #22c55e, #16a34a)' }}
                      />
                    )}
                    <button
                      onClick={() => void handleCopyMergedJson()}
                      className="generate-button flex-1"
                      style={{ backgroundColor: '#3b82f6', backgroundImage: 'linear-gradient(to right, #3b82f6, #2563eb)' }}
                      disabled={members.length === 0}
                    >
                      复制到剪贴板
                    </button>
                  </div>
                  <details className="mt-4 rounded-xl border border-gray-200 bg-white/70 p-3 text-left">
                    <summary className="cursor-pointer text-sm font-semibold text-gray-700">查看合并后的 JSON</summary>
                    <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-gray-900 p-3 text-xs text-gray-100">
                      {JSON.stringify(mergedData, null, 2)}
                    </pre>
                  </details>
                </div>
              </div>

              <details
                className="mt-6 rounded-xl border border-pink-200 bg-white/70 p-4"
                onToggle={(event) => setIsTachieVisible(event.currentTarget.open)}
              >
                <summary
                  className="cursor-pointer text-sm font-semibold text-pink-700"
                >
                  {isTachieVisible ? '▼' : '▶'} 生成 LibLib 立绘（可选）
                </summary>
                {isTachieVisible ? (
                  <div className="mt-3">
                    {tachiePrompt.trim() ? (
                      <TachieGenerator prompt={tachiePrompt} />
                    ) : (
                      <div className="text-sm text-gray-600">未能从当前队伍卡中提取立绘提示词（通常需要外观字段）。</div>
                    )}
                  </div>
                ) : null}
              </details>
            </div>

            <div className="text-center mt-8">
              <Link href="/" className="footer-link">返回首页</Link>
            </div>
          </div>

          <Footer className="footer" />
        </div>
      </div>

      {showImageModal && savedImageUrl ? (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4" onClick={() => setShowImageModal(false)}>
          <div className="bg-white rounded-lg max-w-lg w-full max-h-[80vh] overflow-auto relative" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 z-10 bg-white/95 backdrop-blur flex justify-end p-2">
              <button
                onClick={() => setShowImageModal(false)}
                aria-label="关闭"
                className="text-3xl leading-none text-gray-600 hover:text-gray-900"
              >
                ×
              </button>
            </div>
            <div className="px-4 pb-4">
              <p className="text-center text-sm text-gray-600 mb-2">📱 长按图片保存到相册</p>
              <img src={savedImageUrl} alt="角色卡片" className="w-full h-auto rounded-lg" />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
