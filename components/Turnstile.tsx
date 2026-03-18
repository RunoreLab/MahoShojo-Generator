'use client';
import Script from 'next/script';
import { useCallback, useEffect, useRef, useState, memo, useImperativeHandle, forwardRef } from 'react';

interface TurnstileWidgetProps {
    onVerify: (token: string) => void;
    //颜色
    theme?: 'light' | 'dark';
    //语言
    language?: string;
    //尺寸
    size?: 'normal' | 'flexible' | 'compact';
}

export interface TurnstileRef {
    reset: () => void;
}

const TurnstileWidget = memo(forwardRef<TurnstileRef, TurnstileWidgetProps>(({
    onVerify,
    theme = 'light',
    language = 'zh-CN',
    size = 'flexible'
}, ref) => {
    const divRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | null>(null);
    const [isLoaded, setIsLoaded] = useState(false);
    const onVerifyRef = useRef(onVerify);

    // 更新回调引用但不触发重新渲染
    useEffect(() => {
        onVerifyRef.current = onVerify;
    }, [onVerify]);

    const renderWidget = useCallback(() => {
        const sitekey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
        
        if (!sitekey) {
            console.error('NEXT_PUBLIC_TURNSTILE_SITE_KEY is not configured');
            return;
        }

        if (divRef.current && window.turnstile && !widgetIdRef.current) {
            try {
                // 清空容器
                divRef.current.innerHTML = '';
                
                widgetIdRef.current = window.turnstile.render(divRef.current, {
                    sitekey,
                    callback: (token: string) => onVerifyRef.current(token),
                    theme,
                    language,
                    size
                });
            } catch (error) {
                console.error('Turnstile render error:', error);
            }
        }
    }, [theme, language, size]);

    // 暴露重置方法
    useImperativeHandle(ref, () => ({
        reset: () => {
            if (widgetIdRef.current && window.turnstile) {
                try {
                    window.turnstile.reset(widgetIdRef.current);
                } catch (error) {
                    console.warn('Turnstile reset error:', error);
                }
            }
        }
    }), []);

    // 处理Script加载完成
    const handleScriptLoad = useCallback(() => {
        setIsLoaded(true);
        // 延迟一下确保DOM准备就绪
        setTimeout(renderWidget, 100);
    }, [renderWidget]);

    // 检查window.turnstile是否已经存在
    useEffect(() => {
        if (window.turnstile && !isLoaded) {
            setIsLoaded(true);
            setTimeout(renderWidget, 100);
        }
    }, [isLoaded, renderWidget]);

    // 当组件挂载且脚本已加载时渲染
    useEffect(() => {
        if (isLoaded && window.turnstile && !widgetIdRef.current) {
            renderWidget();
        }
    }, [isLoaded, renderWidget]);

    // 组件卸载时的清理
    useEffect(() => {
        return () => {
            if (widgetIdRef.current && window.turnstile) {
                try {
                    window.turnstile.remove(widgetIdRef.current);
                } catch (error) {
                    console.warn('Turnstile cleanup error:', error);
                }
            }
        };
    }, []);

    return (
        <>
            <Script
                src="https://challenges.cloudflare.com/turnstile/v0/api.js"
                onLoad={handleScriptLoad}
                strategy="lazyOnload"
            />
            <div ref={divRef} />
        </>
    );
}));

TurnstileWidget.displayName = 'TurnstileWidget';

export default TurnstileWidget;
