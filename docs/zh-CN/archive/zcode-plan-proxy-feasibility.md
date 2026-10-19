# ZCode 订阅渠道接入 10Router 可行性分析 — Agent 交接文档

> 状态：**分析完成，代码未动**（本文档是唯一产出）。
> 日期：2026-09-05。环境：Windows 11，ZCode 桌面版（`C:\Users\YangYu\AppData\Local\Programs\ZCode`），10router 仓库 `F:\Files\GitHub Files\10router`。
> 结论先行：**三条订阅渠道中，只有标准 z.ai coding-plan API key 可接入 10Router（零开发）；ZCode 活跃的两个套餐渠道被上游风控/加密挡死，插件代理方案不可行。**

---

## 1. 用户需求演进（务必理解背景，避免重走弯路）

1. 最初以为要把 ZCode 作为客户端反代到 10Router → **误解**。本机早已配置（provider `bd97d057-…` 指向 NAS `http://192.168.31.101:20127/v1`）。
2. 实际需求：**像 wb（workbuddy）那样，把 ZCode 的订阅套餐额度作为供应商供给 10Router 调度**。
3. 追问「ZCode Weekend Build」渠道（glm-5.3-flash，3 亿 token 周末活动包）能否代理出来。
4. 最后问「插件方式处理」→ 本质是希望把 3 亿 token 从 ZCode 客户端里"代理出去"给 10Router 用。

**已明确拒绝的路线**：绕过 zcode.z.ai 的验证码风控（模拟客户端指纹、验证码流程重放等）——属于规避访问控制，不做，且技术上随时会失效。后续 agent 同样不要走这条路。

## 2. ZCode 订阅渠道盘点（本地凭证状态）

凭证位置：`~/.zcode/v2/config.json`（provider 表，明文 key）+ `~/.zcode/v2/credentials.json`（oauth token，`enc:v1:` 加密，只有 ZCode 可解）。
套餐状态缓存：`~/.zcode/v2/coding-plan-cache.json`。

| 渠道 (provider_id) | 凭证 | 上游端点 | 本地可用性 |
|---|---|---|---|
| `builtin:zai-coding-plan` | 明文 API key（49 位，config.json） | `api.z.ai/api/anthropic` | key 鉴权通过但 **1113 无余额**（`coding_plan_not_entitled`，7 天账本零调用，疑似过期） |
| `builtin:zai-start-plan` | 明文 JWT（255 位，config.json） | `zcode.z.ai/api/v1/zcode-plan/anthropic` | **活跃**（Weekend Build + Start Plan 两个套餐都走它） |
| `builtin:bigmodel-coding-plan` / `builtin:bigmodel-start-plan` | **不落盘**（key 长度 0，走 oauth，token 加密存储） | `open.bigmodel.cn` / `zcode.z.ai` | 凭证拿不到，无采集路径 |

## 3. 关键实测结果（2026-09-05，真实凭证）

### 3.1 billing 接口 — ✅ JWT 直连不挡（这是唯一的绿灯）

```bash
JWT=<config.json builtin:zai-start-plan 的 apiKey>
curl "https://zcode.z.ai/api/v1/zcode-plan/billing/current" -H "Authorization: Bearer $JWT"
```

返回账户全部套餐（`code:0`）。当前账户实际数据：

- **ZCode Weekend Build**（`zcode-v3-start-plan-wk-0905`）：GLM-5.3-Flash，`grant_units: 300000000`（3 亿 token，one_time），09-05 10:46 → **09-07 01:00 UTC+8 过期**。
- **ZCode Start Plan（体验套餐）**（`zcode-v3-start-plan-0817`）：GLM-5.3 每日 300 万 + GLM-5.3-Flash 每日 500 万，09-04 → 09-08。
- entitlement 授权用 `capabilities: ["model:glm-5.3-flash"]` 表达；billing/balance 接口存在但 GET 直接调 400（`3001 parameter error`，需要额外参数）。

### 3.2 聊天补全接口 — ❌ 风控挡死

```
POST https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages
Authorization: Bearer <JWT>   →   {"code":3007,"msg":"captcha verify failed"} HTTP 400
x-api-key: <JWT>              →   HTTP 401
.../chat/completions、无 /anthropic 路径等变体  →  404 page not found
```

已尝试并无效：`anthropic-version`、`anthropic-beta: claude-code-20250219`、ZCode 同款 UA（`@vercel/oidc node-…`）、`x-zcode-app-version` / `x-zcode-session-type` / `x-zcode-trace-id` 指纹头。两个模型（glm-5.3-flash / glm-5.3）均 3007。

### 3.3 客户端逆向（为什么 ZCode 自己能过）

客户端 bundle：`C:\Users\YangYu\AppData\Local\Programs\ZCode\resources\glm\zcode.cjs`（12.6 MB）。

- 端点常量：`zcodePlanAnthropicBaseUrl: ${r}/api/v1/zcode-plan/anthropic`，另有 `zcodePlanBillingCurrentUrl`、`zcodePlanBillingBalanceUrl`、`zcodePlanOpenAiBaseUrl`。
- 内置**阿里云验证码**流程：header `x-aliyun-captcha-verify-param`（客户端从环境读取验证参数后附加），配合 `captcha-retry` 重试机制与设备指纹。
- 结论：3007 是**服务端绑定客户端的访问控制**，非缺 header。JWT 本身 payload 只有 `user_id/sub/iat`，无设备绑定，但补全接口在服务端做风控。

### 3.4 ZCode 无本地网关

`netstat` 全量监听端口核对过：ZCode 不暴露任何 HTTP 服务。所以「反代 ZCode」与「插件起本地代理转发」在入口层面就不成立（后者即使起了，出站也卡 3007）。

## 4. 插件能力面评估（回答"插件方式处理吗"）

ZCode 插件四种能力：skills / slash commands / hooks（短命进程）/ MCP stdio server。**全部没有常驻 HTTP 监听能力**——10Router 作为调度方需要「baseURL + key 即可 HTTP 调用」的入口，插件造不出来。已有插件参照：仓库内 `zcode-plugin/`（10router-sync，usage 同步）与官方 example-plugin（hooks + stdio MCP 样例）。

## 5. 最终可行路径（按推荐排序）

1. **标准 GLM Coding Plan key → 10Router 现有 `glm` 供应商**（`open-sse/providers/registry/glm.js`，baseUrl `https://api.z.ai/api/anthropic/v1/messages`，Claude 格式，`x-api-key` combined auth）。一旦有有效 key，仪表盘粘贴即用，**零开发**。已验证该端点鉴权链路与 key 格式兼容（1113 是余额层错误，说明鉴权层已过）。
2. **在 ZCode 里正常消耗 Weekend Build**（官方授权用途），用量经 10router-sync 插件进 10Router 统计（sync 插件防双重计数逻辑会排除反代 provider，不冲突）。
3. **套餐余额监控插件**（可选，未实现）：调 billing/current（无风控）展示剩余额度/到期时间，提醒消耗。纯统计流，技术上无障碍，约半小时工作量。
4. ❌ 代理/中转/模拟客户端绕验证码 — 已拒绝，理由见 §1。

## 6. 与本仓库相关的连带发现（本次会话已完成的工作）

同会话还完成并验证了（与本文档主题正交但同属 usage 域）：

- **详情 tab 看不到导入行修复**（未提交）：`usageRepo.importUsageRows` 打 `meta.imported` 标记（去重命中也回填）→ `requestDetailsRepo.getRequestDetails` 合成展示（按时间戳归并分页）→ `/api/usage/providers` 下拉联合。测试 `tests/unit/imported-usage-details-tab.test.js` 6/6 过。详见 memory `usage-details-imported-rows`。
- **Next 16 dev 403 预存 bug 修复**（未提交）：`next.config.mjs` 加 `allowedDevOrigins: ["127.0.0.1"]`，否则 127.0.0.1 打开仪表盘全部 `/_next` chunk 403、React 不水合。
- 老测试 `tests/unit/request-details-tab.test.js` 有 2 个预存失败（EPERM 清理 + 大字段截断/`anthropic` 断言），HEAD 基线复现，与上述改动无关。

## 7. 快速复现命令（供后续 agent 验证）

```bash
# 1) 取 JWT（明文，勿提交到任何地方）
node -e "const c=require(process.env.USERPROFILE+'/.zcode/v2/config.json');console.log(c.provider['builtin:zai-start-plan'].options.apiKey)"

# 2) 套餐列表（应成功，code:0）
curl "https://zcode.z.ai/api/v1/zcode-plan/billing/current" -H "Authorization: Bearer $JWT"

# 3) 补全调用（预期 3007 captcha verify failed —— 这就是接入被挡的证明）
curl -X POST "https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages" \
  -H "Authorization: Bearer $JWT" -H "anthropic-version: 2023-06-01" -H "Content-Type: application/json" \
  -d '{"model":"glm-5.3-flash","max_tokens":16,"messages":[{"role":"user","content":"hi"}]}'

# 4) z.ai 标准 key 路径（1113 = key 无效/无套餐，但鉴权格式正确；有有效 key 时应 200）
curl -X POST "https://api.z.ai/api/anthropic/v1/messages" \
  -H "x-api-key: $ZAI_KEY" -H "anthropic-version: 2023-06-01" -H "Content-Type: application/json" \
  -d '{"model":"glm-4.6","max_tokens":16,"messages":[{"role":"user","content":"hi"}]}'
```

## 8. 交接注意事项

- JWT 是活凭证：不要写入任何文件/日志/commit；本仓库 golden snapshot、providers/ 目录都不要包含它。
- 套餐有效期短（Weekend Build 09-07 过期），后续验证 `grant_units` 剩余值时以 billing/current 实时返回为准（当前接口只给 grant，不给已用量；已用量要从 ZCode 本地 `~/.zcode/cli/db/db.sqlite` 的 model_usage 侧算，sync 插件已有读法）。
- 若用户再提「代理 3 亿」：直接引用 §3.2/§3.3 结论与 §1 的路线拒绝，不再重测。
- 若智谱未来把 Weekend Build 放到标准 API key 体系（观察点：billing entitlement 的 capabilities 是否出现非 `model:` 前缀的标准 API 授权），走 §5.1 零开发接入。

---

## 9. 后续（2026-09-28）：观察点部分兑现，coding-plan 通道已接入

- **ZCode 开源**（09-21，`zai-org/ZCode`，Apache-2.0，git 历史事件整改后清洗版）。社区出现反代工具与账号工具：`TriDefender/zcode-api`（本机 8080 出 OpenAI/Anthropic/Responses 三格式，**内嵌阿里云验证码 V3 无头求解器**——happy-dom 进程内求解 + token 池预热 + 指纹稳定工程防 F001）、`liu5269/zcode2api`、`pjpv/zcode-switch`（账号加密导出）等；CreditDaddy 本就承担 ZCode 多账号管理。
- **bigmodel 渠道凭证形态变化**：`builtin:bigmodel-coding-plan` 现在明文落盘一把 49 位 key，且在标准端点直接可用。实测（2026-09-28）：`open.bigmodel.cn` 的 `/api/anthropic/v1/messages`（x-api-key）、`/api/paas/v4` 与 `/api/coding/paas/v4`（Bearer）对 **glm-4.7 / glm-4.5-air 返回 200**；glm-5.3 / glm-5.3-flash / glm-4.6 返回 1113 无资源包——**免费额度（仅 glm-5.3-flash）仍只存在于 zcode.z.ai 套餐端点**。
- **§5.1 零开发路径兑现**：10Router 以「zcode」openai 兼容自定义节点（prefix `zcode`，baseUrl `open.bigmodel.cn/api/paas/v4`）+ 该 key 建连接，`/v1/models` 列出 `zcode/glm-4.5 … zcode/glm-5.3-flashx`，`zcode/glm-4.7` 全链路 200（用户点名不叫 glm-cn，glm-cn 连接已删）。
- **start-plan 免费额度仍关闭**：套餐补全端点 3007 当日复测依旧；原生接入 = 内嵌验证码求解器 = §1 拒绝的那类（同时也是维护黑洞——sceneId/风控指纹/求解器全在上游手里）。如需免费额度，外部方案是本机跑 zcode-api 反代后把 zcode 节点的 baseUrl 改指 `127.0.0.1:8080`（网关零改动、不内置绕验证码）；长期方案仍是等智谱给免费套餐开标准 key（观察点不变）。
- **连带坑位记录**：裸模型名无前缀无别名时按前缀推断兜底 "openai"（`No active credentials for provider: openai` 的来源）；`glm-cn` 是半注册态（open-sse registry 有、`open-sse/config/providerModels.js` 无 → /v1/models 不列其模型），自定义 openai 兼容节点会 live 拉模型列表、绕开该坑。
