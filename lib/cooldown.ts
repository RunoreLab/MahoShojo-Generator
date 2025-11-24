// lib/cooldown.ts

import { useState, useEffect, useCallback } from 'react';

const getLocalStorageItem = (key: string): number | null => {
    if (typeof window === 'undefined') {
        return null;
    }
    const item = localStorage.getItem(key);
    return item ? parseInt(item, 10) : null;
};

const setLocalStorageItem = (key: string, value: number) => {
    if (typeof window === 'undefined') {
        return;
    }
    localStorage.setItem(key, value.toString());
};

export const useCooldown = (key: string, duration: number) => {
    // 在开发环境中禁用 cooldown
    const isDevelopment = process.env.NODE_ENV === 'development';
    
    const [cooldownEndTime, setCooldownEndTime] = useState<number | null>(() => 
        isDevelopment ? null : getLocalStorageItem(key)
    );
    const [remainingTime, setRemainingTime] = useState<number>(0);

    // 当 key 变更时，重新同步本地存储的时间戳，避免沿用旧配置
    useEffect(() => {
        if (isDevelopment) return;
        const storedEndTime = getLocalStorageItem(key);
        setCooldownEndTime(storedEndTime);
        
        // [修复]：当切换 key 时，立即根据读取到的 storedEndTime 计算 remainingTime
        // 避免在下一次 interval 触发前出现状态不同步（例如切换回一个正在冷却的 key 时显示未冷却）
        if (!storedEndTime) {
            setRemainingTime(0);
        } else {
            const now = Date.now();
            const remaining = storedEndTime - now;
            if (remaining <= 0) {
                setRemainingTime(0);
                // 如果读出来的已经是过期时间，顺便清理一下
                localStorage.removeItem(key);
                setCooldownEndTime(null);
            } else {
                setRemainingTime(Math.ceil(remaining / 1000));
            }
        }
    }, [key, isDevelopment]);

    useEffect(() => {
        if (isDevelopment || !cooldownEndTime) return;

        const calculateRemainingTime = () => {
            const now = Date.now();
            const remaining = cooldownEndTime - now;
            if (remaining <= 0) {
                setRemainingTime(0);
                setCooldownEndTime(null);
                localStorage.removeItem(key);
            } else {
                setRemainingTime(Math.ceil(remaining / 1000));
            }
        };

        // calculateRemainingTime(); 

        const interval = setInterval(calculateRemainingTime, 1000);

        return () => clearInterval(interval);
    }, [cooldownEndTime, key, isDevelopment]);

    const startCooldown = useCallback((overrideDuration?: number) => {
        // 在开发环境中不启动 cooldown
        if (isDevelopment) return;
        
        const effectiveDuration = typeof overrideDuration === 'number' ? overrideDuration : duration;
        const endTime = Date.now() + effectiveDuration;
        setLocalStorageItem(key, endTime);
        setCooldownEndTime(endTime);
        // start 时立即更新 UI，提升响应速度
        setRemainingTime(Math.ceil(effectiveDuration / 1000));
    }, [duration, key, isDevelopment]);

    const isCooldown = !isDevelopment && remainingTime > 0;

    return { isCooldown, startCooldown, remainingTime };
};