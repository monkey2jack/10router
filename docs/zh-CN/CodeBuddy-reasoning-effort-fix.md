# CodeBuddy CN 模型 reasoning_effort 兼容性修复

> 修复日期：2026-09-01 · 修复 commit：`167f272f`
> 影响版本：v1.0.4 及之后

## 背景

用户通过 **Mirasim 内的 dsh（DeepSeek Harness）** 调用 10Router 的 `cbcn/deepseek-v4-pro` 时报 400 错误，表现为编码 agent 无法正常对话。

排查过程中实际遇到两种错误码，需区分：

| 错误码 | 消息 | 性质 |
|--------|------|------|
| `11128` | Illegal API invocation from an unapproved channel | CodeBuddy 服务端**渠道级**风控；v1.1.2 起 10router 会熔断整个渠道（不再逐账号重试放大），非本修复对象，详见 `codebuddy-cn-error-codes.md` |
| `11150` | reasoning effort value is not supported by the current model | **稳定可复现**的代码问题，本次修复对象 |

## 根因

CodeBuddy 的 **DeepSeek 系列模型**对 `reasoning_effort` 参数的支持范围和 GLM/Kimi 等不同：

| reasoning_effort 值 | deepseek-v4-pro | glm-5.3 |
|---------------------|-----------------|---------|
| `low` / `medium` / `high` / `xhigh` / `max` / `none` | ✅ 支持 | ✅ 支持 |
| `auto` | ❌ 400 `11150` | ✅ 支持 |
| `off` | ❌ 400 `11150` | ✅ 支持 |

dsh 等编码 agent 默认发送 `THINK:auto`（即 `reasoning_effort: "auto"`）。10Router 的 `CodeBuddyExecutor` 原有逻辑：

```js
// 修复前
const eff = transformed.reasoning_effort;
if (eff === "none" || eff === "off") {
  delete transformed.reasoning_effort;      // 只处理 none/off
} else if (eff) {
  transformed.reasoning_summary = "auto";   // auto/high/low 原样保留
}
```

对 `auto` 走 `else if` 分支，`reasoning_effort: "auto"` 被**原样转发**给 DeepSeek → 触发 `11150`。

## 修复

修改 `open-sse/executors/codebuddy-cn.js` 的 `transformRequest`：

```js
// 修复后
const eff = transformed.reasoning_effort;
const isDeepSeek = /^deepseek/.test(model || "");

if (isDeepSeek && (eff === "auto" || eff === "off")) {
  if (eff === "auto") transformed.reasoning_effort = "high";   // auto → high
  else delete transformed.reasoning_effort;                    // off → drop
} else if (eff === "none" || eff === "off") {
  delete transformed.reasoning_effort;                         // 原逻辑
} else if (eff) {
  transformed.reasoning_summary = "auto";                      // 原逻辑
}
```

### 修复逻辑

对 **DeepSeek 系列模型**（不支持 `auto`/`off`）：
- `auto` → **映射为 `high`**（保留推理能力，且是网关默认强度）
- `off` → **删除字段**（等价于 DeepSeek 接受的 `none`）

对非 DeepSeek 模型（GLM/Kimi 等），保持原有行为不变。

## 验证

实测（直连 CodeBuddy API，活跃 token）：

```
deepseek-v4-pro + reasoning_effort=auto  → ❌ 400 code 11150   (修复前)
deepseek-v4-pro + reasoning_effort=high  → ✅ 成功
deepseek-v4-pro + reasoning_effort=off   → ❌ 400 code 11150   (修复前)
deepseek-v4-pro + 无 reasoning_effort    → ✅ 成功
deepseek-v4-pro + reasoning_effort=low/medium/high/xhigh/max/none → ✅ 全部成功
```

修复后，dsh 发送 `THINK:auto` 调 `cbcn/deepseek-v4-pro` 会先被映射为 `high`，不再触发 11150。

## 相关注意事项

1. **`11128`（unapproved channel）** 与本次修复无关，是 CodeBuddy 服务端的**渠道级**风控（实测为多账号同秒连打同一模型触发，单发请求永远 200）。v1.1.2 起 10router 对其做渠道熔断：不加账号锁、不逐账号重试，60s 起步、复发升到 10min，成功即清除。详见 `codebuddy-cn-error-codes.md` 的 11128 专节。
2. **GLM 系列 `429` 频率限制**：某账号的 glm-5.3 使用量超限时返回 `6004`，属正常配额消耗，会按 CodeBuddy 返回的重置时间自动恢复。
3. **账号分配**：CodeBuddy 支持多账号 fallback，某账号某模型锁定时会自动切换到下一个账号（`[FALLBACK] ⇄` 日志）。注意 `11128` 是**渠道级**的例外——它不走逐账号 fallback，而是直接熔断整个渠道（v1.1.2 起），因为逐账号连发正是触发它的信号。
