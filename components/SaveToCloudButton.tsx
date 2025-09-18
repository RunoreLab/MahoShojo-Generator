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
  // 新增 props 用于接收原生性状态
  isNative?: boolean;
  hasLostNativeness?: boolean;
}

// 检测是否为情景文件
const isScenarioData = (data: any): boolean => {
  return Boolean(data && data.title && data.elements && (data.scenario_type || data.elements.events));
};

export default function SaveToCloudButton({
  data,
  buttonText = "保存到云端",
  className = "generate-button",
  style = {},
  // 接收原生性状态，提供默认值以兼容旧用法
  isNative = false,
  hasLostNativeness = false,
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

  const handleSave = async () => {
    if (!cardName.trim()) {
      setSaveError('请输入数据卡名称');
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      // 核心修复：与 character-manager 页面相同的原生性处理逻辑
      let finalData = { ...data };

      if (isNative && !hasLostNativeness) {
        // 保持原生性，需要重新签名
        const response = await fetch('/api/resign-data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(finalData),
        });
        if (!response.ok) throw new Error('签名服务器认证失败');
        finalData = await response.json();
      } else {
        // 衍生数据，移除签名
        delete finalData.signature;
      }
      
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
        finalData, // 使用处理后的数据
        isPublic
      );

      if (result.success) {
        alert(`数据卡保存成功！${isPublic === 1 ? '（公开）' : '（私有）'}`);
        setShowSaveModal(false);
        setCardName('');
        setCardDescription('');
        setIsPublic(0);
        setSaveError(null);
        // 重新加载用户数据卡数量
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