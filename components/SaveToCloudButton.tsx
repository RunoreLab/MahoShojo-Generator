import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import SaveCardModal from './CharManager/SaveCardModal';
import ReplaceCardModal from './ReplaceCardModal';
import { useAuth } from '@/lib/useAuth';
import { dataCardApi } from '@/lib/auth';
import { quickCheck } from '@/lib/sensitive-word-filter';
import { config } from '@/lib/config';

interface SaveToCloudButtonProps {
  data: any;
  getData?: () => Promise<any>;
  cardType?: 'character' | 'scenario' | 'history' | 'questionnaire';
  buttonText?: string;
  defaultName?: string;
  defaultDescription?: string;
  defaultIsPublic?: number;
  className?: string;
  style?: React.CSSProperties;
}

type DataCardsLoadState = {
  status: 'idle' | 'loading' | 'success' | 'error';
  error: string | null;
};

type OpenReplaceModalAndRefreshInput = {
  openModal: () => void;
  refreshCards: () => Promise<unknown>;
  onRefreshError?: (error: unknown) => void;
};

export function openReplaceModalAndRefresh({
  openModal,
  refreshCards,
  onRefreshError,
}: OpenReplaceModalAndRefreshInput): void {
  openModal();
  void refreshCards().catch((error) => {
    onRefreshError?.(error);
  });
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
  const [userDataCards, setUserDataCards] = useState<any[]>([]);
  const [userCapacity, setUserCapacity] = useState(config.DEFAULT_DATA_CARD_CAPACITY);
  const [showReplaceModal, setShowReplaceModal] = useState(false);
  const [isReplacing, setIsReplacing] = useState(false);
  const [cardsLoadState, setCardsLoadState] = useState<DataCardsLoadState>({ status: 'idle', error: null });

  // 加载用户数据卡信息
  useEffect(() => {
    if (isAuthenticated) {
      void loadUserDataCards();
      return;
    }
    setUserDataCards([]);
    setCardsLoadState({ status: 'idle', error: null });
  }, [isAuthenticated]);

  const loadUserDataCards = async () => {
    setCardsLoadState((current) => ({
      status: 'loading',
      error: current.error,
    }));
    try {
      const [cardsResult, capacity] = await Promise.all([
        dataCardApi.getCardsDetailed(),
        dataCardApi.getUserCapacity()
      ]);
      setUserDataCards(cardsResult.cards);
      if (capacity !== null) {
        setUserCapacity(capacity);
      }
      setCardsLoadState({
        status: cardsResult.success ? 'success' : 'error',
        error: cardsResult.success ? null : (cardsResult.error || '获取数据卡失败'),
      });
      return cardsResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : '加载用户数据卡失败';
      console.error("加载用户数据卡失败:", error);
      setUserDataCards([]);
      setCardsLoadState({ status: 'error', error: message });
      return { success: false, cards: [], error: message };
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
    setShowSaveModal(true);
  };

  const handleReplaceConfirm = async (cardId: string, opts: { name?: string; description?: string; isPublic?: number }) => {
    const workingData = preparedData ?? data;
    if (!workingData) return;
    setIsReplacing(true);
    setSaveError(null);
    try {
      const finalData = { ...workingData };
      // 敏感词检查
      const textToCheck = `${opts.name || ''} ${opts.description || ''} ${JSON.stringify(finalData)}`;
      const sensitiveWordResult = await quickCheck(textToCheck);
      if (sensitiveWordResult.hasSensitiveWords) {
        router.push('/arrested');
        return;
      }

      const result = await dataCardApi.replaceCard(cardId, {
        name: opts.name,
        description: opts.description,
        isPublic: opts.isPublic,
        data: finalData,
      });

      if (result.success) {
        alert(result.pendingReview ? '更新已提交审核，审核通过后生效' : '已替换成功');
        setShowReplaceModal(false);
        loadUserDataCards();
      } else {
        setSaveError(result.error || '替换失败');
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '替换失败，请稍后重试');
    } finally {
      setIsReplacing(false);
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
        router.push('/arrested');
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
          router.push('/arrested');
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
            openReplaceModalAndRefresh({
              openModal: () => setShowReplaceModal(true),
              refreshCards: loadUserDataCards,
              onRefreshError: (error) => {
                console.error('替换弹窗打开后刷新数据卡失败:', error);
              },
            });
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
        currentCardCount={userDataCards.length}
        userCapacity={userCapacity}
      />

      <ReplaceCardModal
        isOpen={showReplaceModal}
        onClose={() => setShowReplaceModal(false)}
        cards={userDataCards}
        targetType={cardType ?? (isScenarioData(effectiveData) ? 'scenario' : 'character')}
        onConfirm={handleReplaceConfirm}
        isSaving={isReplacing}
        data={effectiveData}
        viewer={user ? { id: user.id, username: user.username } : null}
        loadError={cardsLoadState.status === 'error' ? cardsLoadState.error : null}
      />
    </>
  );
}
