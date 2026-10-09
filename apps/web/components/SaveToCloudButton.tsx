import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import SaveCardModal from './CharManager/SaveCardModal';
import DataCardsModal from './CharManager/DataCardsModal';
import { useAuth } from '@/lib/useAuth';
import { authStorage, dataCardApi } from '@/lib/auth';
import { quickCheck } from '@/lib/sensitive-word-filter';
import type { OnlineDataCardType } from '@mahoshojo/contracts/data-cards';

interface SaveToCloudButtonProps {
  data: any;
  getData?: () => Promise<any>;
  /** Dynamic-only providers can identify the result independently of callback identity. */
  sourceKey?: string | number;
  cardType?: OnlineDataCardType;
  buttonText?: string;
  defaultName?: string;
  defaultDescription?: string;
  defaultIsPublic?: number;
  className?: string;
  style?: React.CSSProperties;
}

// 检测是否为情景文件
const isScenarioData = (data: any): boolean => {
  if (!data) return false;
  if (data?.templateId === '通用情景' && typeof data?.content === 'string') {
    return true;
  }
  return Boolean(data && data.title && data.elements && (data.scenario_type || data.elements.events));
};

export default function SaveToCloudButton({
  data,
  getData,
  sourceKey,
  cardType,
  buttonText = "保存到云端",
  defaultName,
  defaultDescription,
  defaultIsPublic = 0,
  className = "generate-button",
  style = {}
}: SaveToCloudButtonProps) {
  const router = useRouter();
  const { isAuthenticated, user, authSource } = useAuth();
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [cardName, setCardName] = useState('');
  const [cardDescription, setCardDescription] = useState('');
  const [isPublic, setIsPublic] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [preparedData, setPreparedData] = useState<any>(null);
  const [cardsRefresh, setCardsRefresh] = useState(0);
  const [userCapacity, setUserCapacity] = useState<number | undefined>(undefined);
  const [userUsedSlots, setUserUsedSlots] = useState<number | undefined>(undefined);
  const [showDataCardsForReplace, setShowDataCardsForReplace] = useState(false);
  const [replaceEditingCard, setReplaceEditingCard] = useState<any | null>(null);
  const [replaceCurrentPage, setReplaceCurrentPage] = useState(1);

  const [uncertain, setUncertain] = useState(false);
  const [checkedOwnCards, setCheckedOwnCards] = useState(false);
  const busy = useRef(false);
  const operation = useRef(0);
  const capacityOperation = useRef(0);
  const mounted = useRef(true);
  // Compare source content, not callbacks: callers often recreate getData on every render.
  let source = '';
  try { source = JSON.stringify([sourceKey, data, cardType, defaultName, defaultDescription, defaultIsPublic]); }
  catch { source = 'invalid-data'; }
  const context = `${user?.id ?? ''}:${isAuthenticated}:${authSource ?? ''}:${source}`;
  const latestContext = useRef(context);
  latestContext.current = context;
  const draftContext = useRef<string | null>(null);
  const uncertainRef = useRef(false);

  useEffect(() => {
    operation.current += 1;
    capacityOperation.current += 1;
    busy.current = false;
    draftContext.current = null;
    uncertainRef.current = false;
    setPreparedData(null);
    setShowSaveModal(false);
    setIsPreparing(false);
    setIsSaving(false);
    setSaveError(null);
    setUncertain(false);
    setCheckedOwnCards(false);
    setUserCapacity(undefined);
    setUserUsedSlots(undefined);
  }, [context]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; operation.current += 1; };
  }, []);

  const navigateToArrested = () => router.push('/arrested');

  const loadUserDataCards = async () => {
    const ownerContext = context;
    const request = ++capacityOperation.current;
    setCardsRefresh((value) => value + 1);
    setUserCapacity(undefined);
    setUserUsedSlots(undefined);
    const capacityInfo = await dataCardApi.getUserCapacity().catch(() => null);
    if (!mounted.current || ownerContext !== latestContext.current || request !== capacityOperation.current) return;
    if (capacityInfo) {
      setUserCapacity(capacityInfo.capacity);
      setUserUsedSlots(capacityInfo.usedSlots);
    }
  };

  const resolveData = async (): Promise<any | null> => {
    if (busy.current) return null;
    busy.current = true;
    const token = ++operation.current;
    const ownerContext = context;
    setIsPreparing(true);
    setPreparedData(null);
    try {
      const next = getData ? await getData() : data;
      if (!mounted.current || token !== operation.current || ownerContext !== latestContext.current) return null;
      if (!next) return null;
      // Freeze the complete wire data; subsequent source mutations must not alter a draft.
      const snapshot = JSON.parse(JSON.stringify(next));
      setPreparedData(snapshot);
      draftContext.current = ownerContext;
      return snapshot;
    } catch (error) {
      if (!mounted.current || token !== operation.current || ownerContext !== latestContext.current) return null;
      throw error;
    } finally {
      if (token === operation.current && mounted.current) {
        busy.current = false;
        setIsPreparing(false);
      }
    }
  };

  const handleSaveClick = async () => {
    if (busy.current) return;
    if (!isAuthenticated) {
      alert('请先登录后再保存到云端');
      return;
    }
    // Closing a rejected/uncertain draft must not silently reset its retry decision.
    if (draftContext.current === context && preparedData) {
      setShowSaveModal(true);
      void loadUserDataCards();
      return;
    }
    const ownerContext = context;
    const preparation = operation.current + 1;
    let resolvedData;
    try { resolvedData = await resolveData(); }
    catch (error) {
      if (ownerContext === latestContext.current && mounted.current) alert(error instanceof Error ? error.message : '准备保存数据失败。');
      return;
    }
    if (!mounted.current || preparation !== operation.current || ownerContext !== latestContext.current) return;
    if (!resolvedData) { alert('没有可保存的数据。'); return; }
    const type = cardType ?? (isScenarioData(resolvedData) ? 'scenario' : 'character');
    const inferredName = type === 'character'
      ? (resolvedData?.codename || resolvedData?.name || '')
      : (resolvedData?.title || resolvedData?.name || (type === 'history' ? '叙事历史' : type === 'questionnaire' ? '问卷' : ''));
    const inferredDescription = type === 'history' ? '叙事历史数据卡' : type === 'scenario' ? '情景数据卡' : type === 'questionnaire' ? '问卷数据卡' : '角色数据卡';
    setCardName(defaultName?.trim() ? defaultName : inferredName);
    setCardDescription(defaultDescription?.trim() ? defaultDescription : inferredDescription);
    setIsPublic(defaultIsPublic);
    setSaveError(null);
    setShowSaveModal(true);
    void loadUserDataCards();
  };

  const handleReplaceFromDataCards = async (card: any) => {
    const workingData = preparedData ?? data;
    if (!workingData) {
      alert('没有可替换的数据。');
      return;
    }
    if (!window.confirm(`确认用当前数据替换「${card.name}」吗？`)) return;
    setSaveError(null);
    try {
      const finalData = { ...workingData };
      const textToCheck = `${card.name || ''} ${card.description || ''} ${JSON.stringify(finalData)}`;
      const sensitiveWordResult = await quickCheck(textToCheck);
      if (sensitiveWordResult.hasSensitiveWords) {
        navigateToArrested();
        return;
      }

      const result = await dataCardApi.replaceCard(card.id, {
        name: card.name,
        description: card.description,
        isPublic: card.is_public,
        data: finalData,
      });

      if (result.success) {
        alert(result.pendingReview ? '更新已提交审核，审核通过后生效' : '已替换成功');
        loadUserDataCards();
      } else {
        alert(result.error || '替换失败');
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : '替换失败，请稍后重试');
    }
  };

  const handleUpdateCardInfo = async (id: string, name: string, description: string, isPublic?: number) => {
    const textToCheck = `${name} ${description}`;
    const sensitiveWordResult = await quickCheck(textToCheck);
    if (sensitiveWordResult.hasSensitiveWords) {
      navigateToArrested();
      return;
    }

    const result = await dataCardApi.updateCard(id, name, description, isPublic);
    if (result.success) {
      setReplaceEditingCard(null);
      loadUserDataCards();
    } else {
      if (result.error === 'SENSITIVE_WORD_DETECTED' || (result as any).redirect === '/arrested') {
        navigateToArrested();
        return;
      }
      alert(result.error || '更新失败');
    }
  };

  const handleDeleteCard = async (id: string) => {
    if (!window.confirm('确认删除此数据卡？')) return;
    try {
      const result = await dataCardApi.deleteCard(id);
      if (result.success) {
        loadUserDataCards();
      } else {
        alert(result.error || '删除失败');
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : '删除失败');
    }
  };

  const handleSave = async () => {
    if (busy.current || uncertainRef.current || draftContext.current !== context) return;
    if (!cardName.trim() || cardName.length > 20 || cardDescription.length > 300) {
      setSaveError(!cardName.trim() ? '请输入数据卡名称' : '名称最多 20 字符，描述最多 300 字符');
      return;
    }
    if (!isAuthenticated || !user?.id || !preparedData) {
      setSaveError('登录状态或保存数据已改变，请重新打开保存窗口。');
      return;
    }
    busy.current = true;
    const token = ++operation.current;
    const ownerContext = context;
    const isCurrent = () => mounted.current && token === operation.current && ownerContext === latestContext.current;
    const submission = {
      userId: user.id,
      name: cardName,
      description: cardDescription,
      isPublic,
      data: JSON.parse(JSON.stringify(preparedData)),
      type: cardType ?? (isScenarioData(preparedData) ? 'scenario' : 'character'),
    };
    setIsSaving(true);
    setSaveError(null);
    let sent = false;
    try {
      const expectedAuth = await authStorage.getAuth();
      if (!isCurrent()) return;
      const textToCheck = `${submission.name} ${submission.description} ${JSON.stringify(submission.data)}`;
      const sensitiveWordResult = await quickCheck(textToCheck);
      if (!isCurrent()) return;
      if (sensitiveWordResult.hasSensitiveWords) { navigateToArrested(); return; }
      sent = true;
      const result = await dataCardApi.createCard(
        submission.type, submission.name, submission.description, submission.data, submission.isPublic,
        { expectedUserId: submission.userId, expectedAuth, isCurrent },
      );
      const currentAuth = await authStorage.getAuth();
      if (!isCurrent()) return;
      if (JSON.stringify(currentAuth) !== JSON.stringify(expectedAuth)) {
        setSaveError('登录状态已改变。请检查原账号的云端卡，确认本次保存结果。');
        uncertainRef.current = true;
        setUncertain(true);
        return;
      }
      if (result.success && typeof result.id === 'string' && result.id.trim()) {
        alert(`数据卡保存成功！${submission.isPublic === 1 ? '（公开）' : '（私有）'}`);
        setShowSaveModal(false);
        setPreparedData(null);
        draftContext.current = null;
        setCardName('');
        setCardDescription('');
        setIsPublic(0);
        void loadUserDataCards();
      } else if (result.uncertain || result.success) {
        uncertainRef.current = true;
        setUncertain(true);
        setCheckedOwnCards(false);
        setSaveError('保存结果不确定，数据卡可能已创建。请先检查“我的云端卡”，再决定是否再次新建。');
      } else {
        if (result.error === 'SENSITIVE_WORD_DETECTED' || result.redirect === '/arrested') {
          navigateToArrested();
          return;
        }
        setSaveError(result.error || '保存被拒绝，输入已保留。');
      }
    } catch (error) {
      if (!isCurrent()) return;
      if (sent) {
        uncertainRef.current = true;
        setUncertain(true);
        setCheckedOwnCards(false);
        setSaveError('保存结果不确定，数据卡可能已创建。请先检查“我的云端卡”，再决定是否再次新建。');
      } else {
        setSaveError(error instanceof Error ? error.message : '准备保存失败，输入已保留。');
      }
    } finally {
      if (isCurrent()) { busy.current = false; setIsSaving(false); }
    }
  };

  const effectiveData = draftContext.current === context ? preparedData : data;
  const canOperate = Boolean(data || getData);

  return (
    <>
      <button
        onClick={() => void handleSaveClick()}
        className={className}
        style={style}
        disabled={!canOperate || isPreparing || isSaving} // 如果没有数据且无法动态准备，则禁用
      >
        {isPreparing ? '准备中...' : buttonText}
      </button>
      <button
        onClick={() => {
          if (!isAuthenticated) {
            alert('请先登录后再替换到云端');
            return;
          }
          void (async () => {
            let hadResolveError = false;
            const resolvedData = await resolveData().catch((error) => {
              hadResolveError = true;
              console.error("准备替换数据失败:", error);
              alert(error instanceof Error ? error.message : '准备替换数据失败。');
              return null;
            });
            if (!resolvedData) {
              if (!hadResolveError) {
                alert('没有可替换的数据。');
              }
              return;
            }
            setShowDataCardsForReplace(true);
            setReplaceEditingCard(null);
            setReplaceCurrentPage(1);
            void loadUserDataCards();
          })();
        }}
        className={`${className} ml-2`}
        style={{ ...style, backgroundColor: '#f59e0b', backgroundImage: 'linear-gradient(to right, #f59e0b, #f97316)' }}
        disabled={!canOperate || isPreparing || isSaving}
      >
        替换已有
      </button>

      <SaveCardModal
        isOpen={showSaveModal}
        onClose={() => { if (!busy.current) setShowSaveModal(false); }}
        onSave={handleSave}
        data={effectiveData}
        name={cardName}
        description={cardDescription}
        isPublic={isPublic}
        onNameChange={setCardName}
        onDescriptionChange={setCardDescription}
        onPublicChange={setIsPublic}
        error={saveError}
        isSaving={isSaving}
        submitDisabled={uncertain}
        supplementaryContent={uncertain ? (
          <div className="mt-3 text-sm">
            <a href="/character-manager" target="_blank" rel="noopener noreferrer" className="underline" onClick={() => setCheckedOwnCards(true)}>检查我的云端卡</a>
            <button type="button" disabled={!checkedOwnCards || isSaving} className="ml-3 underline disabled:opacity-50" onClick={() => {
              if (!checkedOwnCards || busy.current) return;
              if (!window.confirm('已检查我的云端卡？再次新建可能产生重复数据卡，是否继续？')) return;
              uncertainRef.current = false;
              setUncertain(false);
              setSaveError(null);
            }}>已检查，允许再次新建</button>
          </div>
        ) : undefined}
        usedSlots={userUsedSlots}
        userCapacity={userCapacity}
      />

      <DataCardsModal
        isOpen={showDataCardsForReplace}
        onClose={() => {
          setShowDataCardsForReplace(false);
          setReplaceEditingCard(null);
        }}
        dataCards={[]}
        summaryOwnerId={user?.id}
        refreshKey={cardsRefresh}
        editingCard={replaceEditingCard}
        currentPage={replaceCurrentPage}
        cardsPerPage={8}
        onPageChange={setReplaceCurrentPage}
        onEditCard={setReplaceEditingCard}
        onUpdateCard={handleUpdateCardInfo}
        onDeleteCard={handleDeleteCard}
        onLoadCard={() => {}}
        onCancelEdit={() => setReplaceEditingCard(null)}
        onReplaceCard={handleReplaceFromDataCards}
        userCapacity={userCapacity}
        userUsedSlots={userUsedSlots}
        title="替换已有数据卡"
        emptyText="暂无数据卡"
        defaultFilters={cardType ? { type: cardType } : undefined}
        allowedTypes={cardType ? [cardType] : undefined}
        hideEditData={true}
        allowHistoryReplace={cardType === 'history'}
        showHotHint={false}
      />
    </>
  );
}
