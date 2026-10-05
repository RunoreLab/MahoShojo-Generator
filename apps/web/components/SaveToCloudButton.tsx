import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import SaveCardModal from './CharManager/SaveCardModal';
import DataCardsModal from './CharManager/DataCardsModal';
import { useAuth } from '@/lib/useAuth';
import { dataCardApi } from '@/lib/auth';
import { quickCheck } from '@/lib/sensitive-word-filter';
import { config } from '@/lib/config';
import type { OnlineDataCardType } from '@mahoshojo/contracts/data-cards';

interface SaveToCloudButtonProps {
  data: any;
  getData?: () => Promise<any>;
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
  cardType,
  buttonText = "保存到云端",
  defaultName,
  defaultDescription,
  defaultIsPublic = 0,
  className = "generate-button",
  style = {}
}: SaveToCloudButtonProps) {
  const router = useRouter();
  const { isAuthenticated, user } = useAuth();
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [cardName, setCardName] = useState('');
  const [cardDescription, setCardDescription] = useState('');
  const [isPublic, setIsPublic] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [preparedData, setPreparedData] = useState<any>(null);
  const [cardsRefresh, setCardsRefresh] = useState(0);
  const [userCapacity, setUserCapacity] = useState(config.DEFAULT_DATA_CARD_CAPACITY);
  const [userUsedSlots, setUserUsedSlots] = useState(0);
  const [showDataCardsForReplace, setShowDataCardsForReplace] = useState(false);
  const [replaceEditingCard, setReplaceEditingCard] = useState<any | null>(null);
  const [replaceCurrentPage, setReplaceCurrentPage] = useState(1);

  const navigateToArrested = () => {
    router.push('/arrested');
  };

  const loadUserDataCards = async () => {
    setCardsRefresh((value) => value + 1);
    const capacityInfo = await dataCardApi.getUserCapacity();
    if (capacityInfo) {
      setUserCapacity(capacityInfo.capacity);
      setUserUsedSlots(capacityInfo.usedSlots);
    }
  };

  const resolveData = async (): Promise<any | null> => {
    if (getData) {
      setIsPreparing(true);
      try {
        const next = await getData();
        if (!next) return null;
        setPreparedData(next);
        return next;
      } finally {
        setIsPreparing(false);
      }
    }

    if (!data) return null;
    setPreparedData(data);
    return data;
  };

  const handleSaveClick = async () => {
    if (!isAuthenticated) {
      alert('请先登录后再保存到云端');
      return;
    }
    
    // 如果没有数据，则不显示模态框
    let hadResolveError = false;
    const resolvedData = await resolveData().catch((error) => {
      hadResolveError = true;
      console.error("准备保存数据失败:", error);
      alert(error instanceof Error ? error.message : '准备保存数据失败。');
      return null;
    });
    if (!resolvedData) {
      if (!hadResolveError) {
        alert('没有可保存的数据。');
      }
      return;
    }

    // 根据数据类型生成默认名称和描述
    const inferredType = isScenarioData(resolvedData) ? 'scenario' : 'character';
    const type = cardType ?? inferredType;
    const inferredName =
      type === 'history'
        ? (resolvedData?.title || resolvedData?.name || '叙事历史')
        : type === 'scenario'
          ? (resolvedData?.title || resolvedData?.name || '')
          : type === 'questionnaire'
            ? (resolvedData?.title || resolvedData?.name || '问卷')
            : (resolvedData?.codename || resolvedData?.name || '');
    const inferredDescription =
      type === 'history'
        ? '叙事历史数据卡'
        : type === 'scenario'
          ? '情景数据卡'
          : type === 'questionnaire'
            ? '问卷数据卡'
            : '角色数据卡';

    setCardName((defaultName && defaultName.trim()) ? defaultName : inferredName);
    setCardDescription((defaultDescription && defaultDescription.trim()) ? defaultDescription : inferredDescription);
    setIsPublic(defaultIsPublic);
    setSaveError(null);
    const capacityInfo = await dataCardApi.getUserCapacity();
    if (capacityInfo !== null) {
      setUserCapacity(capacityInfo.capacity);
      setUserUsedSlots(capacityInfo.usedSlots);
    }
    setShowSaveModal(true);
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
    if (!cardName.trim()) {
      setSaveError('请输入数据卡名称');
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      const workingData = preparedData ?? data;
      if (!workingData) {
        setSaveError('没有可保存的数据。');
        return;
      }
      // 修正：直接使用 props 传入的 data 对象。
      // 该对象由后端 API 生成，已包含了正确的签名状态。
      // 本组件不再负责任何签名相关的逻辑判断。
      const finalData = { ...workingData };
      
      // 前端敏感词检查
      const type = cardType ?? (isScenarioData(finalData) ? 'scenario' : 'character');
      const textToCheck = `${cardName} ${cardDescription} ${JSON.stringify(finalData)}`;
      const sensitiveWordResult = await quickCheck(textToCheck);

      if (sensitiveWordResult.hasSensitiveWords) {
        navigateToArrested();
        return;
      }

      const result = await dataCardApi.createCard(
        type,
        cardName,
        cardDescription,
        finalData, // 直接使用最终数据
        isPublic
      );

      if (result.success) {
        alert(`数据卡保存成功！${isPublic === 1 ? '（公开）' : '（私有）'}`);
        setShowSaveModal(false);
        setCardName('');
        setCardDescription('');
        setIsPublic(0);
        setSaveError(null);
        loadUserDataCards();
      } else {
        if (result.error === 'SENSITIVE_WORD_DETECTED' || (result as any).redirect === '/arrested') {
          navigateToArrested();
          return;
        }
        setSaveError(result.error || '保存失败');
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '保存失败，请稍后重试');
    } finally {
      setIsSaving(false);
    }
  };

  const effectiveData = preparedData ?? data;
  const canOperate = Boolean(data || getData);

  return (
    <>
      <button
        onClick={() => void handleSaveClick()}
        className={className}
        style={style}
        disabled={!canOperate || isPreparing} // 如果没有数据且无法动态准备，则禁用
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
        disabled={!canOperate || isPreparing}
      >
        替换已有
      </button>

      <SaveCardModal
        isOpen={showSaveModal}
        onClose={() => setShowSaveModal(false)}
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
