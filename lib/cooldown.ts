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
        if (!storedEndTime) {
            setRemainingTime(0);
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

        calculateRemainingTime();

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
    }, [duration, key, isDevelopment]);

    const isCooldown = !isDevelopment && remainingTime > 0;

    return { isCooldown, startCooldown, remainingTime };
};
