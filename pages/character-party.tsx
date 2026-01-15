import React, { useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';

import BattleDataModal from '@/components/BattleDataModal';
import Footer from '@/components/Footer';
import MagicalGirlCard from '@/components/MagicalGirlCard';
import CanshouCard from '@/components/CanshouCard';
import GeneralCharacterCard from '@/components/GeneralCharacterCard';
import SaveToCloudButton from '@/components/SaveToCloudButton';
import TachieGenerator from '@/components/TachieGenerator';
import { DatabaseSelector } from '@/components/arena/components/DatabaseSelector';

import { useAuth } from '@/lib/useAuth';
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
  source: 'database' | 'file' | 'paste';
  dataCardId?: string;
  isNative: boolean | null;
};

type AddMemberOptions = {
  dataCardId?: string;
};

const SOURCE_LABELS: Record<TeamMember['source'], string> = {
  database: '数据库',
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

const removePrivateKeys = (obj: any): any => {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(removePrivateKeys);
  }
  const cleaned: any = {};
  for (const key of Object.keys(obj)) {
    if (!key.startsWith('_')) {
      cleaned[key] = removePrivateKeys(obj[key]);
    }
  }
  return cleaned;
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
  const { isAuthenticated } = useAuth();
  const router = useRouter();

  const [notice, setNotice] = useState<Notice>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [outputTemplate, setOutputTemplate] = useState<TeamMergeOutputTemplate>('auto');
  const [showDatabaseModal, setShowDatabaseModal] = useState(false);
  const [isDatabaseMatching, setIsDatabaseMatching] = useState<'character' | 'scenario' | null>(null);

  const [pasteText, setPasteText] = useState('');

  const [showImageModal, setShowImageModal] = useState(false);
  const [savedImageUrl, setSavedImageUrl] = useState<string | null>(null);

  const [isTachieVisible, setIsTachieVisible] = useState(false);

  const hasNonEmptySignature = (data: Record<string, unknown>): boolean =>
    typeof data.signature === 'string' && data.signature.trim().length > 0;

  const verifyOrigin = async (data: Record<string, unknown>): Promise<boolean> => {
    if (!hasNonEmptySignature(data)) return false;

    try {
      const response = await fetch('/api/verify-origin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) return false;
      const result = await response.json();
      return Boolean(result?.isValid);
    } catch {
      return false;
    }
  };

  const addMember = (
    payload: Record<string, unknown>,
    source: TeamMember['source'],
    label?: string,
    options?: AddMemberOptions,
  ) => {
    const id = randomUUID();
    const inferred = inferTemplate(payload);
    const displayName = (label && label.trim()) ? label.trim() : getDisplayNameFromData(payload);

    const shouldVerifyNative = hasNonEmptySignature(payload);
    setMembers((prev) => [
      ...prev,
      {
        id,
        label: displayName,
        data: payload,
        template: inferred,
        source,
        dataCardId: options?.dataCardId,
        isNative: shouldVerifyNative ? null : false,
      }
    ]);

    if (shouldVerifyNative) {
      void verifyOrigin(payload).then((isValid) => {
        setMembers((prev) => prev.map((item) => item.id === id ? { ...item, isNative: isValid } : item));
      });
    }
  };

  const ensureTeamNativeness = async (): Promise<boolean> => {
    const snapshot = members;
    if (snapshot.length === 0) return false;

    const verified = await Promise.all(
      snapshot.map(async (member) => {
        if (!hasNonEmptySignature(member.data)) {
          return { id: member.id, isNative: false };
        }
        const isValid = await verifyOrigin(member.data);
        return { id: member.id, isNative: isValid };
      })
    );

    setMembers((prev) => prev.map((item) => {
      const latest = verified.find((row) => row.id === item.id);
      if (!latest) return item;
      if (item.isNative === latest.isNative) return item;
      return { ...item, isNative: latest.isNative };
    }));

    return verified.every((row) => row.isNative);
  };

  const prepareMergedDataForExport = async (): Promise<Record<string, unknown> | null> => {
    if (members.length === 0) return null;

    const base = { ...mergedData };
    delete base.signature;
    delete base.isPreset;

    setNotice({ type: 'info', text: '正在检查队伍的原生性...' });
    const allNative = await ensureTeamNativeness();
    if (!allNative) {
      setNotice({ type: 'info', text: '队伍中存在非原生角色，本次输出将不包含原生签名。' });
      return base;
    }

    setNotice({ type: 'info', text: '正在请求服务器进行原生性签名认证...' });
    const response = await fetch('/api/resign-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(base),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      if (errorData?.shouldRedirect) {
        router.push({
          pathname: '/arrested',
          query: { reason: errorData.reason || '编辑内容不合规' }
        });
        return null;
      }
      throw new Error(errorData?.message || errorData?.error || '签名服务器认证失败');
    }

    const signed = await response.json();
    if (!isPlainObject(signed)) {
      setNotice({ type: 'error', text: '签名服务返回格式异常，已降级为非原生输出。' });
      return base;
    }

    const signature = signed.signature;
    if (typeof signature !== 'string' || !signature.trim()) {
      delete signed.signature;
      setNotice({ type: 'info', text: '当前环境未启用签名密钥，本次输出不会包含原生签名。' });
      return signed;
    }

    setNotice({ type: 'success', text: '原生性签名认证成功！' });
    return signed;
  };

  const handleCopyMergedJson = async () => {
    try {
      const exportData = await prepareMergedDataForExport();
      if (!exportData) return;
      const ok = await copyTextToClipboard(JSON.stringify(exportData, null, 2));
      setNotice(ok ? { type: 'success', text: '已复制到剪贴板' } : { type: 'error', text: '复制失败：浏览器不支持或权限不足' });
    } catch (error) {
      setNotice({ type: 'error', text: `复制失败：${error instanceof Error ? error.message : '未知错误'}` });
    }
  };

  const handleDownloadMergedJson = async () => {
    try {
      const exportData = await prepareMergedDataForExport();
      if (!exportData) return;
      downloadJson(exportData, mergedFileName);
    } catch (error) {
      setNotice({ type: 'error', text: `下载失败：${error instanceof Error ? error.message : '未知错误'}` });
    }
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
      addMember(item.data, 'file');
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

  const teamNativeness = useMemo(() => {
    if (members.length === 0) return { status: 'empty' as const };
    const allNative = members.every((member) => member.isNative === true);
    if (allNative) return { status: 'native' as const };
    const hasPending = members.some((member) => member.isNative === null);
    return { status: hasPending ? 'checking' as const : 'non-native' as const };
  }, [members]);

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

  const selectedDatabaseCardIds = useMemo(() => {
    const ids = new Set<string>();
    members.forEach((member) => {
      if (member.source !== 'database') return;
      if (typeof member.dataCardId === 'string' && member.dataCardId.trim()) {
        ids.add(member.dataCardId);
      }
    });
    return Array.from(ids);
  }, [members]);

  const selectedDatabaseCardIdSet = useMemo(() => new Set(selectedDatabaseCardIds), [selectedDatabaseCardIds]);

  const handleSelectDatabaseCharacterCard = (cardData: any) => {
    const rawName = typeof cardData?._cardName === 'string' ? cardData._cardName.trim() : '';
    const cardId = typeof cardData?._cardId === 'string' ? cardData._cardId : '';
    const cleaned = removePrivateKeys(cardData);
    if (!isPlainObject(cleaned)) {
      setNotice({ type: 'error', text: '数据卡格式无效，无法加入队伍' });
      return;
    }

    const inferred = inferTemplate(cleaned);
    if (inferred === 'scenario' || inferred === 'general-scenario') {
      setNotice({ type: 'error', text: '当前只支持添加“角色”类型的数据卡' });
      return;
    }

    const displayName = rawName || getDisplayNameFromData(cleaned);
    if (cardId && selectedDatabaseCardIdSet.has(cardId)) {
      setNotice({ type: 'info', text: `已在队伍中：${displayName}` });
      return;
    }
    addMember(cleaned, 'database', displayName, { dataCardId: cardId || undefined });
    setNotice({ type: 'success', text: `已加入队伍：${displayName}` });
  };

  const handleToggleDatabaseCharacterCard = (cardData: any, nextSelected: boolean) => {
    const cardId = typeof cardData?._cardId === 'string' ? cardData._cardId : '';
    if (nextSelected) {
      handleSelectDatabaseCharacterCard(cardData);
      return;
    }
    if (!cardId) return;
    setMembers((prev) => prev.filter((item) => item.dataCardId !== cardId));
    const displayName = typeof cardData?._cardName === 'string' ? cardData._cardName.trim() : '';
    setNotice({ type: 'info', text: displayName ? `已从队伍移除：${displayName}` : '已从队伍移除角色' });
  };

  const handleRandomMatchDatabaseCharacter = async () => {
    if (isDatabaseMatching !== null) return;

    setNotice({ type: 'info', text: '正在从数据库中随机寻找一位公开的角色...' });
    setIsDatabaseMatching('character');

    try {
      const response = await fetch('/api/random-public-card?type=character');
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.success) {
        throw new Error(result?.error || '无法获取随机角色');
      }

      const cardData = JSON.parse(result.card.data);
      handleSelectDatabaseCharacterCard({
        ...cardData,
        _cardId: result.card.id,
        _cardName: result.card.name,
        _cardDescription: result.card.description || '',
        _isPublic: result.card.is_public,
        _updatedAt: result.card.updated_at,
        _createdAt: result.card.created_at,
        _author: result.card.username || '未知',
      });
    } catch (error) {
      setNotice({ type: 'error', text: `随机匹配失败：${error instanceof Error ? error.message : '未知错误'}` });
    } finally {
      setIsDatabaseMatching(null);
    }
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
        <div className="container !max-w-[1100px]">
          <div className="card !max-w-none">
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

            <div className="mt-6 grid gap-6 lg:grid-cols-2 lg:items-start">
              <div className="space-y-6">
                <div className="rounded-xl border border-gray-200 bg-white/70 p-4">
                  <DatabaseSelector
                    className="!mb-0"
                    title="1) 从数据库添加（可选）"
                    onOpenCharacterModal={() => setShowDatabaseModal(true)}
                    onRandomMatchCharacter={() => void handleRandomMatchDatabaseCharacter()}
                    isAuthenticated={isAuthenticated}
                    isGenerating={false}
                    isMatching={isDatabaseMatching}
                    combatantCount={members.length}
                    maxCombatants={Number.MAX_SAFE_INTEGER}
                  />
                  <div className="mt-1 text-xs text-gray-600">
                    提示：浏览在线角色库可选择公开/私有数据卡；随机匹配仅从公开角色库中抽取。
                  </div>
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

                <div className="rounded-xl border border-gray-200 bg-white/70 p-4">
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
                            <th className="py-2 pr-2">原生性</th>
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
                              <td className="py-2 pr-2 text-gray-700">
                                {member.isNative === null ? (
                                  <span className="text-xs text-blue-700">验证中...</span>
                                ) : member.isNative ? (
                                  <span className="text-xs font-semibold text-green-700">原生</span>
                                ) : (
                                  <span className="text-xs text-gray-500">非原生</span>
                                )}
                              </td>
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

                <div className="rounded-xl border border-gray-200 bg-white/70 p-4">
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
              </div>

              <div className="space-y-6">
                <div>
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
                </div>

                <div className="card !max-w-none">
                  <div className="text-center">
                    <h3 className="text-lg font-medium text-gray-800 mb-4">后续操作</h3>
                    {teamNativeness.status !== 'empty' ? (
                      <div className="mb-3 text-xs">
                        {teamNativeness.status === 'native' ? (
                          <span className="text-green-700">✅ 队伍原生性：原生（下载/保存时会自动签名）</span>
                        ) : teamNativeness.status === 'checking' ? (
                          <span className="text-blue-700">⏳ 正在验证队伍原生性...</span>
                        ) : (
                          <span className="text-gray-600">⚠️ 队伍原生性：非原生（将不会生成原生签名）</span>
                        )}
                      </div>
                    ) : null}
                    <div className="flex flex-col sm:flex-row gap-3 justify-center">
                      <button
                        onClick={() => void handleDownloadMergedJson()}
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
                          getData={prepareMergedDataForExport}
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
                      <summary className="cursor-pointer text-sm font-semibold text-gray-700">查看合并后的 JSON（预览不含原生签名）</summary>
                      <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-gray-900 p-3 text-xs text-gray-100">
                        {JSON.stringify(mergedData, null, 2)}
                      </pre>
                    </details>
                  </div>
                </div>

                <details
                  className="rounded-xl border border-pink-200 bg-white/70 p-4"
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
            </div>

            <div className="text-center mt-8">
              <Link href="/" className="footer-link">返回首页</Link>
            </div>
          </div>

          <Footer className="footer" />
        </div>
      </div>

      <BattleDataModal
        isOpen={showDatabaseModal}
        onClose={() => setShowDatabaseModal(false)}
        onToggleCard={handleToggleDatabaseCharacterCard}
        selectedType="character"
        selectionMode="multi"
        selectedCardIds={selectedDatabaseCardIds}
      />

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
