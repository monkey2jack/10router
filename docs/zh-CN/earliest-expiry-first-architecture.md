# 跨账号「到期优先调度 (Earliest Expiry First)」与「环形单向闭环接力 (Relay)」架构

> 本文档面向项目维护者与协同开发者，详细阐述多账号「到期优先」调度策略的业务背景、架构决策考量、SWR（Stale-While-Revalidate）轻量缓存设计、单点接力选号算法以及容错兜底机制。
>
> 同一开关覆盖两类额度的调度：**配额包**（固定截止的赠送包）、**订阅速率窗口**（周期循环的 5h/7d/weekly 双桶）与**余额**（无分母的储值 Credits）。文案自 v1.4.1 起由「配额包到期优先」更名为「到期优先调度」。

---

## 一、 业务背景与痛点

在支持多账号配置的 AI 网关体系下（如 CodeBuddy、Command Code、Kimi、Claude 等），用户往往会绑定多个主号、副号或活动赠送账号：
- **痛点**：传统的优先级（Priority / Fill-First）策略通常从首个账号开始消耗，直到其额度彻底耗尽才会切换到下一个账号。
- **后果**：如果副账号领取了平台限时赠送的促销包/活动额度（例如 3 天或 7 天到期），主账号的常规月度包可能还有一个月才到期。在传统调度下，用户会一直消耗主账号，导致副账号中的短期赠送包**白白过期浪费**。
- **目标**：在不牺牲任何聊天性能的前提下，跨账号感知所有尚未耗尽的配额包，自动将**离当前时间最近、最快即将到期**的账号排在首位优先消耗。

---

## 二、 架构决策权衡：为什么不能在聊天请求时实时查配额？

当首次考虑该功能时，一个常见的**直觉设计**是：
> *“在客户端发起 `/v1/chat/completions` 请求时，网关先调用上游平台的配额/账单 API，拿到各个账号的最新到期时间，当场排序并选中账号。”*

**该方案在工程上是不可接受的**，原因如下：

### 1. 首字延迟（TTFT）雪崩
- 商业 LLM 厂商的推理接口（Inference API）通常经过高度优化，首字流式输出时间（TTFT）在 150ms ~ 400ms 左右。
- 但厂商的**用量/账单接口（Billing / Credits API）**属于边缘管理服务，未经推理专线加速，单次 HTTP 请求延迟通常在 **300ms ~ 1500ms**，跨国或冷启动时甚至可达 3 秒。
- 若在聊天主路径上同步查询，即使多账号并发，也必须等待最慢的请求返回。用户的每次对话都将被平白增加数倍延迟，代码补全与流式打字体验直接破坏。

### 2. 触发上游风控与限流封号（Rate Limit / 429）
- 代码补全（如 Copilot / Continue / Cline）每分钟可能触发几十次请求。
- 上游账单接口的设计初衷是供网页前端控制台偶尔刷新查看，**频率限制（Rate Limit）极其严苛**（往往限制每分钟几次）。
- 若在每次代码补全或聊天时现场打账单接口，账号会瞬间被上游返回 `429 Too Many Requests`，严重者会被上游 WAF 或安全策略判定为脚本恶意爬虫而封禁 API Key / Cookie。

### 3. 可用性倒挂（Dependency Inversion Risk）
- 推理服务往往具备 99.9% 以上的高可用性，而计费查询服务相对脆弱，网络抖动或维护升级时常发生超时（504 Gateway Timeout）。
- 实时依赖会导致：**核心推理接口明明健康可用，却因为旁路计费接口偶发超时导致网关彻底无法响应用户请求**。

---

## 三、 核心解法：轻量本地缓存 + SWR（Stale-While-Revalidate）机制

为了兼顾「按最快到期时间精准调度」与「聊天主链路 0 延迟、0 外部依赖」，10Router 采用了现代高性能网关标准的 **SWR 架构**。

```
                              【客户端发送聊天请求】
                                        │
                                        ▼ (0ms 纯本地耗时)
                     ┌──────────────────────────────────────┐
                     │   读取 SQLite 连接元数据时间戳        │
                     │   (earliestPackageExpiry 毫秒级比对) │
                     └──────────────────┬───────────────────┘
                                        │
                 ┌──────────────────────┴──────────────────────┐
                 ▼ (立即放行，0 延迟)                            ▼ (旁路异步，完全不阻塞请求)
    【立即发送 Chat 请求给 LLM 上游】                  【检查缓存是否陈旧？(>15分钟)】
                 │                                             │
                 ▼                                             ▼ (若已过期且无在途拉取)
           流式返回客户端                            【后台非阻塞发起 1 次配额查询】
                                                               │
                                                               ▼
                                                    更新本地 SQLite 字段
                                                    (后续聊天请求立即可用)
```

### 1. 数据模型持久化（`src/lib/db/repos/connectionsRepo.js`）
每个账号连接在数据库中维护四个轻量字段，由统一的 SQLite 适配层存储：
- `earliestPackageExpiry`（ISO 8601 字符串）：该账号下最早即将到期的**有效**配额包/订阅窗口的到期时间戳（已耗尽的一次性包不参与，见第四节）。
- `earliestPackageName`（字符串）：该额度行的名称（如 `"Bonus Pack 1"`、`"M2.7 · 5 hours"`），用于前端界面悬浮提示。
- `earliestPackageRemaining`（数字，0–100）：该账号**最有约束的存活桶**的实时剩余百分比（relay 红区信号，见第五节）。余额类（无分母）与未知为 `null`——接力对 `null` 永不预判切换。
- `quotaCheckedAt`（ISO 8601 字符串）：上一次成功拉取并刷新该账号配额的时间戳。

### 2. 关键路径（Critical Path）：纯本地毫秒比对
在 `src/sse/services/auth.js` 的 `getProviderCredentials` 中：
- 调度器直接在内存中比较候选账号的 `earliestPackageExpiry` 时间戳；
- 比对算法为纯本地算术运算（`<0.1ms`），对请求处理耗时贡献为零；
- 排序规则：
  1. 拥有未来未到期时间戳的账号按到期时间**升序排列**（越早到期的排在越前面）；
  2. 到期时间相同或未包含到期时间的账号，回退到用户配置的固定优先级（Priority）；
  3. 已完全过期的账号自动视为无限大（降至队尾）。

### 3. 数据来源的三重保障（如何获取并保持最新？）
1. **控制台用量查看（自然填充）**：
   - 当用户在仪表盘打开 `/dashboard/usage` 查看配额时，系统在解析用量的同时，自动提取并写入最新到期时间。
2. **连接健康测试（被动更新）**：
   - 用户在供应商管理页点击「测试」单个连接或「批量测试」时，测试成功后自动在后台触发一次非阻塞配额更新（见 `testUtils.js`）。
3. **旁路按需刷新（Stale-While-Revalidate，最核心保障）**：
   - 在用户日常持续聊天的场景中，调度器会检查 `quotaCheckedAt`。
   - 若距离上次拉取时间已超过 **15 分钟**（`STALE_MS`），且该连接当前没有并发拉取任务，则自动派发异步更新任务。
   - **重点**：当前聊天的 Promise 立即返回并放行，绝不等待该异步任务；当后台异步拉取成功后，静默落库，下一次聊天即可感知最新数据。

### 4. 并发保护与防刷机制（In-Flight Deduplication）
在 `auth.js` 中维护全局集合 `_quotaRefreshInFlight = new Set()`：
- 即使客户端高频并发发送数十个聊天请求，对同一个账号也至多只有一个后台配额刷新在执行；
- 后台任务完成或异常后在 `finally` 块中释放锁，彻底杜绝高频请求打爆上游账单接口。

---

## 四、 配额到期提取算法（`open-sse/services/usage/expiryExtractor.js`）

不同厂商返回的配额数据结构各异（包含汇总行、永久额度、周期循环包、活动赠送包、逐包明细 `packs[]` 等）。`extractEarliestPackageExpiry(usage)` 同时产出两个信号：**倒计时徽章**（最早到期时间）与**接力红区**（最有约束的实时剩余百分比）。算法规范：

1. **跳过汇总项**：识别并跳过 `"Total Points"`、`"Summary"` 等总额汇总字段。
2. **明细替代聚合（Qoder 教训）**：桶带 `packs[]` 逐包明细时（Qoder 的 `addOn`），**只按存活包排序**，绝不读桶级 `resetAt`——生产端的桶级时间戳按「含已耗尽包」的最早包推导，读它会让一个 `0/100` 的死包继续劫持账号排序（幽灵倒计时 bug）。包的到期字段兼容 `expiresAt` / `resetAt` 两种命名。
3. **过滤已耗尽的一次性包**：
   - 检查 `used >= total` 或 `remaining <= 0` 或 `remainingPercentage <= 0`。
   - **关键原则**：如果一个包虽然明天就到期，但里面**额度已经被扣光了**，绝不能再优先调度它，必须跳过并继续寻找下一个未耗尽的包。
   - **例外——周期循环窗口**（`recurring:true`，CodeBuddy 回填包 / MiMo weekly / MiniMax Code M Plan / Antigravity 5h+7d）：耗尽≠死亡，其**重置时间正是徽章要说的信息**，耗尽的周期窗口照常参与排序。
4. **重置日期已过的行完全出局**：有日期但不是未来（一次性包已过期 / 周期窗口回填中上游还没翻表）——倒计时与红区两个信号都不供出，避免拿陈旧 `remaining` 触发误切。
5. **无日期行只供红区**：永久额度（MiniMax Code 的 Credits 余额、未逐项化的余量包）没有倒计时可言，但「还剩多少」对接力有价值——参与 `remainingPercentage` 的最小值追踪，不产生徽章。
6. **储值余额不冒充百分比**：带 `isCreditBalance:true` 的行没有分母（1330 积分既不是 1330% 也不是 4%），红区信号直接返回 `null`；余额耗尽（`remaining <= 0`）仍会被规则 3 过滤出环。
7. **寻找极小值**：在满足条件的包中，选取时间戳最小（最快到期）的那一个，返回其名称与 ISO 时间戳；同时返回全程最小的存活剩余。

---

## 五、 环形单向闭环接力（Relay）——同一开关下的多账号订阅形态

### 1. 为什么「按到期时间重排」对周期双桶是错的

Antigravity / MiniMax Code 这类**周期循环额度**（5h 短窗 + 7d 水库）没有"到期作废"概念，只有"何时回填"。若沿用「每次请求按最早到期重排、队首优先」：扛旗号的 5h 窗一回填，它立刻跳回队首接管流量——池子在**自己的重排逻辑上打转**，每个号的短桶被同一节奏轮流抽干，最后**整条通道同时黑屏**；接力设计里"把一个桶压到见底"的扛旗者永远不存在。

### 2. 三条铁律（纯函数 `open-sse/services/relaySelection.js`）

| 规则 | 内容 | 动机 |
| :--- | :--- | :--- |
| **① 单点死磕** | 一个账号扛 100% 流量直到真正枯竭，绝不摊薄 | 摊薄 = 全池短桶同抽同干 = 集体黑屏 |
| **② 只前滚、不插队** | 固定环序（priority 升序）1→2→3→4→1；越过红区才步进**下一号**；已回血的前序号账号即使 100% 也原地待命，直到环转回来 | 中途切回 = 抖动，设计明令禁止 |
| **③ 激进预判** | 切换由**实时剩余跌破 5% 红区**触发（`earliestPackageRemaining` < `RELAY_RED_ZONE_PCT`），不等上游 429——客户端全程无感 | 429 换号至少烧掉一次请求的 TTFT |

### 3. 状态设计：扛旗指针不新增存储

carrier 从 `lastUsedAt` 派生（最近被使用的环内账号即现任扛旗者），与轮询共享同一字段：
- 选号**无状态**——重启存活、无新列、无迁移；
- relay 命中时在 `auth.js` 里 await 落一次 `lastUsedAt`，保证下一请求认得出"谁在扛旗"；
- 环序 = 既有的到期时间排序（一次性赠送包场景下 relay 自然退化为"压干队首再步进"，与旧行为同向且不回切）；
- `remaining` 未知（首刷前 / 无百分比额度供应商）视为健康——**绝不在缺数据时预判切换**，交给上游 429/锁处理；
- 全环皆红：回落环首让常规 429/lock 路径接管，不返回 null 饿死请求。

### 4. 与既有策略轴的优先级

`earliestExpiryFirst` 开启且环内 ≥2 号时，relay **接管选号**（优先于 `fallbackStrategy:"round-robin"`——轮询正是规则①禁止的摊薄）；显式 pin（`preferredConnectionId`）仍然短路一切策略。关闭开关则完全走原有 fill-first / round-robin 路径，行为零变化。

### 5. 信号链路

```
usage handler（recurring / isCreditBalance 旗标）
   └─► extractEarliestPackageExpiry ─► { expiry, name, remainingPercentage }
         ├─► auth.js 后台 SWR 刷新（15min）       ─┐
         ├─► /api/usage/[connectionId] 仪表盘刷新  ├─► earliestPackage{Expiry,Name,Remaining}
         └─► 连接测试 testUtils 成功后的后台刷新   ─┘        （SQLite 连接行）
                                                               │
每个聊天请求 getProviderCredentials ◄──────────────────────────┘
   └─► 到期排序成环 ─► selectRelayCarrier(环) ─► 扛旗号 + lastUsedAt 落戳
```

> 供应商 usage handler 的责任：周期窗口必须打 `recurring:true`（MiniMax Code 的 M Plan interval/weekly 自 v1.4.1 起已标注），储值余额必须打 `isCreditBalance:true`——两个旗标决定它进倒计时还是进红区，还是都不进。

---

## 六、 极端情况与容错兜底矩阵

| 场景 | 网关表现 | 对用户的影响 |
| :--- | :--- | :--- |
| **缓存显示有额度，但在 15 分钟窗口内刚好耗尽** | 调度器将请求派发给该账号，上游返回 `429` 或 `insufficient_quota`。10Router 既有的 Multi-Account Fallback 捕获错误，**在当前请求内瞬间自动切换到下一个可用账号并重试**。 | **用户无感知，请求依然成功返回**。 |
| **上游账单接口宕机或返回 504** | 后台 SWR 异步任务静默捕获异常并吞掉，不影响正在进行的聊天；连接保留上次已知的时间戳继续工作。 | **零影响，不阻断正常聊天**。 |
| **新绑定的账号尚未拉取过配额** | 该账号的 `earliestPackageExpiry` 为 `null`，排序时回退到默认优先级，并触发后台初次刷新。 | **平滑过渡，首个请求正常放行**。 |
| **所有账号的配额包均已过期或无到期时间** | 自动回退到常规的 `Priority` 顺序或 `Round Robin` 轮询模式。 | **完全兼容传统调度行为**。 |
| **接力全环皆红（`earliestPackageRemaining` 全部 < 5%）** | `selectRelayCarrier` 回落环首，交由常规 429/lock 路径接管，绝不返回 null 饿死请求。 | **请求仍走既有换号/冷却，不会因选号返回空而 500**。 |
| **周期窗口回填中（`resetAt` 已过但上游未翻表）** | 该行两个信号都不供出（第四节规则 4），下一次 SWR 刷新纠正。 | **不会拿陈旧剩余误切，也不会显示负倒计时**。 |

---

## 七、 界面与配置项参考

- **配置存储位置**：`settings.providerStrategies[providerId].earliestExpiryFirst: boolean`（同一开关驱动到期排序 + 接力选号，无独立 relay 开关）。
- **界面入口**：
  - 供应商详情页：`/dashboard/providers/[id]` 右上角「到期优先调度」独立切换开关（v1.4.1 起由「配额包到期优先」更名，覆盖配额包 / 订阅窗口 / 余额三类额度）；
  - 媒体供应商卡片：`ConnectionsCard.js` 右上角提供相同开关；
  - 连接卡片列表：账号行渲染带有 `schedule` 图标的倒计时徽章（如 `5h`、`3d`），悬浮提示对应额度行名（`earliestPackageName`）与绝对时间戳。

---

## 八、 关联代码与测试索引

- 到期提取算法：`open-sse/services/usage/expiryExtractor.js`
- 接力选号纯函数：`open-sse/services/relaySelection.js`
- 调度策略与后台刷新：`src/sse/services/auth.js`
- 数据持久化字段：`src/lib/db/repos/connectionsRepo.js`（`earliestPackageRemaining` 在 `OPTIONAL_FIELDS`）
- 界面组件与徽章：
  - `src/app/(dashboard)/dashboard/providers/[id]/page.js`
  - `src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js`
  - `src/app/(dashboard)/dashboard/providers/components/ConnectionsCard.js`
- 单元测试：
  - `tests/unit/earliest-expiry-first.test.js`（提取算法，含 Qoder 幽灵倒计时回归、余额/周期窗口边界）
  - `tests/unit/relay-carrier-selection.test.js`（接力三律纯函数：单点/前滚/红区阈值/未知降级）
  - `tests/unit/relay-auth-wiring.test.js`（`getProviderCredentials` 集成：环序、扛旗持久化、开关关闭零变化、pin 短路）

### 与渠道级熔断的交互（v1.1.2 起）

渠道级熔断（如 CodeBuddy `11128`「unapproved channel」）会暂停整个 provider，与本策略有两处交叉，均已处理：

1. **熔断期间跳过 SWR 配额刷新**：`getProviderCredentials` 里判 `settings.channelBlocks[providerId]` 未过期即不派发刷新任务。理由：渠道正被整体拒绝时，多打一次上游（哪怕是 billing 端点）只会拖慢恢复，读回的到期时间也不可用。熔断由任一成功请求清除，届时刷新自动恢复（无需额外调度）。
2. **熔断生效过后失效配额缓存**：`chat.js` 的成功回调里，若清除前确实存在 block，则调用 `invalidateQuotaCache(provider)` 把该 provider 全部连接的 `quotaCheckedAt` 置空，让下一次选号重新拉取。理由：熔断窗口可能跨过配额包边界，而 SWR 的 15 分钟窗口未必覆盖到，earliest-expiry 排序不能拿熔断前的旧数据排。

> 注意该交叉**只在多账号（`availableConnections.length > 1`）且开启本策略时**才涉及——单账号场景本就不跑后台刷新。
