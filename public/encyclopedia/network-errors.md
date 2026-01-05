# 网络问题（Failed to fetch / 连接中断）

> 作者：[Colanns](https://github.com/colasama) / [末伏之夜](https://github.com/notuhao)  
> 更新时间：2026-01-05

当你看到「网络连接失败」「Failed to fetch」「NetworkError」等提示时，通常意味着：**浏览器没能成功把请求发到服务器，或回包途中被中断**。

## 常见原因

- 本地网络不稳定（Wi‑Fi 抖动、移动网络切换、DNS 异常）
- VPN/代理/公司网络拦截或重写请求
- 浏览器插件拦截（广告拦截、隐私插件、脚本拦截）
- 临时的跨域/缓存异常（尤其是多标签页、长时间挂起后）

## 自救建议（按优先顺序）

1. **刷新页面并重试**
2. **切网络**：Wi‑Fi ↔ 移动热点，或关闭 VPN/代理后重试
3. **无痕窗口重试**：排除插件/缓存影响
4. **仍失败**：更可能是 Cloudflare/服务器问题（见下方相关条目）

## 相关条目

- Cloudflare/服务器错误：`/encyclopedia/cloudflare-errors`
- AI 生成失败：`/encyclopedia/ai-errors`
