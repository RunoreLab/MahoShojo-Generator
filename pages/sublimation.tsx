// pages/sublimation.tsx

import React, { useState, ChangeEvent, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import Link from 'next/link';
import MagicalGirlCard from '../components/MagicalGirlCard';
import CanshouCard from '../components/CanshouCard';
import { quickCheck } from '@/lib/sensitive-word-filter';
import { useCooldown } from '../lib/cooldown';
import { config as appConfig } from '../lib/config';
import SaveToCloudButton from '../components/SaveToCloudButton';
import Footer from '../components/Footer';
import BattleDataModal from '../components/BattleDataModal';
import { useAuth } from '@/lib/useAuth';

// 颜色处理方案
const MainColor = {
    Red: '红色',
    Orange: '橙色',
    Cyan: '青色',
    Blue: '蓝色',
    Purple: '紫色',
    Pink: '粉色',
    Yellow: '黄色',
    Green: '绿色'
} as const;

const gradientColors: Record<string, { first: string; second: string }> = {
    [MainColor.Red]: { first: '#ff6b6b', second: '#ee5a6f' },
    [MainColor.Orange]: { first: '#ff922b', second: '#ffa94d' },
    [MainColor.Cyan]: { first: '#22b8cf', second: '#66d9e8' },
    [MainColor.Blue]: { first: '#5c7cfa', second: '#748ffc' },
    [MainColor.Purple]: { first: '#9775fa', second: '#b197fc' },
    [MainColor.Pink]: { first: '#ff9a9e', second: '#fecfef' },
    [MainColor.Yellow]: { first: '#f59f00', second: '#fcc419' },
    [MainColor.Green]: { first: '#51cf66', second: '#8ce99a' }
};

// 递归提取对象中所有字符串值的函数
const extractTextForCheck = (data: any): string => {
    let textContent = '';
    if (typeof data === 'string') {
        textContent += data + ' ';
    } else if (Array.isArray(data)) {
        data.forEach(item => {
            textContent += extractTextForCheck(item);
        });
    } else if (typeof data === 'object' && data !== null) {
        for (const key in data) {
            if (key !== 'signature' && key !== 'userAnswers') {
                textContent += extractTextForCheck(data[key]);
            }
        }
    }
    return textContent;
};

// API响应和结果状态的类型
interface SublimationResponse {
    sublimatedData: any;
    unchangedFields: string[];
}

// [新增] 定义可配置的字段及其显示名称
const PRESERVABLE_FIELDS_CONFIG = {
    'magical-girl': [
        { id: 'appearance', label: '外观' },
        { id: 'magicConstruct', label: '魔装' },
        { id: 'wonderlandRule', label: '奇境' },
        { id: 'blooming', label: '繁开' },
        { id: 'analysis', label: '分析' },
        { id: 'userAnswers', label: '问卷答案' },
    ],
    'canshou': [
        { id: 'appearance', label: '外貌形态' },
        { id: 'coreConcept', label: '核心概念' },
        { id: 'coreEmotion', label: '核心情感' },
        { id: 'materialAndSkin', label: '材质表皮' },
        { id: 'featuresAndAppendages', label: '特征附属' },
        { id: 'attackMethod', label: '攻击方式' },
        { id: 'specialAbility', label: '特殊能力' },
        { id: 'origin', label: '起源' },
        { id: 'birthEnvironment', label: '诞生环境' },
        { id: 'researcherNotes', label: '研究员笔记' },
        { id: 'userAnswers', label: '问卷答案' },
    ]
};


const SublimationPage: React.FC = () => {
    const router = useRouter();
    const { isAuthenticated } = useAuth();
    const [characterData, setCharacterData] = useState<any>(null);
    const [fileName, setFileName] = useState<string | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [resultData, setResultData] = useState<SublimationResponse | null>(null);
    const [savedImageUrl, setSavedImageUrl] = useState<string | null>(null);
    const [showImageModal, setShowImageModal] = useState(false);
    const [pastedJson, setPastedJson] = useState('');
    const [isPasteAreaVisible, setIsPasteAreaVisible] = useState(false);
    const [userGuidance, setUserGuidance] = useState('');

    // 数据库选择相关状态
    const [showBattleDataModal, setShowBattleDataModal] = useState(false);

    // [新增] 用于管理高级选项的状态
    const [fieldsToPreserve, setFieldsToPreserve] = useState<string[]>([]);
    const [isAdvancedVisible, setIsAdvancedVisible] = useState(false);

    const { isCooldown, startCooldown, remainingTime } = useCooldown('sublimationCooldown', 60000);
    const [languages, setLanguages] = useState<{ code: string; name: string }[]>([]);
    const [selectedLanguage, setSelectedLanguage] = useState('zh-CN');

    useEffect(() => {
        fetch('/languages.json').then(res => res.json()).then(data => setLanguages(data));
        const isMobileDevice = /mobile/i.test(navigator.userAgent);
        if (isMobileDevice) setIsPasteAreaVisible(true);
    }, []);

    const processJsonData = (jsonText: string) => {
        try {
            const json = JSON.parse(jsonText);
            if (!json.arena_history) {
                throw new Error('角色文件缺少必需的“arena_history”（历战记录）属性，需使用在竞技场下载的经历战斗后的角色文件！');
            }
            setCharacterData(json);
            setFileName('粘贴的内容');
            setError(null);
            setResultData(null);

            // [新增] 加载角色后，根据类型设置默认的保留字段
            const isMagicalGirl = !!json.codename;
            if (isMagicalGirl) {
                setFieldsToPreserve(['wonderlandRule', 'blooming']);
            } else {
                setFieldsToPreserve([]); // 残兽默认全部重置
            }

            return true;
        } catch (err) {
            const message = err instanceof Error ? err.message : '无法解析文件。';
            setError(`❌ 数据加载失败: ${message}`);
            setCharacterData(null);
            setFileName(null);
            return false;
        }
    };

    const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (file.type !== 'application/json') {
            setError('❌ 文件必须是 .json 格式。');
            return;
        }
        const text = await file.text();
        if (processJsonData(text)) {
            setFileName(file.name);
        }
        event.target.value = '';
    };

    const handlePasteAndLoad = () => {
        if (!pastedJson.trim()) {
            setError('⚠️ 文本框内容为空。');
            return;
        }
        if (processJsonData(pastedJson)) {
            setPastedJson('');
        }
    };

    // 打开角色数据卡选择器
    const handleOpenCharacterDataModal = () => {
        setShowBattleDataModal(true);
    };

    // 递归删除以 _ 开头的键
    const removePrivateKeys = (obj: any): any => {
        if (obj === null || typeof obj !== 'object') {
            return obj;
        }
        
        if (Array.isArray(obj)) {
            return obj.map(removePrivateKeys);
        }
        
        const cleaned: any = {};
        for (const key in obj) {
            if (!key.startsWith('_')) {
                cleaned[key] = removePrivateKeys(obj[key]);
            }
        }
        return cleaned;
    };

    // 处理从数据库选择的角色数据卡
    const handleSelectDataCard = async (card: any) => {
        try {
            // 解析数据卡内容
            let cardData = typeof card.data === 'string' ? JSON.parse(card.data) : card.data;
            
            // 删除以 _ 开头的键
            cardData = removePrivateKeys(cardData);
            
            // 验证数据是否包含历战记录
            if (!cardData.arena_history) {
                setError('❌ 选择的角色缺少必需的"历战记录"（arena_history）属性，无法进行升华。');
                return;
            }

            setCharacterData(cardData);
            setFileName(`${card.name}(来自数据库)`);
            setShowBattleDataModal(false);
            setError(null);
            
        } catch (err) {
            setError(`❌ 数据卡加载失败: ${err instanceof Error ? err.message : '未知错误'}`);
        }
    };

    const handleGenerate = async () => {
        if (isCooldown) {
            setError(`操作过于频繁，请等待 ${remainingTime} 秒后再试。`);
            return;
        }
        if (!characterData) {
            setError('⚠️ 请先上传一个角色设定文件。');
            return;
        }
        setIsGenerating(true);
        setError(null);
        setResultData(null);

        try {
            const textToCheck = extractTextForCheck(characterData) + " " + userGuidance;
            if ((await quickCheck(textToCheck)).hasSensitiveWords) {
                router.push({
                    pathname: '/arrested',
                    query: { reason: '上传的角色档案或引导内容包含危险符文' }
                });
                return;
            }

            const response = await fetch('/api/generate-sublimation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...characterData,
                    language: selectedLanguage,
                    userGuidance: userGuidance.trim(),
                    fieldsToPreserve: fieldsToPreserve, // [新增] 发送需要保留的字段列表
                }),
            });

            if (!response.ok) {
                const errorJson = await response.json().catch(() => ({ message: '服务器响应异常' }));
                if (errorJson.shouldRedirect) {
                    router.push({
                        pathname: '/arrested',
                        query: { reason: errorJson.reason || '使用危险符文' }
                    });
                    return;
                }
                throw new Error(errorJson.message || errorJson.error || '升华失败');
            }

            const result: SublimationResponse = await response.json();
            setResultData(result);
            startCooldown();

        } catch (err) {
            const message = err instanceof Error ? err.message : '发生未知错误';
            setError(`✨ 升华失败！${message}`);
        } finally {
            setIsGenerating(false);
        }
    };

    const handleSaveImage = (imageUrl: string) => {
        setSavedImageUrl(imageUrl);
        setShowImageModal(true);
    };

    const downloadJson = (data: any) => {
        const name = data.codename || data.name;
        const jsonData = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonData], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `角色档案_${name}_升华.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const handleOptionalFieldChange = (fieldId: string) => {
        setFieldsToPreserve(prev =>
            prev.includes(fieldId)
                ? prev.filter(f => f !== fieldId)
                : [...prev, fieldId]
        );
    };

    const applyPreset = (presetName: 'default' | 'full' | 'personality') => {
        if (!characterData) return;
        const isMagicalGirl = !!characterData.codename;
        switch (presetName) {
            case 'default':
                setFieldsToPreserve(isMagicalGirl ? ['wonderlandRule', 'blooming'] : []);
                break;
            case 'full':
                setFieldsToPreserve([]);
                break;
            case 'personality':
                setFieldsToPreserve(
                    isMagicalGirl
                        ? ['appearance', 'magicConstruct', 'wonderlandRule', 'blooming']
                        : ['appearance', 'materialAndSkin', 'featuresAndAppendages', 'attackMethod', 'specialAbility']
                );
                break;
        }
    };

    const renderResultCard = () => {
        if (!resultData?.sublimatedData) return null;
        const data = resultData.sublimatedData;

        if (data.codename) {
            const colorScheme = data.appearance.colorScheme || "红色、粉色";
            const mainColorName = Object.values(MainColor).find(color => colorScheme.includes(color)) || MainColor.Pink;
            const colors = gradientColors[mainColorName] || gradientColors[MainColor.Pink];
            const gradientStyle = `linear-gradient(135deg, ${colors.first} 0%, ${colors.second} 100%)`;
            return <MagicalGirlCard magicalGirl={data} gradientStyle={gradientStyle} onSaveImage={handleSaveImage} />;
        } else if (data.name) {
            return <CanshouCard canshou={data} onSaveImage={handleSaveImage} />;
        }
        return <div className="error-message">无法识别的角色类型</div>;
    };

    const currentCharacterType = characterData?.codename ? 'magical-girl' : 'canshou';
    const currentFieldsConfig = PRESERVABLE_FIELDS_CONFIG[currentCharacterType] || [];

    return (
        <>
            <Head>
                <title>成长升华 - MahoShojo Generator</title>
                <meta name="description" content="根据角色的历战记录，生成一个全新的成长后形态！" />
            </Head>
            <div className="magic-background-white">
                <div className="container">
                    <div className="card">
                        <div className="text-center mb-4">
                            <div className="flex justify-center items-center" style={{ marginBottom: '1rem' }}>
                                <img src="/sublimation.svg" width={360} height={40} alt="角色成长升华" />
                            </div>
                            <p className="subtitle mt-2">角色成长升华，见证她们在战斗与经历中完成的蜕变</p>
                        </div>
                        <div className="mb-6 p-4 bg-purple-50 border border-purple-200 rounded-lg text-sm text-purple-800">
                            <h3 className="font-bold mb-2">✨ 功能说明</h3>
                            <ol className="list-decimal list-inside space-y-1">
                                <li>上传一个包含【历战记录】(arena_history) 的角色设定文件 (.json)。</li>
                                <li>AI 将会阅读角色的全部设定和所有经历。</li>
                                <li>为你生成一个“成长之后”的全新角色设定！你可以在高级选项中选择保留哪些设定不被AI修改。</li>
                            </ol>
                        </div>

                        {/* 文件上传与粘贴区域 */}
                        <div className="input-group">
                            <label htmlFor="character-upload" className="input-label">上传角色设定文件</label>
                            <input id="character-upload" type="file" accept=".json" onChange={handleFileChange} className="input-field file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100" />
                            {fileName && (<p className="text-xs text-gray-500 mt-2">已加载角色: {fileName}</p>)}
                        </div>
                        <div className="mb-6">
                            <button onClick={() => setIsPasteAreaVisible(!isPasteAreaVisible)} className="text-purple-700 hover:underline cursor-pointer mb-2 font-semibold">
                                {isPasteAreaVisible ? '▼ 折叠文本粘贴区域' : '▶ 展开文本粘贴区域 (手机端推荐)'}
                            </button>
                            {isPasteAreaVisible && (
                                <div className="input-group mt-2">
                                    <textarea value={pastedJson} onChange={(e) => setPastedJson(e.target.value)} placeholder="在此处粘贴一个角色的设定文件(.json)内容..." className="input-field resize-y h-32" />
                                    <button onClick={handlePasteAndLoad} disabled={isGenerating} className="generate-button mt-2 mb-0" style={{ backgroundColor: '#8b5cf6', backgroundImage: 'linear-gradient(to right, #8b5cf6, #a78bfa)' }}>从文本加载角色</button>
                                </div>
                            )}
                        </div>

                        {/* 数据库选择区域 */}
                        <div className="mb-6">
                            <h3 className="input-label">从数据库选择角色</h3>
                            <div className="flex gap-2">
                                <button
                                    onClick={handleOpenCharacterDataModal}
                                    disabled={isGenerating}
                                    className="flex-1 px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                                >
                                    从在线角色数据库中选择
                                </button>
                                {!isAuthenticated && (
                                    <div className="flex-1 text-xs text-gray-500 flex items-center px-2">
                                        <Link
                                            href="/character-manager"
                                            className="text-purple-600 hover:text-purple-800 underline"
                                        >
                                            登录后可访问私有数据卡
                                        </Link>
                                    </div>
                                )}
                            </div>
                            {isAuthenticated && (
                                <p className="text-xs text-gray-500 mt-1">
                                    选择您保存的角色数据卡，只有包含历战记录的角色才能进行升华
                                </p>
                            )}
                        </div>

                        {/* 成长方向引导输入框 */}
                        <div className="input-group">
                            <label htmlFor="user-guidance" className="input-label">成长方向引导 (可选)</label>
                            <input id="user-guidance" type="text" value={userGuidance} onChange={(e) => setUserGuidance(e.target.value)} className="input-field" placeholder="输入关键词或一句话 (最多30字)" maxLength={30} disabled={isGenerating} />
                            {userGuidance && appConfig.ALLOW_GUIDED_SUBLIMATION_NATIVE_SIGNING ? (
                                <p className="text-xs text-green-700 mt-1">✅ 管理员已允许引导升华保留原生签名。</p>
                            ) : (
                                <p className="text-xs text-yellow-700 mt-1">⚠️ 注意: 提供引导将使生成的角色变为“衍生数据”，并移除其原生签名。</p>
                            )}
                        </div>

                        {/* [新增] 高级选项UI */}
                        <div className="input-group mt-6">
                            <button onClick={() => setIsAdvancedVisible(!isAdvancedVisible)} className="text-sm font-semibold text-purple-700 hover:underline focus:outline-none">
                                {isAdvancedVisible ? '▼ ' : '▶ '}高级选项：自定义升华范围
                            </button>
                            {isAdvancedVisible && characterData && (
                                <div className="mt-3 p-4 bg-purple-50 border border-purple-200 rounded-lg">
                                    <p className="text-xs text-gray-600 mb-3">勾选你希望<span className="font-bold">保留不变</span>的字段，未勾选的字段将由AI重塑。</p>
                                    <div className="mb-4 flex flex-wrap gap-2">
                                        <button onClick={() => applyPreset('default')} className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-1 px-3 rounded-full">默认</button>
                                        <button onClick={() => applyPreset('full')} className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-1 px-3 rounded-full">完全重塑</button>
                                        <button onClick={() => applyPreset('personality')} className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-1 px-3 rounded-full">仅心灵成长</button>
                                    </div>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                        {currentFieldsConfig.map(field => (
                                            <label key={field.id} className="flex items-center text-sm cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={fieldsToPreserve.includes(field.id)}
                                                    onChange={() => handleOptionalFieldChange(field.id)}
                                                    className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                                                />
                                                <span className="ml-2 text-gray-700">{field.label}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* 多语言支持 */}
                        <div className="input-group">
                            <label htmlFor="language-select" className="input-label">
                                <img src="/globe.svg" alt="Language" className="inline-block w-4 h-4 mr-2" />
                                生成语言
                            </label>
                            <select
                                id="language-select"
                                value={selectedLanguage}
                                onChange={(e) => setSelectedLanguage(e.target.value)}
                                className="input-field"
                                disabled={isGenerating}
                            >
                                {languages.map(lang => (
                                    <option key={lang.code} value={lang.code}>{lang.name}</option>
                                ))}
                            </select>
                        </div>

                        {/* 成功提示信息 */}
                        {!isGenerating && resultData && (
                            <div className="text-center text-sm text-green-600 my-2 font-semibold">
                                🎉 升华成功！结果已显示在下方，请下滑查看。
                            </div>
                        )}

                        {/* 更新按钮状态和文本 */}
                        <button onClick={handleGenerate} disabled={isGenerating || !characterData || isCooldown} className="generate-button mt-4">
                            {isCooldown ? `冷却中 (${remainingTime}s)` : isGenerating ? '升华中...' : '开始升华'}
                        </button>
                        {error && <div className="error-message mt-4">{error}</div>}
                    </div>

                    {isGenerating && <div className="text-center mt-6">少女蜕变中，请稍后...</div>}

                    {resultData && (
                        <>
                            {resultData.unchangedFields && resultData.unchangedFields.length > 0 && (
                                <div className="card mt-6 bg-blue-50 border border-blue-200">
                                    <h4 className="font-bold text-blue-800 mb-2">升华报告</h4>
                                    <p className="text-sm text-blue-700">AI 已根据角色经历更新设定，但以下字段保留原始设定：</p>
                                    <ul className="list-disc list-inside text-xs text-blue-600 mt-2 pl-2">
                                        {resultData.unchangedFields.map(field => <li key={field}>{field}</li>)}
                                    </ul>
                                </div>
                            )}
                            {renderResultCard()}
                            <div className="card mt-6 text-center">
                                <h3 className="text-lg font-bold text-gray-800 mb-3">操作</h3>
                                <div className="flex flex-col md:flex-row justify-center">
                                    <button onClick={() => downloadJson(resultData.sublimatedData)} className="generate-button flex-1">
                                        下载新设定
                                    </button>
                                    <SaveToCloudButton
                                        data={resultData.sublimatedData}
                                        buttonText="保存到云端"
                                        className="generate-button flex-1"
                                        style={{ backgroundColor: '#22c55e', backgroundImage: 'linear-gradient(to right, #22c55e, #16a34a)' }}
                                    />
                                    <Link href="/battle" className="generate-button flex-1" style={{ backgroundColor: '#22c55e', backgroundImage: 'linear-gradient(to right, #22c55e, #16a34a)', textDecoration: 'none' }}>
                                        前往竞技场
                                    </Link>
                                </div>
                            </div>
                        </>
                    )}

                    <div className="text-center" style={{ marginTop: '2rem' }}>
                        <Link href="/" className="footer-link">返回首页</Link>
                    </div>
                </div>

                {showImageModal && savedImageUrl && (
                    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-lg max-w-lg w-full max-h-[80vh] overflow-auto relative p-4">
                            <button onClick={() => setShowImageModal(false)} className="absolute top-2 right-2 text-3xl text-gray-600 hover:text-gray-900">&times;</button>
                            <p className="text-center text-sm text-gray-600 mb-2">长按图片保存到相册</p>
                            <img src={savedImageUrl} alt="角色卡片" className="w-full h-auto rounded-lg" />
                        </div>
                    </div>
                )}
                <Footer />

                {/* 数据库数据选择模态框 */}
                <BattleDataModal
                    isOpen={showBattleDataModal}
                    onClose={() => setShowBattleDataModal(false)}
                    onSelectCard={handleSelectDataCard}
                    selectedType="character"
                />
            </div>
        </>
    );
};

export default SublimationPage;