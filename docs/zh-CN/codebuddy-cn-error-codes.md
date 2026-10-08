# CodeBuddy 错误码对照与修复速查（CN 与国际版通用）

> 用途：10Router CodeBuddy 两渠道排查时先查这张表定位错误码性质——是**可修的代码问题**、**间歇风控**、还是**上游参数/格式缺陷**，避免一看到 400 就乱改配置。适用渠道：`codebuddy-cn`（alias `cbcn`，上游 `https://copilot.tencent.com`）与 `codebuddy-intl`（alias `cbai`，上游 `https://www.codebuddy.ai`）——**错误码空间两边共用**（`11102`/`11133`/`11134`/`11140` 均已在 intl 观测到），差异处文中单独标注。
> 维护：2026-09-05 汇总历次修复；2026-09-12 补入 11140（intl 账号级风控）并确认全文对 intl 适用；2026-10-09 补入 11102 专节与「模型寻址」专节（UI 上的 `xt/ag/…-high` 不是可寻址 id，思考档走 `reasoning_effort`）。每个码的完整修复细节见「相关文档」列的独立 fix doc。

## 一、错误码速查表

| Code | HTTP | 报错(节选) | 性质 | 归属 | 修复/出路 |
|------|------|-----------|------|------|----------|
| `11101` | 400 | Non-stream chat request is currently not supported | **可修(代码)** | executor | 强制 `stream=true`(CodeBuddy 只支持流式)；10router 为非流式客户端本地聚合 |
| `11102` | 400 | model [xxx] service info not found | **目录错误（唯一的"id 不存在"判据）** | 上游目录 | 该 id 上游不认。**也是判定模型存在性的唯一可靠 oracle**：网关是 OpenAI 透传，未注册的 id 可直接打过去探。见下方专节 |
| `11128` | 400 | Illegal API invocation from an unapproved channel | **渠道级风控（间歇）** | 服务端 | 10router 已改为**渠道级熔断**（不逐账号重试）；无配置可解，等熔断窗口或换渠道。见下方专节 |
| `11133` | 400 | the request parameters were rejected by the model provider (`model_param_invalid`) | **多为客户端/上游缺陷** | mirasim/上游 | 二分请求侧 vs 响应侧定位；workaround 换 hy4。见相关文档 |
| `11134` | 500 | the model provider is temporarily unavailable, please retry later or switch… | **上游临时不可用** | 上游 | 等上游自报的 reset 时间；**不是目录错误，勿因此下架模型**。见下方专节 |
| `11140` | 403 | `{"code":11140,"msg":"request illegal","requestid":"…"}` | **账号级风控（新）** | 服务端 | 本地无解——额度接口仍 200、与请求形态/模型/代理无关；等恢复或换号。见下方专节 |
| `11150` | 400 | reasoning effort value is not supported by the current model | **可修(代码)** | executor | DeepSeek 系不支持 `auto/off` → 请求侧 `auto→high`、`off→删字段`(commit `167f272f`) |
| `11151` | 400 | assistant 带 reasoning | **上游格式** | 上游 | 上游对 assistant 消息携带 reasoning 的校验；规避请求形态 |
| `6004` | 429 | 您的使用量已超出频率限制，将于…重置 | **配额限流** | 服务端 | 等 CodeBuddy 返回的 reset 时间自动恢复；正常配额消耗 |
| `401` | 401 | 鉴权服务请求失败 | **token/网络** | 上游 | 多为一过性网络/鉴权超时，重试；持续则查 token 有效性 |
| `402` | 402 | (billing) | **余额/额度** | 上游 | 账号余额或免费额度耗尽，充值/换号 |

> 记忆口诀：**`11150`/`11101` = 代码可修；`11102` = 上游不认这个 id（**唯一可用于判定模型存在性的码**）；`11133` = 客户端序列化/上游格式（10router 多只能兜底）；`11134` = 上游暂时不服务（**认得 id，勿下架**）；`11128` = 服务端间歇风控（非 bug，单请求形态相关）；`11140` = 账号级风控（整渠道拦，等恢复/换号）；`6004`/`429` = 配额限流（等重置）。**

## 二、各错误码详解与修复

### 11101 — 非流式请求不支持（可修）

CodeBuddy 上游只接受流式（HTTP 400 code 11101）。10Router 的 `CodeBuddyExecutor.transformRequest` 强制 `stream=true`，非流式客户端由 10router 本地把 SSE 聚合回 JSON。

- 位置：`open-sse/executors/codebuddy-cn.js`
- 性质：稳定可复现，代码已处理。

### 11102 — 上游不认这个 id（唯一的存在性判据）

原文：`{"code":11102,"msg":"model [xxx] service info not found","requestId":"…"}`，HTTP **400**。

CodeBuddy 的两条渠道都是 **OpenAI 透传**——没有模型目录接口，但**未注册的 id 也能直接打过去**，上游只回这一句。所以：

- **探一个 id 在不在，用 11102 判定**：`{"model":"<候选>","messages":[{"role":"system",…},{"role":"user",…}],"max_tokens":16,"stream":true}`。回 `11102` = 不存在；回 200 = 存在。**必须配一个瞎编的对照 id**（如 `__control_bogus__`）确认判定器本身正常——否则一旦请求形态有问题，会把"全都不存在"的假象当成结论。
- **首条消息必须是 system**，否则全批请求会挂在 `11128`（文案是 "first message is not system prompt"，与本节的风控 11128 **完全是两码事**——见到这条先补 system 消息，别去查渠道风控）。
- **与 `11133` 分清**：`11102` = 上游压根没这个 id（目录问题）；`11133` = id 认识、但参数被拒（`model_param_invalid`，见该专节）。`glm-5.3-flashx` 在国际线就是每个请求都 11133——**存在，但用不了**，故只留在 CN 注册表。
- **别用它当"下线依据"**：国际版积分页按订阅档位过滤，免费档看不到新模型（Space-Bunny / Grok-4.7 / Gemini-3.8-Flash / GPT-6.1-Sol 全都不在页面上），但这些 id 在 API 上都回 200。**"某张表上没有"≠ 不存在**，要下架只能靠 11102。

### 11128 — unapproved channel 安全策略拦截（渠道级风控，勿乱改）

CodeBuddy 服务端**安全策略**对"来自未批准渠道形态"的请求做拦截（官方 displayMsg：请求被安全策略拦截）。排查要点：

- **渠道本身没坏**：同一账号、同一模型在原生 `openai→openai` 小请求下可全绿跑几百次。
- **触发常与单条请求形态相关**，曾命中：
  - `FMT: claude→openai`（Claude 客户端经 10router 翻译进 CodeBuddy）；成功批多为 `openai→openai`
  - **工具定义数多（如 54 个 vs 成功批 31）**——工具数越多越容易被安全启发式判为 agent 滥用
  - 超大上下文（500+ MSG）——**2026-09-17 实测补充**：单条真实大会话也会中：`1676 MSG · 54 TOOL · THINK:high`，请求体 **4.5MB**（含真实工具结果），单账号单发即 11128。
  - ⚠️ **2026-09-17 当日全量样本复核：体积不是判别条件**（修正上文早期结论）。同账号同日实测对照：

    | 请求体积 | 结果 |
    |---|---|
    | 5028KB | ❌ 11128 |
    | **113KB** | ✅ **200** |
    | 82KB | ❌ 11128 |
    | 61KB | ❌ 11128 |
    | **60KB** | ❌ 11128 |
    | 0KB（1 msg 探针） | ✅ 200 |

    **60KB 被拒、113KB 通过** —— 体积与拦截无因果，只是相关。真正判定依据是请求的**内容/形态特征**（具体字段组合尚未定位）。因此**不要**再按「体积超标」去解释或预测 11128；本地也无法据此做有效前置拦截。
  - 账号配额紧张（伴随 429 `6004` / modelLock）时更易触发
- **与账号/格式/模型是否被禁无关**（glm/hy/deepseek 在 54 工具下都曾命中；同两账号切 31 工具 deepseek 立即 200）。
- **无 10router 配置可解**（不是缺 header/key）；出路 = 开启新对话 / 等熔断窗口 / 降请求形态(收敛工具数、消息数)。
- ⚠️ **换渠道前先核对模型是否存在**：cbcn 独有的 `glm-5.3-flash`、`deepseek-v4-pro` 在 cbai 上不存在，切过去会报 **11102 model service info not found**。两边交集 11 个（`glm-5.3`、`deepseek-v4.1-flash`、`kimi-*`、`minimax-m3`、`hy4-preview` 等）。
- 记忆：`11128 = 渠道级风控，换新会话或等熔断`。
- 社区：workbuddy/codebuddy 反代项目（codebuddyapi-proxy、workbuddy2api）同样遇到，非本项目特有。

#### 2026-09-16 实测复核：这是**渠道**属性，且「逐账号重试」会放大它

生产实例（NAS）复测，判据如下：

| 实验 | 结果 |
|---|---|
| 同账号直连上游 `1MSG` / `31TOOL` / `54TOOL` / `1752MSG+54TOOL` | **全部 200** |
| 逐账号（4 个）复刻真实失败形态 `5MSG+54TOOL`（含 ZCode 身份 system prompt） | **四个账号全部 200** |
| 日志里 11128 的账号分布 | `1697(12) / 1698(10) / 余师洋(4) / 洋芋(5)` |
| 11128 的探测耗时 | 323–654ms（上游**快速拒绝**，非超时） |

**关键现场**：命中时日志形如

```
[22:39:01] ▶ POST cbcn/hy4-preview · 5 MSG · 54 TOOL · ACC:余师洋
[22:39:01] ✗ ERROR 400 · 475ms → 11128
[22:39:01] [FALLBACK] ⇄ ACC:余师洋 UNAVAILABLE (400) → NEXT ACCOUNT
[22:39:01] ▶ POST cbcn/hy4-preview · 5 MSG · 54 TOOL · ACC:1698
[22:39:02] ✗ ERROR 400 · 654ms → 11128
... 1697 → 洋芋 同样 11128（合计 <2s，随后 all 4 accounts locked）
```

**结论（修正早前"单请求形态"的判断）**：
- 单发请求（无论 ZCode / dsh / 1 MSG / 54 TOOL）**直连永远 200** → 不是账号坏、不是模型坏、**也不是 ZCode 入口特征**（ZCode 身份的 system prompt 直传亦 200）。
- 失败只在**同一秒内多账号连打同一个模型**时成片出现 → 是**出口/突发指纹**触发的渠道级策略，账号 fallback 的连发正是放大器。

#### 10router 的处置：渠道级熔断（v1.1.2 起）

- `open-sse/config/errorConfig.js`：两条 11128 规则带 `channelScope: true`；`checkFallbackError` 透出该标志。
- `markAccountUnavailable`：`channelScope` 错误**不加账号级 `modelLock`**（仅记 `lastError` 供仪表盘展示），返回 `channelScope: true`。
- `src/sse/handlers/chat.js`：收到 `channelScope` 立即**中止账号 fallback**，改设 provider 级熔断 `settings.channelBlocks[provider]`——**60s 起步，5 分钟内复发升级到 10 分钟**；熔断期间直接返回 503 + `Retry-After`，不再触达上游。**任一成功请求立即清除熔断**。
- **与「配额包到期优先」的交互**：熔断期间**跳过** SWR 配额刷新（渠道正被整体拒绝时多打一次上游只会拖慢恢复）；熔断真正生效过后，成功请求会 `invalidateQuotaCache(provider)`（见 `src/sse/services/auth.js`），让下一次选号重拉 `earliestPackageExpiry`——熔断窗口可能跨过配额包边界，earliest-expiry 排序不能用熔断前的旧数据。
- 效果：命中时对上游的调用从「4 次/秒 × 每 30s 重演」降为「1 次 / 60s」，且不再误锁四个账号（其余模型不受牵连）。

> 排障时**先看是不是成片命中**（同一秒多账号同模型）：若是，属渠道熔断范畴，别去翻单个账号；若单个账号独自持续 11128 而其它账号正常，才按账号维度排查。


### 11133 — 请求参数被拒（model_param_invalid）

CodeBuddy 对"请求参数不符合模型要求"的笼统表达（`extError.code` 多为 `400001`/`model_param_invalid`）。历次排查真正根因分两类：

1. **响应侧空 name（10router 可修）**：codebuddy 把一次工具调用拆成两条流式 tool_calls，后续 chunk 重复带 `function.name:""`。标准客户端用空 name 覆盖累积名 → `unknown tool ""` → 重发空名请求 → 11133。修复：`open-sse/utils/stream.js` PASSTHROUGH 分支删空 `name`(commit `48e39b44`)。
2. **请求侧序列化丢 name（10router 无法修复）**：客户端(如 **mirasim** 内 dsh)自己把 assistant tool_calls 的 name 序列化丢空，10router 的 `ensureToolCallIds` 只补 `id` 不改 name → 空名已到 codebuddy。workaround：换 **hy4-preview**（mirasim 对其序列化正常），或 10router 返回友好错误。
3. **多轮才触发**：单轮(15-17 MSG)正常，**多轮(54 MSG)** 后历史里出现 tool_calls/tool 响应不匹配才暴露。诊断手法：切**官方 DeepSeek** 复现拿清晰报错("assistant message with 'tool_calls' must be followed by tool messages…")定位真正根因。

### 11134 — 模型提供方暂时不可用（上游临时状态，勿当目录问题）

原文：`the model provider is temporarily unavailable, please retry later or switch [to another model]`，HTTP **500**。

**2026-09-11 在 CodeBuddy 国际版观测到**：`gpt-6-astra` 连续 3 次均返回该码，而同一 id 早前探测过 **200** —— 即同一模型在"可用 / 暂不可用"之间摆动，是上游侧的临时状态，与 10router 的目录、鉴权、请求形态均无关。

**判据（避免误删模型）**：目录级错误是 `11102`（`model service info not found`，**400**）—— 那是"上游不认这个 id"。`11134` 说明**上游认这个 id，只是暂时不服务它**。因此：

- **不要**因为一时调不通就把模型从注册表删掉（同 `11102` 与 `11134` 的区别就是判据）；
- 10router 侧按上游给的 reset 秒数做冷却/重试，或 fallback 到其它模型；
- 与 `gemini-3.5-flash` 的 `429 / code 14003` 同类：**账号或上游的临时状态不算目录错误**（见 `open-sse/providers/registry/codebuddy-intl.js` 头部注释第 (2)/(3) 条旁的相关说明）。

### 11140 — 账号级风控拦截整个渠道（intl 首报 2026-09-12）

HTTP **403**、code `11140`，原文：`{"code":11140,"msg":"request illegal","requestid":"…"}`。**账号粒度**拦截该渠道的整个对话接口——与 `11128`（单请求形态相关、可自愈）不同，`11140` 命中后**所有模型、所有请求形态持续 403**。

> ⚠️ 文案陷阱：`msg: "request illegal"` 字面上像"这条请求非法"，会诱导人去二分请求形态——**那是死路**。实测该账号下任意模型、任意形态持续 403，`request illegal` 实际表达的是"**这个账号的请求一律拒绝**"。看到 11140 直接按账号问题处理。

**首报案例（群友，intl/cbai）**：09-12 00:51 最后一次成功，07:59 首个 11140，08:42 仍 403。已系统排除本地原因：

| 假设 | 排除依据 |
|---|---|
| 账号/token 坏了 | ✗ 额度接口仍回 200 |
| 请求形状被拒 | ✗ 二分 12 种请求形态全 403 |
| 代理/出口被封 | ✗ 20171 与 socks5 出口均同 |
| 单个模型被禁 | ✗ 非单模型，全模型 403 |
| 代码 bug | ✗ 本地 v1.1.0 intl 通道复现一致 |

**结论与出路**：上游新增的账号级风控，本地无任何可改项——**等恢复或换号**。不要因此动目录（模型 id 本身没被判）。

**疑似触发因素（未实锤，仅记录）**：该账号在同一实例里用 **Google 和 GitHub 两个 OAuth 各连了一条连接**——同邮箱注册的两个 OAuth 实为**同一个 CodeBuddy 账号**（两条连接的 JWT `sub` 与 `refreshToken` 完全相同）。轮询/failover 在两条连接间交替打同一账号，疑似放大了风控信号。**单样本无法定因果**，但引出一个通用坑：

> ⚠️ **同邮箱双 OAuth = 同一账号，不构成冗余**。intl 支持经 Google / GitHub OAuth 登录，同一邮箱从两个入口授权会生成两条"看起来独立"的连接，但账号、额度池、风控状态完全同一份——多账号 failover 在这里会**静默失效**。判断方法：对比两条连接的 JWT `sub`（或 refreshToken）是否相同；相同即同账号，删一条并补真正的第二账号。

**与 `11128` 的判别**：`11128` 换个小请求形态立刻恢复（单请求启发式）；`11140` 换什么形态都 403（账号已被标记）。先做一次形态二分再定性。


### 11150 — DeepSeek 系不支持 reasoning_effort auto/off（可修，已提交）

CodeBuddy **DeepSeek 系列模型**(`deepseek-v4-*`)只支持 `low/medium/high/xhigh/max/none`，**不支持 `auto`/`off`**；GLM/Kimi 支持 `auto`。dsh 默认发 `THINK:auto` → 转发即 400 `11150`。

修复(commit `167f272f`，`open-sse/executors/codebuddy-cn.js`)：
- deepseek 系 + `auto` → 映射 `high`
- deepseek 系 + `off` → 删除字段(等同 none)
- 其它值/非 deepseek 逻辑不变

### 11151 — assistant 带 reasoning

CodeBuddy 对 assistant 消息里带 reasoning 内容的校验报错。性质为上游格式约束，规避请求形态。

### 6004 / 429 — 配额频率限制

账号某模型使用量超限返回 `6004`(HTTP 429)，带重置时间，到期自动恢复。属正常配额消耗，10router 多账号会自动 fallback 到下个账号。

## 三、模型寻址：UI 上的 id 不能抄进 `model`（2026-10-09 实测）

聊天界面右下角的模型胶囊显示的是形如 **`xt/ag/gemini-3.8-flash-high`** 的串。它**不是** `/v2/chat/completions` 的 model id——那是 agent 会话侧的内部 id。

CN 线上实测（2026-10-09，`codebuddy-cn` 在用账号），把前缀/后缀逐层拆开打：

| 探测的 model 值 | 结果 |
|---|---|
| `xt/ag/gemini-3.8-flash-high`（截图原样） | `11102` |
| `ag/gemini-3.8-flash-high`（去 `xt/`） | `11102` |
| `xt/ag/gemini-3.8-flash`（去 effort 后缀） | `11102` |
| `gemini-3.8-flash-high`（去整段前缀） | `11102` |
| `xt/ag/glm-5.3-high` / `xt/ag/glm-5.3` / `xt/chat/glm-5.3-high` / `xt/glm-5.3-high` | 全 `11102` |
| `xt/ag/glm-5.3-zzz`（非法档位，对照） | `11102` |
| `__control_bogus__`（对照） | `11102` |

全部与**瞎编的对照 id 同一判定**——即 OpenAI 透传网关根本不认这类带前缀/后缀的写法。

**结论**：`model` 字段只能填注册表里那条裸 id（`glm-5.3`、`kimi-k3`、`space-bunny` …）。思考档位一律走 **`reasoning_effort`** 请求字段，不要编码进 model id。

> 截图里那个具体的 `gemini-3.8-flash-high` 还有第二层问题：`gemini-3.8-flash` 在 CN **压根不存在**（裸 id 也是 `11102`），它是国际版独有的模型线。看到它出现在"国内"的截图里，说明那一屏的会话不是 CN 侧——**积分页是两边共用的**（一套积分系统），所以积分页上摆着 CN 的模型表，并不能证明当前会话在哪一侧。

### 思考档位走 `reasoning_effort`，且校验只在 DeepSeek 系

| model | `reasoning_effort` | 结果 |
|---|---|---|
| `glm-5.3` | `high` / `low` / `auto` / `none` / `max` / **乱填 `zzz`** / 整字段缺省 | **全部 200** |
| `deepseek-v4.1-flash` | `auto` / `off` | `11150` |

两点值得记住：

1. **GLM 系不校验档位**——把档位名拼错（如 `hign`）不会报错，会被静默当成某个默认档跑完。排查"思考强度没按预期生效"时，GLM 上的第一嫌疑是**上游忽略了该值**，而不是值本身错了。
2. **`11150` 是 DeepSeek 系的专属约束**，GLM / Kimi 不会触发。修复逻辑见 `11150` 专节与 `CodeBuddy-reasoning-effort-fix.md`。

## 四、排查方法论（跨错误码可复用）

1. **先分错误码**：看 10router.log 具体 code——`11150`/`11101` 可修，`11133` 多客户端/上游，`11128` 渠道级风控（成片命中看熔断），`11140` 账号级风控，`11134` 上游临时不服务，`6004` 等重置。别一看到 400/11128 就改连接。
2. **同模型失败 vs 成功抽差异**：`FMT / MSG / TOOL / THINK / ACC` 五个字段对比，差异项即可疑触发点。
3. **渠道是否死**：此刻渠道能否服务其它模型(如 deepseek-v4-flash 连续 200) → 账号/渠道没死，是单模型/单请求被拦。
4. **请求侧 vs 响应侧二分**：`DEBUG_RAW_REQ`(chat.js 入口) vs `DEBUG_CB_REQ`(transformRequest 后) 对比，一次定位。用后必须清理(移除 env + 临时代码，重新 `npm run build`)。
5. **含糊错误切 provider B 复现**：A 报 11133(param 空)时，切官方 DeepSeek 拿清晰报错定位真正根因。
6. **注明发起客户端**：不同客户端(NAS 直连 dsh / mirasim 内 dsh / codex / Claude Code)路径不同、根因可能不同，先问清/注明。
7. **核对连接是不是真多账号**（intl 尤其重要）：Google/GitHub OAuth 同邮箱 = 同一 CodeBuddy 账号（JWT `sub`/`refreshToken` 相同）——"两条连接"不构成冗余，failover/轮询都在打同一个账号与风控状态。见 `11140` 专节。

## 五、相关文档

| 主题 | 文档 |
|------|------|
| 模型寻址 / UI id 不可用 / 思考档校验 | 本文三专节 |
| 11150 reasoning_effort | `CodeBuddy-reasoning-effort-fix.md` (en/zh-CN) |
| 11128 渠道级风控 + 熔断 | 本文 11128 专节；历史案例 skill: `llm-api-channel-health/references/10router-codebuddy-11128-unapproved-channel.md` |
| 11133 流式空 name(响应侧) | skill: `10router-dev/references/codebuddy-streaming-toolcall-empty-name.md` |
| 11133 模型特定(hy4 vs deepseek) | skill: `10router-dev/references/codebuddy-toolcall-model-specific.md` |
| 11133 请求侧 vs 响应侧 | skill: `10router-dev/references/codebuddy-toolcall-request-vs-response.md` |
| 11133 多轮 + 官方DS诊断 | skill: `10router-dev/references/codebuddy-toolcall-official-ds-multiturn.md` |
| 11128 实测 + onboardUser 归属 | skill: `10router-dev/references/codebuddy-intermittent-11128.md` |
