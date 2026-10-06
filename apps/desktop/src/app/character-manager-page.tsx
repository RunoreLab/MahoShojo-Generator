import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useRouter, useSearch } from '@tanstack/react-router';
import { setDataCardFieldValue, type DataCardFieldAddon, type DataCardFieldPath } from '@mahoshojo/ui-web/card-editor';
import { CanshouCard, GeneralCharacterCard } from '@mahoshojo/ui-web/character-card';
import { MagicalGirlResultBody } from '@mahoshojo/ui-web/character-result';
import { LOCAL_CARD_TYPE_LABELS, LocalCardsPanel, useLocalCardsController, type LocalCardsHost } from '@mahoshojo/ui-web/local-cards';
import { buildSafeFileName } from '@mahoshojo/ui-web/client';
import { ProductFooter } from '@mahoshojo/ui-web/shell';
import type { HomeAssetSource } from '@mahoshojo/ui-web/home';
import {
  CardLibraryModal,
  type BattleSelectionPayload,
  type CardLibrarySelectionContext,
} from '@mahoshojo/ui-web/card-library';
import {
  CharacterManagerAccountPanel,
  CharacterManagerDraftBar,
  CharacterManagerEditorBody,
  CharacterManagerGuide,
  CharacterManagerImportSection,
  CharacterManagerPageHeader,
  CharacterManagerTemplateSelect,
  cardTopName,
  characterManagerNameFieldAddon,
  extractCardBaseName,
  replaceAllNamesInData,
  type CharacterManagerAccountStatus,
  type CharacterManagerCapabilities,
  type CharacterManagerFieldPath,
} from '@mahoshojo/ui-web/character-manager';
import { inferDataCardTemplate, type DataCardTemplate } from '@mahoshojo/domain/data-cards';
import { randomChooseOneHanaName } from '@mahoshojo/domain/flowers';
import type { LocalCardRecordV1 } from '@mahoshojo/local-library/record';

import { useLeaveGuard } from './useLeaveGuard';
import {
  EDITABLE_CARD_TYPES,
  MAX_IMPORT_FILE_BYTES,
  asCharacterCardPreview,
  cardTypeForTemplate,
  convertEditableCardData,
  createBlankEditableCardData,
  defaultCardTitle,
  draftFromRecord,
  inferEditableCardType,
  isEditableLocalCard,
  parseImportedCard,
  saveCardDraft,
  type CardDraft,
  type LocalCardType,
  type SaveOutcome,
} from '../features/character-manager/editor';
import {
  clearDesktopCharacterManagerDraft,
  readDesktopCharacterManagerDraft,
  writeDesktopCharacterManagerDraft,
  type StoredDesktopCardDraft,
} from '../features/character-manager/draft-persistence';
import { useDesktopCloudSession } from '../features/account/use-desktop-cloud-session';
import { useDesktopCardLibraryHost } from '../platform/card-library-host';
import { downloadTextFile } from '../platform/download-text-file';
import { IpcLocalCardRepository, describeLocalCardError } from '../platform/local-card-bridge';
import { useExternalLinks } from '../features/external-links/external-links-provider';
import { navigateByProductHref, resolveInternalHrefForHashHistory } from './hash-history-fragment';

/**
 * Desktop 的资源服务根（与 `routes.tsx` 中同名常量同义）：Tauri 自定义协议伺服 `dist/`，
 * 品牌资源位于 origin 根。宿主事实按文件各自声明，不跨页面共享易变常量。
 */
const DESKTOP_ASSET_SOURCE: HomeAssetSource = { baseUrl: '/' };

/**
 * Desktop 的角色管理能力快照（DESK-PARITY-001/005）：已交付的是浏览+载入云端卡、
 * 模板选择、结构化情景编辑器与本地库编辑；未交付的（立绘、问卷编辑器、原生性
 * 签名、敏感词）一律不渲染入口，与 Web 喂给同一组组件的只是不同快照。
 */
const DESKTOP_CHARACTER_MANAGER_CAPABILITIES: CharacterManagerCapabilities = {
  cloudCards: 'browse',
  tachie: false,
  questionnaireEditor: false,
  templateSelect: true,
  nativenessInfo: false,
  sensitiveWords: false,
  scenarioEditors: true,
};

const actionClass =
  'min-h-11 rounded-lg border border-(--app-border-strong) px-4 py-2 text-sm hover:bg-(--app-surface-90) disabled:cursor-not-allowed disabled:opacity-50';
const inputClass = 'min-h-11 w-full rounded-lg border border-(--app-border-strong) bg-transparent px-3 py-2 text-sm';

const snapshotOf = (draft: CardDraft): string => JSON.stringify([draft.cardType, draft.title, draft.data]);

/** 单卡导出文件名——与共享卡库 `handleDownloadCard` 同一共享实现（剥非法字符、基名截断 80 字符、保留中文）。 */
const cardExportFileName = (title: string): string => buildSafeFileName(title, 'json', '数据卡');

type Notice = { readonly tone: 'status' | 'alert'; readonly text: string };

/** 云端选择 payload 中由卡库 mapper 附加的元数据键（下划线开头但属于卡片正文的 `_battle_story`/`_mahoshojo` 不在其中）。 */
const CLOUD_CARD_META_KEYS = new Set([
  '_cardId', '_cardName', '_cardDescription', '_cardType', '_isPublic', '_storageLocation',
  '_updatedAt', '_createdAt', '_author', '_likeCount', '_favoriteCount', '_usageCount',
]);

const cloudPayloadToCardData = (payload: BattleSelectionPayload): Record<string, unknown> => {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!CLOUD_CARD_META_KEYS.has(key)) data[key] = value;
  }
  return data;
};

const deepCopyData = (data: Record<string, unknown>): Record<string, unknown> =>
  JSON.parse(JSON.stringify(data)) as Record<string, unknown>;

const isScenarioTemplate = (template: string): boolean =>
  template === 'scenario' || template === 'general-scenario';

/**
 * Desktop 本地角色管理（D3.2b-2；D5.1-P2-r5 产品面对齐）。
 *
 * 页面骨架（Logo/标题/账号区/使用指南/模板选择/草稿条/导入区/编辑主体/页脚）与
 * Web `/character-manager` 共用 `@mahoshojo/ui-web/character-manager` 同一组实现；
 * 差异经 `CharacterManagerCapabilities` 与宿主插槽投影：本机保存写入本地库（IPC），
 * 云端数据卡只可浏览并载入副本，立绘/问卷编辑器/原生性签名/敏感词这些尚未交付的
 * 能力不渲染入口。
 *
 * 保存规则见 `features/character-manager/editor`。页面草稿自动落到 localStorage
 * （与 Web 同一 key/版本/30 天 TTL），刷新或重启后可恢复；编辑中的未保存修改离开
 * 前仍需确认放弃（`DESK-PROD-007/008`）。
 */
export function DesktopCharacterManager() {
  const router = useRouter();
  const { openFixed } = useExternalLinks();
  const search = useSearch({ strict: false });
  const cardParam = typeof search.card === 'string' ? search.card : undefined;
  const repository = useMemo(() => new IpcLocalCardRepository((command, args) => invoke(command, args as never)), []);
  const cardsHost = useMemo<LocalCardsHost>(() => ({ store: repository, describeError: describeLocalCardError }), [repository]);
  const cards = useLocalCardsController(cardsHost);
  const cardLibraryHost = useDesktopCardLibraryHost();
  const { state: cloudSession, store: cloudSessionStore } = useDesktopCloudSession();
  const [draft, setDraft] = useState<CardDraft | null>(null);
  // 「一键换名」的对比基线：打开时的正文快照（编辑既有记录/导入内容各自记一份）。
  const [originalData, setOriginalData] = useState<Record<string, unknown> | null>(null);
  const [baseline, setBaseline] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null);
  const [replacedOriginalId, setReplacedOriginalId] = useState<string | null>(null);
  const [pasted, setPasted] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [autoSaveTimestamp, setAutoSaveTimestamp] = useState<number | null>(null);
  const [autoSaveFailed, setAutoSaveFailed] = useState(false);
  const [draftRestoreReady, setDraftRestoreReady] = useState(false);
  const titleId = useId();
  const typeId = useId();

  // 「未保存」是两个分开的概念（D5.1-P2-r5-r1）：
  // - hasUnsavedLocalRecord：草稿从未写入本地库（导入/云端副本/空白模板/跨类别转换产物）；
  // - hasUnsavedChanges：当前内容与打开基线不一致。
  // 离开保护覆盖两者——「清空本地草稿」只清 localStorage 副本，不该让未入库内容裸奔离开。
  const hasUnsavedChanges = draft !== null && baseline !== snapshotOf(draft);
  const hasUnsavedLocalRecord = draft !== null && draft.original === null;
  const needsLeaveGuard = hasUnsavedChanges || hasUnsavedLocalRecord;
  const unsavedGuardRef = useRef(false);
  unsavedGuardRef.current = needsLeaveGuard;
  const savingRef = useRef(false);
  const loadedIdRef = useRef<string | null>(null);
  const requestRef = useRef(0);
  /** 启动时与 `?card=` 无关的已存草稿：先挂起，由 URL 加载结果决定恢复还是放弃。 */
  const pendingStoredDraftRef = useRef<{ draft: StoredDesktopCardDraft; updatedAt: number } | null>(null);

  const guard = useLeaveGuard(
    () => savingRef.current || unsavedGuardRef.current,
    '有尚未保存到本地库的内容或未保存的修改，或保存仍在进行。请保存、等待完成，或确认放弃后再离开。',
    '窗口关闭保护初始化失败，保存暂不可用。请重新打开页面后重试。',
    () => !savingRef.current && window.confirm('有尚未保存到本地库的内容或未保存的修改。确认放弃并离开？'),
  );

  const open = useCallback((next: CardDraft) => {
    setDraft(next);
    setBaseline(snapshotOf(next));
    setOriginalData(deepCopyData(next.data));
    setOutcome(null);
    setReplacedOriginalId(null);
  }, []);

  // 恢复未提交的工作区草稿——baseline 语义与 `open` 不同（D5.1-P2-r5-r2）：
  // - 原记录仍在本地库：baseline = 最新记录，current = 草稿——恢复出的草稿
  //   保持 dirty、可保存、受离开保护，而不是以草稿自身为基线误判成「无修改」；
  // - detached（导入/云端副本/原记录已不可用）：baseline = 草稿自身——整份内容
  //   按未入库处理，离开保护由 `hasUnsavedLocalRecord` 承担；
  // - 标题一律取草稿的：它可能带有未保存的标题修改。
  const restore = useCallback((storedDraft: StoredDesktopCardDraft, original: LocalCardRecordV1 | null) => {
    const next: CardDraft = {
      original,
      cardType: original?.cardType ?? storedDraft.cardType,
      title: storedDraft.title,
      data: storedDraft.data,
    };
    setDraft(next);
    setBaseline(snapshotOf(original === null ? next : draftFromRecord(original)));
    setOriginalData(storedDraft.originalData ?? deepCopyData(storedDraft.data));
    setOutcome(null);
    setReplacedOriginalId(null);
  }, []);

  /**
   * 回取 stored draft 指向的原记录并恢复草稿；原记录已删除/不可编辑/读取失败
   * 时按 detached 草稿降级，绝不把陈旧副本当成本地库事实。
   * `prefix` 非空时以 alert 叠加展示（用于「URL 记录读取失败 + 已恢复草稿」）；
   * `shouldAbort` 供调用方丢弃过期结果（对应 cleanup/新请求抢占）。
   */
  const restoreStoredDraft = useCallback(
    (
      storedDraft: StoredDesktopCardDraft,
      updatedAt: number,
      prefix: string | null = null,
      shouldAbort: () => boolean = () => false,
    ) => {
      const apply = (original: LocalCardRecordV1 | null) => {
        if (shouldAbort()) return;
        restore(storedDraft, original);
        setAutoSaveTimestamp(updatedAt);
        const restoredText = original === null && storedDraft.originalId !== null
          ? '已恢复浏览器内的编辑草稿；原本地库记录已不可用，草稿按未保存的导入卡处理。'
          : '已恢复浏览器内的编辑草稿。';
        setNotice(prefix === null
          ? { tone: 'status', text: restoredText }
          : { tone: 'alert', text: `${prefix} ${restoredText}` });
        setDraftRestoreReady(true);
      };
      if (storedDraft.originalId !== null) {
        void repository.get(storedDraft.originalId).then(
          (record) => apply(record !== null && record.deletedAt === undefined && isEditableLocalCard(record) ? record : null),
          () => apply(null),
        );
        return;
      }
      apply(null);
    },
    [restore, repository],
  );

  const closeEditor = useCallback(() => {
    loadedIdRef.current = null;
    // 作废在途的 `?card` 读取，避免关闭后又被迟到的响应重新打开。
    requestRef.current += 1;
    setLoading(false);
    setDraft(null);
    setOriginalData(null);
    setBaseline(null);
    setOutcome(null);
    setReplacedOriginalId(null);
    cards.controller.actions.reload();
  }, [cards.controller.actions]);

  // 页面草稿恢复：与 `?card=` 直达按身份裁决（D5.1-P2-r5-r2）——
  // - `storedDraft.originalId === cardParam`：同一编辑会话的刷新，恢复草稿叠到
  //   最新 original 上；预占 `loadedIdRef` 让 URL 加载 effect 跳过（草稿才是
  //   未提交的最新工作区，重新载入记录会丢修改）；
  // - 草稿与 cardParam 无关：URL 是显式新意图——先挂起旧草稿，等 URL 加载落定
  //   再由加载 effect 处置；读取失败必须把旧草稿恢复回来，绝不能让自动保存的
  //   空态顺手销毁它；
  // - 无 cardParam：直接恢复草稿。
  // `draftRestoreReady` 是自动保存的闸门（与 Web `draftRestoreReady` 同一模式）——
  // 待恢复/待裁决的草稿尚未落定前自动保存不启动，空初始态不会盖掉它。
  useEffect(() => {
    if (draftRestoreReady) return;
    const stored = readDesktopCharacterManagerDraft();
    const storedDraft = stored?.payload.draft ?? null;
    const pastedJson = stored?.payload.pastedJson ?? '';
    if (pastedJson.trim() !== '') {
      setPasted(pastedJson);
      setPasteOpen(true);
    }
    if (cardParam !== undefined && storedDraft?.originalId !== cardParam) {
      pendingStoredDraftRef.current = storedDraft !== null && stored !== null
        ? { draft: storedDraft, updatedAt: stored.updatedAt }
        : null;
      // 无挂起草稿时立即可 armed；有挂起草稿时 ready 由 URL 加载 effect 在
      // 落定后翻转——否则自动保存先以空态清掉旧草稿，加载失败便无可恢复。
      if (storedDraft === null) setDraftRestoreReady(true);
      return;
    }
    if (cardParam !== undefined) loadedIdRef.current = cardParam;
    if (storedDraft === null || stored === null) {
      if (stored !== null) setAutoSaveTimestamp(stored.updatedAt);
      setDraftRestoreReady(true);
      return;
    }
    let cancelled = false;
    restoreStoredDraft(storedDraft, stored.updatedAt, null, () => cancelled);
    return () => { cancelled = true; };
  }, [cardParam, draftRestoreReady, restoreStoredDraft]);

  // 页面草稿自动持久化：每次编辑后落 localStorage（同 Web 的产品语义）。
  // 空态清除、失败显式报告——不能静默沿用旧时间戳伪装「已自动保存」。
  useEffect(() => {
    if (!draftRestoreReady) return;
    const result = writeDesktopCharacterManagerDraft({
      pastedJson: pasted,
      draft: draft === null ? null : {
        cardType: draft.cardType,
        title: draft.title,
        data: draft.data,
        originalId: draft.original?.id ?? null,
        originalData,
      },
    });
    if (result.kind === 'written') {
      setAutoSaveTimestamp(result.stored.updatedAt);
      setAutoSaveFailed(false);
    } else if (result.kind === 'cleared') {
      setAutoSaveTimestamp(null);
      setAutoSaveFailed(false);
    } else {
      setAutoSaveTimestamp(null);
      setAutoSaveFailed(true);
    }
  }, [draft, originalData, pasted, draftRestoreReady]);

  // `?card=` 是打开记录的唯一入口；切换记录时由离开保护先确认是否放弃当前修改。
  // 启动时若挂起了与 cardParam 无关的旧草稿，本 effect 在加载落定后处置并翻转
  // `draftRestoreReady`：成功则以新记录接管编辑器（旧 scratch 由自动保存自然覆盖）；
  // 失败则把挂起草稿恢复回编辑器——URL 打不开不是销毁旧草稿的理由。
  useEffect(() => {
    if (cardParam === undefined) {
      const pending = pendingStoredDraftRef.current;
      pendingStoredDraftRef.current = null;
      const hadLoaded = loadedIdRef.current !== null;
      if (hadLoaded) closeEditor();
      if (pending !== null) {
        // 恢复期间再进入新的 `?card` 时，由 request 序号丢弃过期的恢复结果。
        const request = ++requestRef.current;
        restoreStoredDraft(pending.draft, pending.updatedAt, null, () => request !== requestRef.current);
      } else if (hadLoaded) {
        setDraftRestoreReady(true);
      }
      return;
    }
    if (loadedIdRef.current === cardParam) return;
    loadedIdRef.current = cardParam;
    const request = ++requestRef.current;
    setLoading(true);
    setNotice(null);
    const fail = (text: string) => {
      loadedIdRef.current = null;
      const pending = pendingStoredDraftRef.current;
      pendingStoredDraftRef.current = null;
      if (pending === null) {
        setDraft(null);
        setNotice({ tone: 'alert', text });
        setDraftRestoreReady(true);
        return;
      }
      // 恢复旧草稿时保留加载失败的原因。
      restoreStoredDraft(pending.draft, pending.updatedAt, text, () => request !== requestRef.current);
    };
    void repository.get(cardParam).then((record) => {
      if (request !== requestRef.current) return;
      if (record === null) fail('本地库中没有这张数据卡，它可能已被彻底删除。');
      else if (record.deletedAt !== undefined) fail('这张数据卡在回收站中，恢复后才能编辑。');
      else if (!isEditableLocalCard(record)) fail('本页只编辑角色与情景卡；问卷与叙事历史卡暂不支持。');
      else {
        pendingStoredDraftRef.current = null;
        open(draftFromRecord(record));
        setDraftRestoreReady(true);
      }
    }).catch((cause: unknown) => {
      if (request !== requestRef.current) return;
      fail(describeLocalCardError(cause));
    }).finally(() => {
      if (request === requestRef.current) setLoading(false);
    });
  }, [cardParam, closeEditor, open, repository, restoreStoredDraft]);

  const openRecord = (id: string) => {
    void router.navigate({ to: '/character-manager', search: { card: id } });
  };
  const leaveEditor = () => {
    if (cardParam !== undefined) {
      void router.navigate({ to: '/character-manager', search: {} });
      return;
    }
    if (needsLeaveGuard && !window.confirm('当前内容尚未写入本地库，或有未保存的修改。确认放弃并关闭？')) return;
    closeEditor();
  };

  const importText = (text: string) => {
    const parsed = parseImportedCard(text);
    if (!parsed.ok) {
      setNotice({ tone: 'alert', text: parsed.error });
      return;
    }
    setNotice({ tone: 'status', text: '已载入数据卡，尚未保存到本地库。' });
    open(parsed.draft);
  };

  const handleFieldChange = useCallback((path: CharacterManagerFieldPath, value: unknown) => {
    // 字符串路径按点分段展开（与 Web `handleFieldChange` 同一语义：ScenarioEditor
    // 等旧调用方发 `elements.scene.time` 形态）；数组路径来自共源字段编辑器逐段键名。
    const segments: DataCardFieldPath = typeof path === 'string' ? path.split('.') : path;
    setDraft((current) => (current === null ? current : { ...current, data: setDataCardFieldValue(current.data, segments, value) }));
  }, []);

  // 一键替换所有旧名称（与 Web 同一共享规则；本机没有原生签名语义，提示按本机口径）。
  const handleReplaceAllNames = useCallback(() => {
    if (draft === null || originalData === null) return;
    const oldName = cardTopName(originalData);
    const newName = cardTopName(draft.data);
    if (oldName === undefined || newName === undefined) return;
    const oldBaseName = extractCardBaseName(oldName);
    const newBaseName = extractCardBaseName(newName);
    setDraft((current) => (current === null ? current : { ...current, data: replaceAllNamesInData(current.data, oldBaseName, newBaseName) }));
    setOriginalData((current) => (current === null ? current : replaceAllNamesInData(current, oldBaseName, newBaseName)));
    setNotice({ tone: 'status', text: `已将所有“${oldBaseName}”替换为“${newBaseName}”。` });
  }, [draft, originalData]);

  const renderFieldAddon = useCallback(
    (path: DataCardFieldPath): DataCardFieldAddon => characterManagerNameFieldAddon(path, {
      data: draft?.data ?? null,
      originalData,
      onRandomCodename: () => handleFieldChange('codename', randomChooseOneHanaName()),
      onReplaceAllNames: handleReplaceAllNames,
      replaceHint: (
        <p className="text-xs text-gray-500 mt-1">
          提示：替换只作用于当前编辑中的正文；本机不维护数字签名，保存时另存为一条新记录。
        </p>
      ),
    }),
    [draft?.data, originalData, handleFieldChange, handleReplaceAllNames],
  );

  const selectedTemplate = draft === null ? 'unknown' : inferDataCardTemplate(draft.data);

  const handleTemplateSelect = useCallback((target: DataCardTemplate) => {
    try {
      if (draft === null) {
        const data = createBlankEditableCardData(target);
        open({ original: null, cardType: cardTypeForTemplate(target), title: defaultCardTitle(data), data });
        setNotice({ tone: 'status', text: '已按所选模板创建空白数据卡，尚未保存到本地库。' });
        return;
      }
      const source = inferDataCardTemplate(draft.data);
      const result = convertEditableCardData(draft.data, target, source === 'unknown' ? undefined : source);
      const converted = result.data as Record<string, unknown>;
      const warnings = result.warnings.length > 0 ? `（${result.warnings.join('；')}）` : '';
      const targetCardType = cardTypeForTemplate(target);
      if (draft.original !== null && targetCardType !== draft.cardType) {
        // 跨类别转换 = 显式重新分类：产出一份新的未保存草稿（新 cardType），
        // 原本地记录不被原地重分类——既有记录的 cardType 创建后不可改。
        open({ original: null, cardType: targetCardType, title: draft.title, data: converted });
        setNotice({
          tone: 'status',
          text: `已转换为目标模板${warnings}并脱离原本地库记录：保存将写入一条新记录，原记录保持不变。`,
        });
        return;
      }
      setDraft((current) => (current === null ? current : { ...current, cardType: targetCardType, data: converted }));
      // 与 Web 一致：模板转换重置名称替换基线，避免对旧名称做整文替换。
      setOriginalData(deepCopyData(converted));
      setNotice({ tone: 'status', text: `已转换当前内容为目标模板${warnings}，尚未保存到本地库。` });
    } catch (cause) {
      setNotice({ tone: 'alert', text: cause instanceof Error ? cause.message : '模板转换失败。' });
    }
  }, [draft, open]);

  const handleClearDraft = useCallback(() => {
    // 清除失败不能报成已清空（与自动保存 `written/cleared/failed` 同一诚实口径）。
    if (!clearDesktopCharacterManagerDraft()) {
      setNotice({ tone: 'alert', text: '清空浏览器内草稿失败：本地存储不可用，草稿仍保留。' });
      return;
    }
    setAutoSaveTimestamp(null);
    setAutoSaveFailed(false);
    setNotice({ tone: 'status', text: '浏览器内的本地草稿已清空（当前编辑内容与本地库记录不受影响）。' });
  }, []);

  // 「我的数据卡」：本地行直接以 `?card=` 打开记录（走既有加载与离开保护），
  // 云端行按内容副本载入为未保存草稿——不持有云端身份，不做写回。
  const handleSelectLibraryCard = useCallback((payload: BattleSelectionPayload, context: CardLibrarySelectionContext) => {
    // 仲裁在途时入口本应不可达；此处兜底，避免迟到恢复覆盖刚选入的内容。
    if (!draftRestoreReady) return;
    if (context.storageLocation === 'local') {
      const id = context.selectionId.startsWith('local:') ? context.selectionId.slice('local:'.length) : null;
      if (id !== null) openRecord(id);
      return;
    }
    if (unsavedGuardRef.current && !window.confirm('载入新数据卡将放弃当前尚未保存到本地库的内容。继续？')) return;
    const data = cloudPayloadToCardData(payload);
    open({
      original: null,
      cardType: inferEditableCardType(data),
      title: typeof payload._cardName === 'string' && payload._cardName !== ''
        ? payload._cardName.slice(0, 512)
        : defaultCardTitle(data),
      data,
    });
    setNotice({ tone: 'status', text: '已从云端载入数据卡副本，尚未保存到本地库；副本不携带云端身份。' });
  }, [open, openRecord, draftRestoreReady]);

  const save = async () => {
    if (draft === null || savingRef.current || !guard.ready) return;
    savingRef.current = true;
    setSaving(true);
    setNotice(null);
    let savedId: string | null = null;
    try {
      const result = await saveCardDraft(repository, draft);
      setOutcome(result);
      if (result.kind === 'updated' || result.kind === 'created') {
        const saved = { ...draft, original: result.record, title: result.record.title };
        if (result.kind === 'created' && draft.original !== null) setReplacedOriginalId(draft.original.id);
        loadedIdRef.current = result.record.id;
        // 同步清掉未保存标记：随后的 URL 替换不该被离开保护当成“放弃修改”。
        unsavedGuardRef.current = false;
        setDraft(saved);
        setBaseline(snapshotOf(saved));
        // 名称替换基线跟随保存后的记录：「原始」即本地库当前内容。
        setOriginalData(deepCopyData(saved.data));
        cards.controller.actions.reload();
        savedId = result.record.id;
      }
    } catch (cause) {
      setNotice({ tone: 'alert', text: describeLocalCardError(cause) });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
    // 保存结束后才替换 URL：保存在途时离开保护会（正确地）拦下任何导航。
    if (savedId !== null && cardParam !== savedId) {
      void router.navigate({ to: '/character-manager', search: { card: savedId }, replace: true });
    }
  };

  const restoreFromRecycleBin = async (id: string) => {
    try {
      await repository.restore(id);
      cards.controller.actions.reload();
      // 恢复的就是当前正文（同一摘要），直接打开恢复后的记录，不再把草稿当成待放弃的修改。
      unsavedGuardRef.current = false;
      openRecord(id);
    } catch (cause) {
      setNotice({ tone: 'alert', text: describeLocalCardError(cause) });
    }
  };

  const moveOriginalToRecycleBin = async (id: string) => {
    try {
      await repository.delete(id);
      setReplacedOriginalId(null);
      setNotice({ tone: 'status', text: '原记录已移入回收站，可在本地库恢复。' });
      cards.controller.actions.reload();
    } catch (cause) {
      setNotice({ tone: 'alert', text: describeLocalCardError(cause) });
    }
  };

  const preview = draft === null ? null : asCharacterCardPreview(draft);

  // 云会话 → 共享账号面板投影（与顶栏/卡库宿主同一三态口径，D5.1-P2-r5-r1）：
  // `idle` 与 `unreachable` 都是 `unknown`——「从未查询过」和「服务不可达」都不是
  // 确认登出；只有 ready+signed-out/expired 才投影 `unauthenticated`。
  const cloudPhase = cloudSession.phase;
  const activeCloudAccount =
    cloudPhase.kind === 'ready' && cloudPhase.session.state === 'active' ? cloudPhase.session.account : null;
  const accountStatus: CharacterManagerAccountStatus =
    cloudPhase.kind === 'checking' || cloudPhase.kind === 'authenticating'
      ? 'loading'
      : activeCloudAccount !== null
        ? 'authenticated'
        : cloudPhase.kind === 'ready' &&
            (cloudPhase.session.state === 'signed-out' || cloudPhase.session.state === 'expired')
          ? 'unauthenticated'
          : 'unknown';
  const cloudUnreachable = cloudPhase.kind === 'ready' && cloudPhase.session.state === 'unreachable';

  const draftTemplate = draft === null ? 'unknown' : inferDataCardTemplate(draft.data);
  const editorTitle = draft === null
    ? null
    : isScenarioTemplate(draftTemplate)
      ? `编辑情景: ${typeof draft.data.title === 'string' && draft.data.title !== '' ? draft.data.title : (typeof draft.data.name === 'string' ? draft.data.name : draft.title)}`
      : `编辑角色: ${typeof draft.data.codename === 'string' && draft.data.codename !== '' ? draft.data.codename : (typeof draft.data.name === 'string' && draft.data.name !== '' ? draft.data.name : draft.title)}`;

  return (
    <section data-testid="page-character-manager" className="magic-background-white">
      <div className="container">
        <div className="card">
          <CharacterManagerPageHeader
            notice={(
              <div className="flex mb-3 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800 text-left">
                <div className="mr-2">⚠️ </div>
                <div>
                  本页只操作这台设备上的本地库：编辑不需要账号，也不会访问项目服务器（除非你主动浏览云端数据卡）。
                  云端保存、原生性校验与敏感词检测目前只在网页版提供。
                </div>
              </div>
            )}
          >
            <CharacterManagerAccountPanel
              status={accountStatus}
              userDisplay={activeCloudAccount === null ? null : (
                <span className="text-sm text-pink-700">{activeCloudAccount.displayName ?? activeCloudAccount.username}</span>
              )}
              actions={activeCloudAccount === null ? null : (
                <button
                  onClick={() => void cloudSessionStore.signOut()}
                  className="px-3 py-1.5 text-xs bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  退出登录
                </button>
              )}
              myDataCards={draftRestoreReady ? {
                // 主动使用 = 探测时机（DESK-ONLINE-013，与 /details 同一模式）：
                // 冷启动 `idle` 下机器上可能已有有效凭据，先 refresh 再开选择器，
                // 确认 active 后「我的数据卡」默认落到 `my` 页签而不是本地库。
                onOpen: () => {
                  void cloudSessionStore.refresh();
                  setLibraryOpen(true);
                },
                label: '我的数据卡',
              } : undefined}
              signedOut={{
                text: cloudUnreachable
                  ? '云端服务暂时不可用；本地编辑与本地库不受影响，可稍后重试登录。'
                  : accountStatus === 'unknown'
                    ? '本页无需登录即可编辑本地数据卡；尚未查询云端账号状态。'
                    : '本页无需登录即可编辑本地数据卡；登录后可浏览并载入你的云端数据卡。',
                actionLabel: cloudUnreachable ? '重试' : '登录',
                onAction: () => void (cloudUnreachable ? cloudSessionStore.refresh() : cloudSessionStore.requestAuth()),
              }}
            />
          </CharacterManagerPageHeader>

          {!guard.ready && !guard.message && <p role="status">正在初始化窗口关闭保护…</p>}
          {guard.message && <p role="alert">{guard.message}</p>}

          <CharacterManagerGuide
            capabilities={DESKTOP_CHARACTER_MANAGER_CAPABILITIES}
            saveAndExportText={(
              <>保存写入这台设备的本地库；也可以把当前编辑中的内容导出为 <code>.json</code> 文件。</>
            )}
            loadExtraText={<>也可以通过上方「我的数据卡」从本地库或云端数据卡载入。</>}
            extraSections={(
              <div>
                <h4 className="font-semibold text-gray-800">关于本地保存：</h4>
                <ul className="list-disc list-inside space-y-1 mt-1 pl-2">
                  <li>“保存到本地库”会写入本机本地库；正文改变时另存为一条新记录，原记录保留。</li>
                  <li>本机不校验数字签名：正文里已有的签名字段会原样保存，但新记录不继承签名标记。</li>
                  <li>问卷与叙事历史卡有专用编辑器，本页只编辑角色与情景卡。</li>
                </ul>
              </div>
            )}
          />

          {!draftRestoreReady ? (
            // 草稿仲裁在途（旧草稿/目标记录的异步读取未落定）：不挂载任何会改变
            // 工作区的入口——模板选择、导入区、本地卡列表与「我的数据卡」一律暂不
            // 提供，避免迟到的恢复覆盖用户在此期间的新操作（D5.1-P2-r5-r3）。
            <p role="status" className="mb-4 text-sm">正在恢复页面草稿或读取目标数据卡…</p>
          ) : (
            <>
          <CharacterManagerTemplateSelect
            value={selectedTemplate}
            hasContent={draft !== null}
            onSelect={handleTemplateSelect}
            hintText={draft === null
              ? '未加载内容时，选择模板将创建对应的空白数据卡；确认保存后才写入本地库。'
              : '切换模板会尝试根据规则转换当前内容；转换结果保存后写入本地库。'}
          />

          <CharacterManagerDraftBar
            savedAt={autoSaveTimestamp}
            onClear={handleClearDraft}
            pendingText={autoSaveFailed
              ? '页面草稿自动保存暂不可用，当前修改不会被持久化。'
              : undefined}
          />
          {autoSaveFailed && (
            <p role="alert" className="mb-4 text-sm text-red-700">
              页面草稿自动保存失败（可能超出浏览器存储上限）：当前修改只在内存中，请及时保存到本地库或导出。
            </p>
          )}

          {notice && <p role={notice.tone} className="mb-4 text-sm">{notice.text}</p>}
          {loading && <p role="status" className="mb-4 text-sm">正在读取本地数据卡…</p>}

          {draft === null ? (
            <>
              <CharacterManagerImportSection
                onFile={(file) => {
                  if (file.size > MAX_IMPORT_FILE_BYTES) {
                    setNotice({ tone: 'alert', text: '文件超过单张数据卡的大小上限（4 MiB）。' });
                    return;
                  }
                  void file.text().then(importText, () => setNotice({ tone: 'alert', text: '读取文件失败，请重试。' }));
                }}
                fileLabel="上传 .json 设定文件（支持角色、情景、万途通用卡）"
                fileExtra={(
                  <p className="mt-2 text-xs text-gray-500">
                    载入后可先编辑，确认保存后才写入本地库；同内容的卡不会重复保存。
                  </p>
                )}
                pasteOpen={pasteOpen}
                onPasteOpenChange={setPasteOpen}
                pasteValue={pasted}
                onPasteChange={setPasted}
                onPasteLoad={() => importText(pasted)}
                pasteBusy={false}
              />
              <LocalCardsPanel
                model={cards.model}
                actions={cards.controller.actions}
                onEdit={(record) => openRecord(record.id)}
                canEdit={isEditableLocalCard}
              />
            </>
          ) : (
            <section className="flex flex-col gap-4" aria-labelledby="character-editor-heading">
              <CharacterManagerEditorBody
                data={draft.data}
                onFieldChange={handleFieldChange}
                title={<span id="character-editor-heading">{editorTitle}</span>}
                badge={(
                  <span className={`px-3 py-1 text-xs font-semibold rounded-full ${draft.original === null ? 'text-yellow-800 bg-yellow-100' : hasUnsavedChanges ? 'text-amber-800 bg-amber-100' : 'text-green-800 bg-green-100'}`}>
                    {draft.original === null ? '尚未保存到本地库' : '本地库记录'}{hasUnsavedChanges ? ' · 有未保存的修改' : ''}
                  </span>
                )}
                headerExtra={(
                  <>
                    <div className="grid gap-3 sm:grid-cols-[1fr,auto]">
                      <label htmlFor={titleId} className="flex flex-col gap-1 text-sm">
                        记录标题
                        <input id={titleId} value={draft.title} maxLength={512} onChange={(event) => setDraft({ ...draft, title: event.target.value })} className={inputClass} />
                      </label>
                      <label htmlFor={typeId} className="flex flex-col gap-1 text-sm">
                        类型{draft.original === null ? '' : '（创建后不可修改）'}
                        {draft.original === null ? (
                          <select
                            id={typeId}
                            value={draft.cardType}
                            onChange={(event) => setDraft({ ...draft, cardType: event.target.value as LocalCardType })}
                            className={inputClass}
                          >
                            {EDITABLE_CARD_TYPES.map((type) => <option key={type} value={type}>{LOCAL_CARD_TYPE_LABELS[type]}</option>)}
                          </select>
                        ) : (
                          <input
                            id={typeId}
                            value={LOCAL_CARD_TYPE_LABELS[draft.cardType]}
                            readOnly
                            className={`${inputClass} cursor-not-allowed opacity-70`}
                          />
                        )}
                      </label>
                    </div>
                    <p className="mt-2 text-xs text-gray-500">
                      标题与既有记录的类型不影响内容身份。修改正文会另存为一条新记录，原记录保留；正文中已有的签名字段原样保存，本机不校验签名，新记录标记为无签名。
                    </p>
                  </>
                )}
                renderFieldAddon={renderFieldAddon}
                currentStateSummaryHint="当前状态只写入本机本地库；本机不校验数字签名。请尽量统一使用状态摘要，避免随意增加自定义字段。"
                bottomActions={(
                  <>
                    <div className="mt-8 pt-4 border-t flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={actionClass}
                        disabled={!guard.ready || saving || (draft.original !== null && !hasUnsavedChanges)}
                        onClick={() => void save()}
                      >
                        {saving ? '正在保存…' : '保存到本地库'}
                      </button>
                      <button
                        type="button"
                        className={actionClass}
                        disabled={saving}
                        title="导出的是当前编辑中的内容，不要求先保存到本地库"
                        onClick={() => downloadTextFile(cardExportFileName(draft.title), JSON.stringify(draft.data, null, 2))}
                      >
                        导出为 JSON 文件
                      </button>
                      <button type="button" className={actionClass} disabled={saving} onClick={leaveEditor}>
                        {needsLeaveGuard ? '放弃修改并关闭' : '关闭'}
                      </button>
                    </div>
                    {outcome?.kind === 'unchanged' && <p role="status" className="text-sm">没有需要保存的修改。</p>}
                    {outcome?.kind === 'updated' && <p role="status" className="text-sm">已更新本地库中的记录。</p>}
                    {outcome?.kind === 'created' && (
                      <div role="status" className="text-sm">
                        <p>{replacedOriginalId === null ? '已保存到本地库。' : '正文已改变，已另存为一条新记录；原记录仍在本地库。'}</p>
                        {replacedOriginalId !== null && (
                          <button type="button" className={`${actionClass} mt-2`} onClick={() => void moveOriginalToRecycleBin(replacedOriginalId)}>
                            将原记录移入回收站
                          </button>
                        )}
                      </div>
                    )}
                    {outcome?.kind === 'exists' && (
                      <div role="status" className="text-sm">
                        <p>本地库已有内容相同的记录，未重复保存。</p>
                        <button type="button" className={`${actionClass} mt-2`} onClick={() => openRecord(outcome.id)}>打开已有记录</button>
                      </div>
                    )}
                    {outcome?.kind === 'in-recycle-bin' && (
                      <div role="status" className="text-sm">
                        <p>内容相同的记录在回收站中。保存不会自动恢复它。</p>
                        <button type="button" className={`${actionClass} mt-2`} onClick={() => void restoreFromRecycleBin(outcome.id)}>
                          从回收站恢复并打开
                        </button>
                      </div>
                    )}
                    {outcome?.kind === 'document-too-large' && (
                      <p role="alert" className="text-sm">保存后的本地库记录超过大小上限（4 MiB），请精简正文后重试。</p>
                    )}
                  </>
                )}
              />
              {preview !== null && (
                <details>
                  <summary className="cursor-pointer text-sm font-medium">角色卡预览</summary>
                  <div className="mt-2">
                    {preview.kind === 'magical-girl' && <MagicalGirlResultBody magicalGirl={preview.data} />}
                    {preview.kind === 'general' && <GeneralCharacterCard general={preview.data} />}
                    {preview.kind === 'canshou' && <CanshouCard canshou={preview.data} />}
                  </div>
                </details>
              )}
            </section>
          )}
            </>
          )}
        </div>
        {/* 「我的数据卡」选择器：本地页签离线可用；确认会话 active 后默认落到
            「我的数据卡」页签（入口名称与所有权一致），本地库保持显式页签。 */}
        <CardLibraryModal
          host={cardLibraryHost}
          isOpen={libraryOpen}
          onClose={() => setLibraryOpen(false)}
          onSelectCard={handleSelectLibraryCard}
          selectedType="all"
          allowedTypes={['character', 'scenario']}
          initialTab={activeCloudAccount !== null ? 'my' : 'local'}
          titleOverride="我的数据卡"
          allowDeckImport={false}
        />
        {/* 页脚与 Web 角色管理页同一共享组件；站外链接走受控外链确认。 */}
        <ProductFooter
          assetSource={DESKTOP_ASSET_SOURCE}
          onNavigateInternal={(href) => navigateByProductHref(router, href)}
          resolveInternalHref={resolveInternalHrefForHashHistory}
          onNavigateExternal={openFixed}
        />
      </div>
    </section>
  );
}
