# 全量审查报告（v1.1.3 → v1.2.0，2026-09-22 初稿 / 2026-09-23 归档定稿）

> **审读范围**：`v1.1.3`（`4141f038`，2026-09-20 发布）→ `aece53d6`（2026-09-23），**共 91 次提交**（347 文件，+17873 / −1865 行）。初稿写于 `a2d3c997`（74 提交窗口），此后又并入 17 提交（六条高危的修复、MiMo 三卡收敛、UltraSpeed、配额页 UI、Qoder 逐个测试、fnOS 密码、ACL、tooling）。
> **审读方法**：五路并行子代理按领域通读 diff + 对 HEAD 代码核对关键路径 + 全量 vitest 套件与 `known-fails` 基线门禁 + 三注册表基线（providers / alias / oauth-urls）byte-for-byte 复核 + `audit-capabilities --check` + 改动文件 ESLint 计数对比。六条高危项均由主代理二次读码复验属实；**修复阶段每一处都做了反向验证**（把修复改回错误写法，确认新增用例真的会红）。
> **版本决策**：本批更新量（91 提交 / 347 文件 / +17.9k）远超一个 patch 的体量，且含两处 breaking（i18n 品牌重命名、MiMo Desktop 按 provider 判定），**应发 minor（v1.2.0）而非 v1.1.4**。v1.2.0 号此前被单方面发布又撤回（`c714f2a8`），npm / tag / Release 均未落地，**无消费者见过该号，号是干净可用的**。
> **归档说明**：本报告在发版**之前**归档。其原因写在 §零：代码侧已全部处置，但发布元数据尚未动，且发版动作需维护者明确指令。

---

## 零、相对初稿的变化（先看这里）

初稿的结论是「代码可发，但有 6 处高危需修」。**这 6 处及全部中危、低危代码项现已处置完毕**，验证方式与结果见各节标记。改动摘要：

| 处置 | 内容 |
|---|---|
| 六条高危 | 全部修复 + 逐条新增回归用例（详见 §一，每条都标了修复提交） |
| 中危（8 项） | 7 项修复：备份错钥、migration 005、Anthropic 形态、重试 drain、fnOS 密码、`/api/version` 非阻塞、Windows ACL、登录页端口、用量分组；**1 项未做**：启动器杀进程身份核对（§九.1） |
| 低危 | 部分修复（能力表 / 文档漂移 / 会话绝对上限 / health 脱敏 / manifest / 常量归位）；**3 项未做且已如实记录**：首启 `wx`、`settings/database` cli-token 空判、`n>1`（后者为刻意取舍，非缺陷）—— 见 §三 |
| 新增发现 | 修复过程中又发现并修掉 4 个初稿未列的缺陷（见 §一.7） |
| 发布元数据 | **一概未动**（§七）。bump / tag / Release 须维护者明确指令 |

**测试总数：3381 → 3458**（+77，全部为新增用例，0 新增回归）。

---

## 一、发版前必修（高危，初稿 6 条 —— 均已修复）

### 1. [严重] 错钥启动会永久销毁凭据密文（数据丢失）→ 已修 `5a1ae484`

- **原缺陷**：`src/lib/db/crypto/credentialCipher.js` 解密失败时 `delete out[field]`，密文从对象里消失，只在返回值挂 `error`；而 `connectionsRepo.rowToConn 直接采用该结果，启动期 `cleanupProviderConnections` 与任何 `updateProviderConnection` 都会把这份**无密文对象**回写 `upsert`。
- **场景**：把 `data.sqlite` 恢复到未带 `credential-key` 的新机器，启动一次服务 → 所有 token / apiKey 密文被抹掉；之后补上正确密钥也救不回。
- **修法（已落地）**：`decryptConnectionData` 返回 `{ data, error, unreadable }`；不可解密的值仍从 `data` 移除（避免密文被当 Bearer 发上游），但经 `unreadable` 随对象传递，由 `restoreUnreadableCredentials` 在写回时折叠回 `data` 列（`encryptSecret` 对 `enc:v1:` 幂等）。载体键在两个 provider 序列化器里剥除，不进 API 响应。合成的 `testStatus/lastError` 不再进 upsert。
- **验证**：凭据套件 24 例（含「错钥 → 写回 → 换回正确密钥 → 凭据仍在」全链路）。

### 2. [严重] README 的 headless 示例会让网关启动后立刻自杀 → 已修 `6f7dbaef`

- **原缺陷**：`cli/cli.js` 仅在 `skipUpdate && !isTTY` 才进 tray 模式；`input.js` 的 `selectMenu` 在非 TTY stdin 上 `resolve(-1)`，被 `cli.js` 当成「用户选择退出」→ `cleanup()` 杀掉刚起的 server，`process.exit(0)`（退出码 0 使 `Restart=on-failure` 不拉起）。
- **修法（已落地）**：`--no-tray` 或非 TTY 一律隐含 headless（去掉 `skipUpdate` 前置条件）。
- **验证**：`cli-no-tray-sighup.test.js` 增 source-guard；**注意**：真实非 TTY 启动验证仍未做（见 §九）。

### 3. [严重] `sfcn` 别名被 StepFun CN 劫持 → 已修 `e3072b6f`

- **原缺陷**：`stepfun-cn.js` 与 `siliconflow-cn.js` 同时声明 `sfcn`，注册表顺序后者覆盖 → `sfcn/<model>` 打到 `api.stepfun.com`；而 `alias-baseline.json` 已被重录成这个错误映射，**基线是绿的**。
- **修法（已落地）**：`stepfun-cn` 删除 `sfcn`（保留 `sf-cn`），重录基线仅改一行；**新增 `provider-alias-uniqueness.test.js`** 做全局唯一性检查（别名不得双属、不得撞 provider id）。
- **验证**：实测 `parseModel` / `resolveProviderAlias` 双向归 `siliconflow-cn`；唯一性测试对修复前的注册表会红。

### 4. [严重] MiMo Desktop 卡的「测试连接」永远返回「不支持」→ 已修 `4b880580`

- **原缺陷**：`testUtils.js` 的 `switch(connection.provider)` 只有 `xiaomi-mimo` / `xiaomi-tokenplan`；`isSessionConnection` 硬编码 `provider === "xiaomi-mimo"`；分派器同样只放行该 id → Desktop 卡落到 `default`，`testStatus` 被写成 `error`。
- **修法（已落地）**：增 `case "mimo-desktop"`，`isSessionConnection` 与分派器同步放行；探测模型支持前端选择（默认「提供商默认」）。顺带修同路径两个真 bug：路由无条件 `request.json()` 使空 body POST 返回 500；后台过期刷新传入未定义的 `proxyOptions`，ReferenceError 被空 catch 吞掉（该刷新一直没跑）。
- **验证**：`mimo-desktop-connection-test.test.js` 3 例（行为级 + oauth 变体 + source）。

### 5. [严重] stop 守卫补发行与终止帧合并成一个 SSE event → 已修 `f962b0a9`

- **原缺陷**：`emitHoldover` 只 push 一行 `data:` 且无空行，紧随的终止帧 / `[DONE]` 并入同一 event，官方 SDK `JSON.parse` 必失败。触发条件仅是「最后一段文本以某个 stop 的真前缀结尾」，**与上游是否合规无关**，影响所有直通流。
- **修法（已落地）**：补发完整 event（含空行终止）；Anthropic 形态补齐 `event:` 行与**正确的 content-block index**（原写死 0，而 thinking 块占 0）；命中后**整块丢弃**非 text 的 `content_block_*`（原只清空 payload，客户端会见到 `input:{}` 的 tool_use 并可能空参执行）。
- **验证**：`stop-sequence-guard.test.js` 27 例，含按空行严格拆事件的帧边界用例与 Anthropic 多 block 用例。

### 6. [严重] combo 空回复回退把「纯工具调用」判为空 → 已修 `f962b0a9`

- **原缺陷**：Responses 侧不认 `function_call`，Gemini 侧不认 `functionCall` → 模型一决定调工具就被判「无内容」，放弃并**重新计费全部输入**（最多烧掉两个模型）。
- **修法（已落地）**：三种形态都计入 valuable，并补 `delta.reasoning`（OpenRouter / xAI 拼写）；修 `reason_summary` 拼写；判 retry 后改为 **drain 而非 `reader.cancel()`**（cancel 使 flush 不执行，该次 usage 不入库且被记成「客户端断开」，与提交说明相反）。
- **验证**：`combo-retry-on-empty.test.js` 43 例，含 drain-not-cancel 用例。

### 7. 高危范围外、修复中发现的 4 个缺陷（初稿未列）

| 缺陷 | 位置 | 影响 |
|---|---|---|
| 逐个测试全部 500 | `api/providers/[id]/test/route.js` | 无 body 的 POST 因 `request.json()` 抛错，任何连接都测不了 |
| 后台过期刷新从未执行 | `testUtils.js` | 未定义的 `proxyOptions` → ReferenceError 被空 `catch {}` 吞掉 |
| 配额页计数撒谎 | `ProviderLimits/index.js` | 客户端过滤后仍报后端分页数（"显示中 1-10 of 46" 压在被筛过的网格上） |
| 同一 tick 连点丢写 | `ProviderLimits/index.js` | 同一卡内多个按钮同一 tick 触发时，都按点击前的同一份快照计算，最后一次覆盖其余（点 5 个标签只恢复 2 个） |

后两条属渲染层缺陷，**读源码与单测都发现不了**（连点那条顺序点击能过、必须同 tick 突发才暴露）。为此新增了 §六 所述的 CDP 浏览器探针工具。

---

## 二、中危（初稿 8 项 —— 全部已修）

| 项 | 修法 | 提交 |
|---|---|---|
| 备份导出错钥静默丢凭据 | `exportDb` 保留密文（幂等穿过 import）+ 返回 `credentialErrors`；**前端下载时据此告警** | `5a1ae484` / `aece53d6` |
| v1.1.3 老卡 Desktop session 变死连接 | 新增 **migration 005** 把 session-only 云卡行移到 `mimo-desktop`（该卡已拥有同账号会话时删除） | `7ac6f1f5` |
| stop 守卫 Anthropic 形态两处 | 见 §一.5（index / `event:` 行 / tool_use 整块丢弃） | `f962b0a9` |
| 重试漏 `delta.reasoning` + cancel 丢 usage | 见 §一.6 | `f962b0a9` |
| fnOS 升级锁死密码 | `main` / `install_callback` / `upgrade_callback` 三脚本统一改 `${DATA_DIR}/initial-password`（0600，跨升级保留） | `253569bd` |
| 启动器无差别杀进程 | **未做**（见 §九） | — |
| `/api/version` 阻塞 npm + 更新器 null 日志 | GET 改非阻塞（后台刷新，冷缓存不再等 4s，doctor / staleServer 的 2s 探测不再误判 RED）；null 时如实记「无法验证」 | `d59a4475` |
| Windows 未收紧 `credential-key` / `jwt-secret` ACL | 抽 `src/lib/fsPermissions.js` 的 `hardenOwnerOnly()`（POSIX chmod / Win icacls），三处密钥文件共用 | `5a1ae484` |
| 登录页写死 `127.0.0.1:20128` | 改为从地址栏推导 origin（预渲染前用文档默认值）；URL 拆为独立元素以保住该句的 i18n 精确匹配 | `aece53d6` |
| 用量按掩码分组并桶 | 实时路径分组键改用 `apiKeyHash`（sha256），与日聚合一致；AUDIT-002 断言同步改指摘要 | `7f511356` |

---

## 三、低危与约定偏差（初稿清单的现况）

**已修**：
- `mimo-v2.6-pro-claude` 能力表落入 `*claude*` 通配 → 已显式加条目（1M/128K），`audit-capabilities --check` 通过。
- `docs/zh-CN/ARCHITECTURE.md` 的 `x-9r-real-ip` → `x-10r-*`（`x-9r-cli-token` 代码里仍是该值，准确，未动）。
- 滑动会话无绝对上限 → 见 §四.
- `/api/health` 公开返回含绝对路径的 `lastDriverError` → 新增 `redactDriverError`（保留 doctor 判定所需的驱动名与是否有错，抹掉路径）。
- `fnos-packaging/manifest` 的 `maintainer = decolua` → 改 `techysy`。
- `MAX_ENFORCED_STOP_LENGTH` 放 `utils/` → 移入 `config/runtimeConfig.js`（符合 open-sse 的 config 集中约定），guard 里 re-export 兼容。
- 备份导出错钥静默丢凭据的前端提示 → 见 §二.

**仍开（初稿列为低危，本版未做，均为有意判断）**：
- **首启密钥文件无 `wx` 竞态**（`credentialCipher.js` / `dashboardSession.js` 仍是 `writeFileSync(file, generated, { mode: 0o600 })`）：双实例同 `DATA_DIR` 首启时后写覆盖先写，先写者加密的行重启后不可读（会喂给 §一.1 那条路径，但 §一.1 已修，故后果降级为「该实例的密钥被换掉」而非「密文被销毁」）。**未做原因**：双实例同 `DATA_DIR` 本身是不被支持的配置（启动器有单实例锁），修复窗口极窄；留作已知项。
- **`/api/settings/database` 的 `x-9r-cli-token` 只判非空、不比对**（`route.js:10-12` `isCliRequest` 只 `Boolean(header)`）：持有效 JWT 者加任意该 header 即跳过密码重验，可拿到明文凭据导出。**未做原因**：该路由本身在 `ALWAYS_PROTECTED` 之后（需先有过鉴权的会话），且`/api/*` 默认拒绝；但严格说这是一处「二次验证可被空 header 绕过」，**建议下版收紧为复用 guard 的 `hasValidCliToken`**——本版未做是遗漏，不是判断。
- **`n>1` 时守卫把各 choice 文本并进 choice 0**：`stopSequenceGuard.js:199-211` 仍把首个含文本的 choice 赋新值、其余清空。**这是刻意的、已在代码注释里写明**（"multi-choice responses are rare"），非缺陷；流式 `n>1` 罕见。
- **滑动会话续期丢 `oidcSub` 声明**（nit）：续期时透传的是 `oidcName` / `oidcEmail` / `saml*`，`oidcSub` 未在列表内。
- ComfyUI 远程实例接入（`baseUrl` 死代码）与生成参数上限 —— 属功能完善而非缺陷。
- i18n 无全量 parity 测试；zh-TW 词条数约为 zh-CN 的 1/3，缺词条静默显示英文。

**正面确认**：环境变量 `NINEROUTER_*` → `TENROUTER_*` 保留了同表达式回退并有守卫测试，存量部署不受影响。

---

## 四、安全审计收尾复核（#9 / #25）

- **默认密码腿已斩断**：`DEFAULT_PASSWORD` 删除，`INITIAL_PASSWORD` 唯一引导口令；未设密码 + 无 SSO 时仅回环可信；首设密码分支不认字面量 `123456`；CLI 重置改随机 12 字节；fnOS 占位值改随机。回环判定链（`custom-server.js` 删重打 `x-10r-*` + 随机 `PEER_TOKEN` 经 env 传 `trustedPeer.js`）远程不可伪造。
- **凭据加密**：AES-256-GCM `enc:v1:`，加解密收敛在 repo 两个出入口、幂等、刷新不双重加密；嵌套密钥被 `NESTED_SECRET_PATTERN` 覆盖；密钥不进库（`CREDENTIAL_SECRET` 或 `$DATA_DIR/credential-key` 0600，**Windows 走 icacls**）。
- **会话**：24h→2h + 滑动续期；**新增绝对上限** —— 签发时写入已签名的 `origIat` 并跨续期原样传递，超过 30 天拒绝续期（修复前每次续期都刷新 `iat`，被盗 cookie 每 <2h 用一次即可无限续期，2h 窗口从未真正闭合）。老 token 无该声明则回退用自身 `iat`。
- **守卫顺序**：dashboardLocalOnly → LOCAL_ONLY → import-usage → ALWAYS_PROTECTED → LLM → LOCAL_OR_AUTH → `/api/*` 默认拒绝；`/api/health` 仍公开但**已脱敏路径**。
- **#25 私有网络**：`ALLOW_PRIVATE_HOSTS` / `PRIVATE_HOST_ALLOWLIST` 默认关，opt-in。
- **更新器**：包名硬编码比对、目标版本服务端从 registry 解析、正则校验后拼 `installSpec`、预发布默认拒绝；状态服务绑 `127.0.0.1` 且去 CORS。**仍无哈希 / 完整性校验**（§九）。
- **CI 校验和**：三工作流各出一份 `SHA256SUMS-*.txt`，清单本身未签名 / attest（`verify-downloads.md` 已如实声明）。

---

## 五、供应商治理复核（StepFun / MiMo / ComfyUI）

- **StepFun 四渠道**：`stepfun-cn` / `stepfun` / `stepfun-plan-cn` / `stepfun-plan`，短别名无碰撞（`sfcn` 冲突见 §一.3，已修）；四渠道均无 `kind:"image"`；002 迁移 SQL 正确（`substr(key,8)`、幂等、事务内、方向不误指国际站）。
- **MiMo 三卡（本版重点收敛）**：`xiaomi-mimo`（浏览器登录 + sk- key，云端）与 `mimo-desktop`（账号会话 + 周额度）职责分离，`xiaomi-tokenplan` 无配额接口。本版**关闭了会话混入云卡的全部路径**：写入侧两条 oauth 路由按卡门控 + 云卡更新剥离 session 字段；迁移侧 migration 005；导入侧 `accountTransfer` 剥离；读取侧 usage 处理器对云卡短路机器会话；去重侧 `xiaomiIdentity` 不再把两卡身份视为可互换。云卡配额页现在返回其真实计费模型说明，不再是空卡。
- **UltraSpeed**：`mimo-v2.6-pro-ultraspeed` 加入云卡 + Token Plan 卡（**不含** Desktop），有定制服务合约的 key 开箱可用，无则收到上游报错——优于要求用户手工添加模型。
- **registry/index.js** 尾部追加维护、137 文件 = 137 import；providers 基线重录无 `hidden` 行变动（无 qoder-cn 式误暴露）。
- **stopSequenceGuard 前缀缓冲**：跨 delta 拆分命中、最早命中优先取最长、`MAX_ENFORCED_STOP_LENGTH`（现位于 `config/`）防无限缓冲、单字节 stop 不 hold、CJK 用单 `TextDecoder`；usage 帧保留。
- **combo retryOnEmpty**：默认关；`hasFallback = i<len-1` 保证最后一个模型不 peek；head 原始字节 replay 单 decoder。
- **RTK**：fail-open 不变。

---

## 六、自动化测试与回归门禁

- 全量套件 `npx vitest run`：**3458 例，3329 通过 / 35 失败 / 94 跳过**，`verify-no-regression.mjs` 判定 `✅ No regression（now fails=35, baseline known=40, all known）`。**0 新增回归**。
- 三注册表基线 byte-for-byte 通过；`audit-capabilities --check` 通过。
- ESLint 改动文件与 v1.1.3 计数持平，无新增（个别文件反而更好）。
- **新增测试基建：CDP 无头浏览器探针**（`scripts/browser-probe.mjs` + `scripts/probes/`，零依赖）。起因是 §一.7 那两条渲染层缺陷：计数撒谎与同 tick 丢写，**读源码与单测都摸不到**（连点那条必须同 tick 突发才复现，顺序点击会完全掩盖）。探针驱动真机页面、执行脚本、回报带判定布尔值的结果并截图。方法论写进 `docs/zh-CN/local-build-and-verify.md` §4③，含本版付出的两个误判教训（按图标「画的是什么」判方向而非按该排按钮的约定；用顺序交互覆盖同 tick 竞态）。
- **每处修复都做了反向验证**：把修复改回错误写法，确认新增用例真的会红。绿的用例不代表有保护力。

---

## 七、发版元数据现状（三项均未动，等发版提交）

1. **版本号**：树内四版本位（root / cli / desktop / fnos manifest）仍为 **1.1.4**，发 v1.2.0 需 bump 至 1.2.0。遵循「树内不得携带未发布的已发版号」（1.0.8 教训）—— bump 与 tag / 发布同一步做，**不提前 bump**。
2. **开发日志 `CHANGELOG.md`**：顶部段落为 `## v1.1.4 (2026-09-20)`（占位），需改标题为 `v1.2.0` 并补齐其后全部提交。
3. **用户侧三语说明**：`public/i18n/changelog/{en,zh-CN,zh-TW}.md` 目前无本版段落（`afc462ad` 有意撤下、靠 release-cap 兜底，属设计）。`docs/zh-CN/release-prep/v1.2.0-changelog-sections.md`（2026-09-21 写）**已过时**：它是 revert 当时的安全专版，连当时已在树里的 StepFun / ComfyUI / combo #10 / stop 序列 #18 都未提，更不含 revert 之后的 MiMo Desktop V2.6 / i18n 258 / doctor / tooling / 本轮全部修复。发版前须**重写**三语说明。

---

## 八、发版 checklist

代码侧（**全部已完成**）：

- [x] 高危 #1 错钥保留密文 + 回归用例
- [x] 高危 #2 headless 不自杀（真实非 TTY 启动验证**未做**，见 §九.4）
- [x] 高危 #3 删 `sfcn` 劫持 + 重录 alias 基线 + 全局别名唯一性测试
- [x] 高危 #4 `mimo-desktop` 连接测试分派 + 单测
- [x] 高危 #5 holdover SSE 帧边界 + 帧边界 / Anthropic 多 block 用例
- [x] 高危 #6 纯工具调用不判空 + Responses / Gemini 用例
- [x] 中危 7/8 处置（备份错钥、migration 005、Anthropic tool_use、重试 reasoning/usage、fnOS 密码、`/api/version`、Windows ACL、登录页端口、用量分组）；**启动器杀进程身份核对未做**（§九.1）
- [x] 低危部分处置（能力表 / 文档漂移 / 会话绝对上限 / health 脱敏 / manifest / 常量归位）；`wx`、`settings/database` cli-token、`n>1` 未做（§三 / §九）
- [x] 新增 CDP 探针工具与 §六 所述方法论
- [x] 17 提交已推送 `origin/main`（`aece53d6`）

发布侧（**未动，等维护者明确指令**）：

- [ ] 四版本位 bump 1.1.4 → 1.2.0（root / cli / desktop / fnos manifest）
- [ ] `CHANGELOG.md` 顶部改 `v1.2.0 (发布日)` 并补齐缺项
- [ ] 重写三语 `public/i18n/changelog/*.md` v1.2.0 段（覆盖 StepFun / MiMo 三卡 / 网关契约 / 安全 / UI / tooling 全量）
- [ ] 重写 `docs/zh-CN/release-prep/v1.2.0-changelog-sections.md`
- [ ] tag `v1.2.0` **单独推**（避免与 main 同推被 GitHub 静默丢 tag 事件），确认 CI 触发 fpk / standalone / Docker 三工作流 + 校验和
- [x] 本报告已移入 `docs/zh-CN/archive/reviews/`，`docs/README.md` 归档索引已更新

> ⚠️ **发版动作（bump / tag / Release）一概不得由 agent 自行执行**，须维护者明确指令。「树内不得携带未发布的已发版号」是 1.0.8 事故的教训。

---

## 九、遗留（不阻塞，记录在案）

1. **启动器杀进程身份核对**（低危，本版唯一未做的**中危**代码项）。`cli/cli.js` 的清端口顺序为 `killAllAppProcesses → killProcessOnPort → healStaleServer`，而带版本身份核对的 `healStaleServer` 排在最后，实际是死路径；`killProcessOnPort` 会无差别杀掉端口占用者，机器上其它 Next.js 服务可能一并中招。**未做的理由**：改动风险与其严重度不匹配——改错就是 EADDRINUSE 或白屏（文件注释本身有警告），且验证需要多进程真机环境，本机不具备。建议在专门的真机多进程测试轮里做。
2. **`/api/settings/database` 的 cli-token 空判**（低危，**本版遗漏**）：`isCliRequest` 只判 header 存在、不比对 `getCliToken()`，持有效会话者加任意该 header 即跳过密码重验拿到明文凭据导出。建议下版复用 guard 的 `hasValidCliToken`。**这条不是判断取舍，是漏做**。
3. **首启密钥文件无 `wx`**（低危，本版未做）：双实例同 `DATA_DIR` 首启竞态。§一.1 修复后后果降级（不再销毁密文，仅换掉密钥），且该配置本不被支持，故留作已知项。
4. **headless 真实启动验证**：高危 #2 的修复只有 source-guard 覆盖，未在真实非 TTY（nohup / systemd）下跑过一次。
5. `#9-6` 更新器 `npm i -g <pkg>@latest` 仍无哈希 / 完整性校验。
6. `#9-8` 登录限流仍是内存 `Map`，重启清零（会话时长那半已修）。
7. `n>1` 时守卫把各 choice 文本并进 choice 0 —— **刻意取舍**（代码注释已写明流式多 choice 罕见），非缺陷。
8. 滑动会话续期未透传 `oidcSub`（nit）;ComfyUI 远程实例接入与生成参数上限（功能完善）；i18n 无 parity 测试、zh-TW 词条约缺 2/3。
9. `open-issues-status.md`（2026-09-11 快照）主体已过时，已在其顶部加状态表说明；其中 8 项其实早已修完。
