# ModelScope 立绘 401（鉴权失败）排查

> 作者：[Colanns](https://github.com/colasama) / [末伏之夜](https://github.com/notuhao)  
> 更新时间：2026-02-09

当你在立绘生成里看到类似提示：

- `ModelScope 鉴权失败（HTTP 401）`
- `Authentication failed, please make sure that a valid ModelScope token is supplied.`

说明请求已到达 ModelScope，但当前 Token 认证没有通过。

## 常见原因

- Token 填错、过期或已被撤销
- 复制时带了多余字符（空格、换行、引号）
- 把 `Bearer xxx` 整段粘贴到输入框（本系统会尝试自动去除 `Bearer` 前缀，但建议直接粘贴纯 Token）
- Token 对应账号暂无相关推理权限，或模型访问受限

## 推荐排查顺序

1. 到 ModelScope 控制台重新生成一个新 Token，再完整复制  
2. 输入框中只保留 Token 本体，不要手动添加 `Bearer `
3. 确认前后没有空格/换行（尤其是手机端复制粘贴）
4. 保持模型默认值先做最小化验证，再逐步修改参数

## 如何利用错误详情

现在错误信息会透传更多上游字段，例如：

- 上游 `message`（具体失败原因）
- `request id`（用于向 ModelScope 侧反馈排查）

如果你需要反馈问题，请附上：

- 完整报错文案（可打码个人信息）
- `request id`
- 触发时间与所选模型

## 相关条目

- AI 生成失败：`/encyclopedia/ai-errors`
- AI_APICallError：`/encyclopedia/ai-api-call-error`
- 网络问题：`/encyclopedia/network-errors`
