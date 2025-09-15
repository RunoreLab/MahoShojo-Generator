import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import SaveCardModal from './CharManager/SaveCardModal';
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
  const [isPublic, setIsPublic] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [userDataCards, setUserDataCards] = useState<any[]>([]);
  const [userCapacity, setUserCapacity] = useState(config.DEFAULT_DATA_CARD_CAPACITY);

  // 加载用户数据卡信息
  useEffect(() => {
    if (isAuthenticated) {
      loadUserDataCards();
    }
  }, [isAuthenticated]);

  const loadUserDataCards = async () => {
    const [cards, capacity] = await Promise.all([
      dataCardApi.getCards(),
      dataCardApi.getUserCapacity()
    ]);
    setUserDataCards(cards);
    if (capacity !== null) {
      setUserCapacity(capacity);
    }
  };

  const handleSaveClick = () => {
    if (!isAuthenticated) {
      alert('请先登录后再保存到云端');
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
    setIsPublic(false);
    setSaveError(null);
    setShowSaveModal(true);
  };

  const handleSave = async () => {
    if (!cardName.trim()) {
      setSaveError('请输入数据卡名称');
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      // 前端敏感词检查
      const type = isScenarioData(data) ? 'scenario' : 'character';
      const textToCheck = `${cardName} ${cardDescription} ${JSON.stringify(data)}`;
      const sensitiveWordResult = await quickCheck(textToCheck);

      if (sensitiveWordResult.hasSensitiveWords) {
        // 直接跳转到 /arrested 页面
        router.push('/arrested');
        return;
      }

      const result = await dataCardApi.createCard(
        type,
        cardName,
        cardDescription,
        data,
        isPublic
      );

      if (result.success) {
        alert(`数据卡保存成功！${isPublic ? '（公开）' : '（私有）'}`);
        setShowSaveModal(false);
        setCardName('');
        setCardDescription('');
        setIsPublic(false);
        setSaveError(null);
        // 重新加载用户数据卡数量
        loadUserDataCards();
      } else {
        // 检查是否是敏感词错误，如果是则跳转到 /arrested
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
      >
        {buttonText}
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
    </>
  );
}