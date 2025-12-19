# 流式生成版本的 updatedCombatants 功能实现方案

## 安全实现（已完成）

### 核心原则

**所有签名操作必须在服务端完成，前端只负责展示和调用。**

### 实现的安全机制

#### 1. 服务端签名验证端点

**文件：** `pages/api/arena/update-combatants-after-stream.ts`

**关键安全特性：**
- ✅ 验证输入角色的原生性（通过 `verifySignature` 验证签名）
- ✅ 如果角色声称原生但签名无效，自动降级为非原生
- ✅ 在服务端使用 `applyPostBattleUpdates` 重新签名
- ✅ 防止客户端伪造或注入恶意数据
- ✅ 使用环境变量中的密钥（`SIGNATURE_SECRET_KEY`）

**安全流程：**
```
客户端数据 → 服务端验证签名 → 更新数据 → 服务端重新签名 → 返回给客户端
```

#### 2. 前端安全 Hook

**文件：** `components/arena/hooks/useStreamCombatantUpdater.ts`

**功能：**
- `updateCombatants()`: 直接调用安全端点更新数据
- `updateFromMarkdown()`: 解析 Markdown 后调用安全端点
- 自动处理错误和加载状态

#### 3. 使用示例

在 `pages/arena-stream.tsx` 中：

```typescript
import { useStreamCombatantUpdater } from '@/components/arena/hooks/useStreamCombatantUpdater';

function ArenaStreamPageContent() {
  const { updateFromMarkdown, isUpdating } = useStreamCombatantUpdater();
  const combatants = useBattleStore((state) => state.combatants);
  const settings = useBattleStore((state) => state.settings);
  const battleMode = useBattleStore((state) => state.battleMode);
  const scenario = useBattleStore((state) => state.scenario);

  const handleGenerate = async () => {
    // ... 流式生成代码 ...

    // 流式生成完成后，安全地更新角色数据
    try {
      await updateFromMarkdown(
        accumulatedText, // 完整的 Markdown 内容
        combatants.filter((c): c is CombatantData => 'data' in c),
        battleMode,
        {
          userGuidance: settings.userGuidance,
          writeArenaHistory: settings.writeArenaHistory,
          writeCurrentState: settings.writeCurrentState,
        },
        scenario.content
      );

      console.log('✅ 角色数据已安全更新');
    } catch (error) {
      console.error('❌ 更新角色数据失败:', error);
      // 可选：显示错误提示
    }
  };
}
```

### 安全保障

#### 原生性验证流程

1. **客户端声称原生** (`isNative: true`)
   - 服务端调用 `verifySignature(combatant.data)`
   - 如果签名无效 → 降级为非原生

2. **更新数据时**
   - `applyPostBattleUpdates` 检查原生性
   - 只有原生角色才会被重新签名
   - 非原生角色会移除签名

3. **原生性冲突检测**
   - 如果同名角色既有原生也有非原生实例
   - 所有该名称的角色都会被视为非原生
   - 历战记录标记 `non_native_data_involved: true`

#### 防御注入攻击

- ❌ 客户端无法伪造有效签名（没有密钥）
- ❌ 篡改数据会导致签名失效，被降级为非原生
- ❌ 恶意角色数据会在服务端被标记为非原生

### 与标准版本的区别

| 特性 | 标准版 (`/arena`) | 流式版 (`/arena-stream`) |
|------|------------------|-------------------------|
| 生成方式 | 一次性结构化 JSON | 实时文本流 |
| 返回数据 | 包含 `updatedCombatants` | 纯 Markdown 文本 |
| 角色更新 | 自动（API 返回） | 需要额外调用端点 |
| 签名验证 | 服务端自动处理 | 服务端独立端点处理 |
| 安全性 | ✅ 高 | ✅ 高（独立验证） |

---

## 已废弃的方案

### 方案 A：双重请求（原方案）
流式生成 + 再次请求标准 API。

**问题：** 需要生成两次，浪费资源。

### 方案 B：流式末尾附加元数据（原方案）
在 Markdown 流末尾添加 `__METADATA__` 分隔符。

**问题：** 复杂度高，容易出错。

### 方案 C：不更新角色数据（原方案）
流式版本不更新历战记录。

**问题：** 功能不完整。

---

## 当前实现状态

✅ **已完成：**
- 安全的服务端验证端点（`/api/arena/update-combatants-after-stream`）
- 前端安全更新 Hook（`useStreamCombatantUpdater`）
- 已集成到竞技场流式生成：`generationMode === 'stream'` 生成完成后会自动调用更新端点并回写 `updatedCombatants`
- 完整的签名验证流程
- 原生性冲突检测
- 防注入攻击机制

📝 **可选改进：**
- 为“角色更新”增加更明确的成功提示（当前仅在失败时提示）
- 增加“跳过角色更新”开关（适合只想看故事、不想写入历战记录的场景）

---

## 安全检查清单

在部署到生产环境前，请确保：

- [ ] 环境变量 `SIGNATURE_SECRET_KEY` 已正确配置
- [ ] 服务端日志正常记录签名验证结果
- [ ] 前端正确处理更新失败的情况
- [ ] 测试原生性冲突场景
- [ ] 测试篡改数据的防御能力

---

## 下一步

1. **用户体验优化**：补充加载提示与成功提示
2. **策略开关**：允许用户选择是否跳过“流式生成后的角色更新”
3. **测试**：验证各种场景下的签名、原生性冲突与更新逻辑

