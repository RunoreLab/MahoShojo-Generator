# 立绘渠道鉴权与常见错误排查（LibLib / ModelScope）

> 作者：[Colanns](https://github.com/colasama) / [末伏之夜](https://github.com/notuhao)  
> 更新时间：2026-02-10

本条目统一覆盖立绘生成的两条渠道：

- **LibLib**（`Access Key + Secret Key`）
- **ModelScope**（`Token`）

如果你遇到 `HTTP 401`、`签名验证失败`、`Authentication failed`，优先看本文。

---

## 1) 先判断是哪个渠道报错

### ModelScope 常见特征

- 错误里出现 `ModelScope` 或 `api-inference.modelscope.cn`
- 文案类似：`Authentication failed, please make sure that a valid ModelScope token is supplied.`

### LibLib 常见特征

- 错误里出现 `LibLib` 或 `openapi.liblibai.cloud`
- 文案类似：`签名验证失败`

---

## 2) 401 快速排查（通用）

1. **重新复制凭据**（最有效）
2. 检查输入框前后是否有空格/换行
3. 先用默认模型与默认参数做最小化验证
4. 确认设备时间准确（建议开启系统自动校时）

> 建议：先通过一次最小化请求，再逐步恢复自定义参数；这样最容易定位问题来源。

---

## 3) 渠道专项检查

### A. ModelScope（Token）

- 可直接粘贴 Token；系统会自动去除 `Bearer ` 前缀
- 若你是手动拼 `Bearer xxx`，请改为只填 Token 本体
- 账号权限、模型访问权限变化，也可能导致鉴权/权限错误

#### ModelScope 重点子场景：`Please bind your Alibaba Cloud account before use.`

当你看到这句提示时，通常不是 Token 拼写问题，而是**ModelScope 账号尚未绑定阿里云账号**。  
这类报错常表现为：

- `ModelScope 鉴权失败（HTTP 401）`
- `message: Please bind your Alibaba Cloud account before use.`

建议操作：

1. 登录 ModelScope 控制台，按页面提示完成阿里云账号绑定
2. 若页面还要求实名认证/协议确认，请一并完成
3. 绑定完成后等待 1~3 分钟，再用同一 Token 重试
4. 若仍失败，重新生成 Token 再测试一次

#### ModelScope 重点子场景：`...Aliyun account is real name verified...`（HTTP 403）

当你看到类似提示：

- `To use API-Inference, please make sure your associated Aliyun account is real name verified.`
- `ModelScope 权限不足（HTTP 403）`

这通常表示**阿里云账号未完成实名认证**，所以 Token 虽然有效，但无权调用该能力。

建议操作：

1. 打开 ModelScope 账号设置页：`https://www.modelscope.cn/my/accountsettings`
2. 按页面提示完成阿里云账号实名认证
3. 实名通过后等待几分钟，再使用同一 Token 重试
4. 若仍失败，重新生成 Token 并再次验证

### B. LibLib（Access Key / Secret Key）

- 两个 Key 必须来自同一账号、同一应用配置
- `签名验证失败` 往往是 Key 不匹配、密钥过期或本地时间偏差引起
- 如果近期重置过密钥，旧密钥会立即失效

---

## 4) 除了 401，还常见哪些错误？

- **400**：参数缺失/格式错误（如提示词为空）
- **403**：权限不足（常见于 ModelScope 未实名认证，或账号/能力权限受限）
- **429**：触发限流，建议间隔重试
- **5xx / 网络异常**：上游抖动或链路问题，短时间后重试
- **任务失败但无图**：查询成功但 `taskStatus/generateStatus` 表示失败或未完成

---

## 5) 如何读取“更详细”的错误信息

现在系统会尽量透传上游字段，常见包括：

- `message`：上游原始错误原因
- `code`：上游错误码
- `request id`：上游侧定位编号（有则附带）

反馈问题时建议附上：

- 完整错误文案（可打码）
- 触发时间（精确到分钟）
- 渠道（LibLib/ModelScope）与模型名
- `request id`（若错误里有）

---

## 6) 使用建议（降低报错概率）

- 凭据仅保存本地，定期轮换但不要频繁改动
- 网络不稳定时避免连点“生成”按钮
- 先生成小图验证链路，再切回高分辨率
- 出错后不要立刻多标签并发重试，优先单请求复现

---

## 相关条目

- AI 生成失败：`/encyclopedia/ai-errors`
- 429 限流：`/encyclopedia/rate-limit-429`
- 网络问题：`/encyclopedia/network-errors`
