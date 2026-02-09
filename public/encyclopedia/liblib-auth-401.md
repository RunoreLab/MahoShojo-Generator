# LibLib 立绘 401（签名/鉴权失败）排查

> 作者：[Colanns](https://github.com/colasama) / [末伏之夜](https://github.com/notuhao)  
> 更新时间：2026-02-09

当你在立绘生成里看到类似提示：

- `LibLib 鉴权失败（HTTP 401）`
- `签名验证失败`

说明请求已经到达 LibLib，但当前凭据或签名未通过校验。

## 常见原因

- `Access Key` 与 `Secret Key` 不配套（来自不同账号/不同应用）
- 复制时带了空格、换行或截断
- 本地设备时间偏差过大，导致签名时间戳校验失败
- Key 已失效、被重置或权限被调整

## 推荐排查顺序

1. 回到 LibLib 控制台重新复制一对新的 `Access Key / Secret Key`
2. 确认输入框中没有前后空格与换行
3. 先用默认工作流参数做最小化验证，再逐步恢复自定义配置
4. 检查设备系统时间是否准确（建议开启自动校时）

## 如何利用错误详情

现在错误信息会透传更多上游字段，例如：

- 上游 `message`（如“签名验证失败”）
- 上游 `code`（例如 `401`）
- `request id`（如果上游返回）

反馈问题时请附上：

- 完整错误文案（可打码隐私信息）
- 触发时间与页面入口
- 使用的是生成接口还是状态查询接口

## 相关条目

- AI 生成失败：`/encyclopedia/ai-errors`
- ModelScope 401：`/encyclopedia/modelscope-auth-401`
- 网络问题：`/encyclopedia/network-errors`
