# 用量去重 usageKey 契约

> 修复日期：2026-08-30 · 引入版本：v1.0.3
> 相关文件：`src/lib/db/repos/usageRepo.js` · 回归测试：`tests/unit/usage-dedup.test.js`

## 背景

`saveRequestUsage`（`usageRepo.js`）负责把每次请求用量写入 `usageHistory` 表，并同步聚合到 `usageDaily` 和生命周期计数器。它依赖一个**去重**逻辑：同一请求若被重复写入（如重试、网络层重复投递），应只记一次。

## 问题：同毫秒丢计数

去重原本**只按内容匹配**：

```sql
-- 去重键：timestamp(精确到毫秒) + provider + model + connectionId + apiKey + promptTokens + completionTokens
SELECT id FROM usageHistory
WHERE timestamp = ?
  AND provider = ? AND model = ?
  AND connectionId = ? AND apiKey = ?
  AND promptTokens = ? AND completionTokens = ?
```

**缺陷**：两个**真实不同**的请求，若落在**同一毫秒**且 **token 数恰好相同**，第二条会被当成重复吞掉——历史行、日聚合、生命周期计数全部丢失一条。对高并发网关，同毫秒并发是常态，丢计数会持续发生。

## 修复：usageKey 契约

让**调用方**在每次上游尝试时打一个**唯一的 `usageKey`**（`randomUUID()`），去重只按 key 判定：

```js
// usageRepo.js — saveRequestUsage 去重逻辑
const existingKey = parseJson(existing.meta, {}).usageKey || "";
if (!entry.usageKey || existingKey === entry.usageKey) {
  // 同 key → 视为重复，跳过（仅补充缺失的 endpoint）
  return;
}
// 内容相同但 key 不同 → 是另一个真实请求，继续写入
```

- **带 key 的调用方**：仅当两次写入的 `usageKey` 相同才去重；同内容不同 key 一律计数。
- **不带 key 的旧调用方**：保持原有内容去重行为（向后兼容）。

`usageKey` 存于 `usageHistory.meta` JSON 字段。

## 必须写 usageKey 的调用点（共 5 处）

每次**上游尝试**必须新生成一个 `usageKey`（`randomUUID()`），而不是复用：

| 文件 | 场景 |
|------|------|
| `src/sse/handlers/embeddings.js` | embeddings 用量 |
| `open-sse/handlers/chatCore/nonStreamingHandler.js` | 非流式 chat |
| `open-sse/handlers/chatCore/sseToJsonHandler.js` | SSE→JSON（两处：成功 + fallback） |
| `open-sse/handlers/chatCore/streamingHandler.js` | 流式 chat |

> ⚠️ **新增用量写入点时，务必打新的 `usageKey`**，否则会退化为内容去重、再次出现同毫秒丢计数。

## 验证

`tests/unit/usage-dedup.test.js` 覆盖三条路径：

1. **同毫秒、同内容、不同 usageKey** → 两条都计数（修复目标）
2. **同 usageKey 写两次** → 只计一次（幂等保护仍在）
3. **无 usageKey** → 保持内容去重

> 该测试曾因**硬编码时间戳过期**而失败（`getUsageStats("24h")` 窗口查不到历史日期），后改为动态当前时间（commit `d20444d7`）。写同类测试时时间戳要用 `Date.now()` 而非固定日期。

> **2026-09-16 补洞**：usageKey 合同曾被**签名静默丢参**架空——chatCore 四个调用点都传了 `usageKey: randomUUID()`，但中间层 `saveUsageStats` 的解构签名没有该参数，全部在调用边界丢弃（合同实际未生效于主链路）。修复时补了 `tests/unit/usage-stats-usagekey.test.js`：同毫秒同内容双调用、不同 key → 两行都存活。教训：**跨模块传参必须在终点断言字段真的存在**，签名"看起来传了"不算数。详见 [test-report-1.1.2-silent-data-drop.md](test-report-1.1.2-silent-data-drop.md)。
