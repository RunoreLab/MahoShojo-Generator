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
  buttonText?: string;
  className?: string;
  style?: React.CSSProperties;
}

// 检测是否为情景文件
const isScenarioData = (data: any): boolean => {
  return Boolean(data && data.title && data.elements && (data.scenario_type || data.elements.events));
};

export default function SaveToCloudButton({
  data,
  buttonText = "保存到云端",
  className = "generate-button",
  style = {}
}: SaveToCloudButtonProps) {
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [cardName, setCardName] = useState('');
  const [cardDescription, setCardDescription] = useState('');
  const [isPublic, setIsPublic] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [userDataCards, setUserDataCards] = useState<any[]>([]);
  const [userCapacity, setUserCapacity] = useState(config.DEFAULT_DATA_CARD_CAPACITY);
  const [showReplaceModal, setShowReplaceModal] = useState(false);
  const [isReplacing, setIsReplacing] = useState(false);

  // 加载用户数据卡信息
  useEffect(() => {
    if (isAuthenticated) {
      loadUserDataCards();
    }
  }, [isAuthenticated]);

  const loadUserDataCards = async () => {
    try {
      const [cards, capacity] = await Promise.all([
        dataCardApi.getCards(),
        dataCardApi.getUserCapacity()
      ]);
      setUserDataCards(cards);
      if (capacity !== null) {
        setUserCapacity(capacity);
      }
    } catch (error) {
        console.error("加载用户数据卡失败:", error);
    }
  };

  const handleSaveClick = () => {
    if (!isAuthenticated) {
      alert('请先登录后再保存到云端');
      return;
    }
    
    // 如果没有数据，则不显示模态框
    if (!data) {
        alert('没有可保存的数据。');
        return;
    }

    // 根据数据类型生成默认名称和描述
    const isScenario = isScenarioData(data);
    const type = isScenario ? 'scenario' : 'character';
    const defaultName = isScenario
      ? (data.title || data.name || '')
      : (data.codename || data.name || '');
    const defaultDescription = `${type === 'character' ? '角色' : '情景'}数据卡`;

    setCardName(defaultName);
    setCardDescription(defaultDescription);
    setIsPublic(0);
    setSaveError(null);
    setShowSaveModal(true);
  };

  const handleReplaceConfirm = async (cardId: string, opts: { name?: string; description?: string; isPublic?: number }) => {
    if (!data) return;
    setIsReplacing(true);
    setSaveError(null);
    try {
      const finalData = { ...data };
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
      // 修正：直接使用 props 传入的 data 对象。
      // 该对象由后端 API 生成，已包含了正确的签名状态。
      // 本组件不再负责任何签名相关的逻辑判断。
      const finalData = { ...data };
      
      // 前端敏感词检查
      const type = isScenarioData(finalData) ? 'scenario' : 'character';
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

  return (
    <>
      <button
        onClick={handleSaveClick}
        className={className}
        style={style}
        disabled={!data} // 如果没有数据则禁用
      >
        {buttonText}
      </button>
      <button
        onClick={() => {
          if (!isAuthenticated) {
            alert('请先登录后再替换到云端');
            return;
          }
          if (!data) {
            alert('没有可替换的数据。');
            return;
          }
          setShowReplaceModal(true);
        }}
        className={`${className} ml-2`}
        style={{ ...style, backgroundColor: '#f59e0b', backgroundImage: 'linear-gradient(to right, #f59e0b, #f97316)' }}
        disabled={!data}
      >
        替换已有
      </button>

      <SaveCardModal
        isOpen={showSaveModal}
        onClose={() => setShowSaveModal(false)}
        onSave={handleSave}
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
        targetType={isScenarioData(data) ? 'scenario' : 'character'}
        onConfirm={handleReplaceConfirm}
        isSaving={isReplacing}
      />
    </>
  );
}
