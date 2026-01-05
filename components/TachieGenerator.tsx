"use client";

import { useState, useEffect } from "react";
import { generateTachieWithProgress, type TachieGenerationResult } from "@/lib/tachie/manager";
import { ErrorMessage } from "@/components/ErrorMessage";

interface TachieGeneratorProps {
  prompt: string;
}

export default function TachieGenerator({ prompt }: TachieGeneratorProps) {
  const [accessKey, setAccessKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<TachieGenerationResult | null>(null);
  const [rememberCredentials, setRememberCredentials] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressStatus, setProgressStatus] = useState("");

  // localStorage keys
  const CREDENTIALS_KEY = 'tachie_credentials';
  const REMEMBER_KEY = 'tachie_remember';

  // 组件加载时从localStorage读取凭据
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const shouldRemember = localStorage.getItem(REMEMBER_KEY) === 'true';
      setRememberCredentials(shouldRemember);

      if (shouldRemember) {
        const savedCredentials = localStorage.getItem(CREDENTIALS_KEY);
        if (savedCredentials) {
          try {
            const { accessKey: savedAccessKey, secretKey: savedSecretKey } = JSON.parse(savedCredentials);
            setAccessKey(savedAccessKey || '');
            setSecretKey(savedSecretKey || '');
          } catch (error) {
            console.error('Failed to parse saved credentials:', error);
          }
        }
      }
    }
  }, []);

  // 保存凭据到localStorage
  const saveCredentials = () => {
    if (typeof window !== 'undefined') {
      if (rememberCredentials && accessKey.trim() && secretKey.trim()) {
        localStorage.setItem(CREDENTIALS_KEY, JSON.stringify({
          accessKey: accessKey.trim(),
          secretKey: secretKey.trim()
        }));
        localStorage.setItem(REMEMBER_KEY, 'true');
      } else {
        localStorage.removeItem(CREDENTIALS_KEY);
        localStorage.setItem(REMEMBER_KEY, 'false');
      }
    }
  };

  // 清除已保存的凭据
  const clearSavedCredentials = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(CREDENTIALS_KEY);
      localStorage.setItem(REMEMBER_KEY, 'false');
      setRememberCredentials(false);
      setAccessKey('');
      setSecretKey('');
    }
  };

  const handleGenerate = async () => {
    if (!accessKey.trim() || !secretKey.trim()) {
      setResult({
        success: false,
        error: "请填写 Access Key 和 Secret Key",
      });
      return;
    }

    // 保存凭据（如果用户选择记住）
    saveCredentials();

    setIsGenerating(true);
    setResult(null);
    setProgress(0);
    setProgressStatus("正在提交生成任务...");

    try {
      const generationResult = await generateTachieWithProgress({
        source: "liblib",
        accessKey: accessKey.trim(),
        secretKey: secretKey.trim(),
        prompt,
      }, (progress, status) => {
        setProgress(progress);
        setProgressStatus(status);
      });
      setResult(generationResult);
    } catch (error) {
      setResult({
        success: false,
        error: error instanceof Error ? error.message : "生成失败",
      });
    } finally {
      setIsGenerating(false);
      setProgress(0);
      setProgressStatus("");
    }
  };

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <p className="text-center" style={{ fontSize: '0.875rem', color: '#666', marginTop: '1rem', lineHeight: 1.5 }}>
          请前往&nbsp;
          <a
            href="https://www.liblib.art/apis"
            target="_blank"
            rel="noopener noreferrer"
            className="footer-link"
          >
            LibLib
          </a>
          &nbsp;获取 Access Key 和 Secret Key
          <br />
          本系统代码已开源，不会存储您的凭据，请放心食用~
        </p>
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <div className="input-group">
          <label htmlFor="accessKey" className="input-label">
            LibLib Access Key
          </label>
          <input
            id="accessKey"
            type="password"
            value={accessKey}
            onChange={(e) => setAccessKey(e.target.value)}
            placeholder="输入你的 Access Key"
            className="input-field"
            disabled={isGenerating}
          />
        </div>

        <div className="input-group">
          <label htmlFor="secretKey" className="input-label">
            LibLib Secret Key
          </label>
          <input
            id="secretKey"
            type="password"
            value={secretKey}
            onChange={(e) => setSecretKey(e.target.value)}
            placeholder="输入你的 Secret Key"
            className="input-field"
            disabled={isGenerating}
          />
        </div>
      </div>

      {/* 记住凭据选项 */}
      <div className="input-group" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '0.875rem', color: '#666' }}>
          <input
            type="checkbox"
            checked={rememberCredentials}
            onChange={(e) => setRememberCredentials(e.target.checked)}
            style={{ marginRight: '0.5rem' }}
          />
          在本地记住我的凭据，方便下次使用
        </label>
        {rememberCredentials && (accessKey || secretKey) && (
          <button
            type="button"
            onClick={clearSavedCredentials}
            style={{
              background: 'none',
              border: 'none',
              color: '#ff6b6b',
              fontSize: '0.75rem',
              cursor: 'pointer',
              textDecoration: 'underline'
            }}
          >
            清除已保存的凭据
          </button>
        )}
      </div>

      <button
        onClick={handleGenerate}
        disabled={isGenerating || !accessKey.trim() || !secretKey.trim()}
        className="generate-button"
      >
        {isGenerating ? "立绘生成中，请稍后捏 (≖ᴗ≖)✧✨" : "✨ 生成立绘 ✨"}
      </button>

      {isGenerating && (
        <div style={{
          marginTop: '1rem',
          padding: '1rem',
          background: 'rgba(255, 255, 255, 0.9)',
          borderRadius: '16px',
          border: '1px solid rgba(255, 107, 107, 0.2)',
          textAlign: 'center'
        }}>
          <div style={{ marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.875rem', color: '#ff6b6b', fontWeight: '600' }}>
              {progressStatus || "立绘生成中，请稍后捏 (≖ᴗ≖)✧"}
            </span>
          </div>
          
          {/* 进度条 */}
          <div style={{
            width: '100%',
            height: '8px',
            background: 'rgba(255, 107, 107, 0.1)',
            borderRadius: '4px',
            overflow: 'hidden',
            marginBottom: '0.5rem'
          }}>
            <div style={{
              width: `${Math.max(progress, 5)}%`, // 最小显示5%，让用户看到有进度
              height: '100%',
              background: 'linear-gradient(90deg, #ff6b6b, #ff8787)',
              borderRadius: '4px',
              transition: 'width 0.3s ease',
              animation: progress === 0 ? 'shimmer 2s infinite' : 'none'
            }}></div>
          </div>

          {/* 进度百分比 */}
          <div style={{ fontSize: '0.75rem', color: '#666' }}>
            {progress > 0 ? `${progress}%` : "准备中..."}
          </div>
        </div>
      )}

      {result && !isGenerating && (
        <div style={{ marginTop: '1rem' }}>
          {result.success ? (
            <div>
              <div style={{
                padding: '0.75rem',
                background: 'linear-gradient(45deg, #51cf66, #8ce99a)',
                borderRadius: '12px',
                marginBottom: '1rem',
                textAlign: 'center'
              }}>
                <p style={{ fontSize: '0.875rem', color: 'white', fontWeight: '600', margin: 0 }}>
                  ✨ 生成成功！
                </p>
                {result.seed && (
                  <p style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.9)', margin: '0.25rem 0 0 0' }}>
                    种子值: {result.seed}
                  </p>
                )}
              </div>
              {result.imageUrl && (
                <div style={{
                  border: '2px solid rgba(255, 107, 107, 0.3)',
                  borderRadius: '12px',
                  overflow: 'hidden',
                  boxShadow: '0 8px 32px rgba(255, 107, 107, 0.2)'
                }}>
                  <img
                    src={result.imageUrl}
                    alt="生成的立绘"
                    style={{ width: '100%', height: 'auto', display: 'block' }}
                    onError={(e) => {
                      e.currentTarget.src = "";
                      e.currentTarget.alt = "图片加载失败";
                    }}
                  />
                </div>
              )}
            </div>
          ) : (
            <ErrorMessage message={result.error ?? "生成失败"} />
          )}
        </div>
      )}

      <style jsx>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        
        @keyframes shimmer {
          0% { opacity: 0.6; }
          50% { opacity: 1; }
          100% { opacity: 0.6; }
        }
      `}</style>
    </div>
  );
}
