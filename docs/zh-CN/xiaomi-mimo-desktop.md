# 小米 MiMo 桌面版适配（mimo / xiaomi-mimo）

> 范围：把 **小米 MiMo 桌面客户端**（MiMo Desktop）接成 10Router 的一个供应商。
> 相关代码：`open-sse/providers/registry/xiaomi-mimo.js`、`open-sse/executors/xiaomi-mimo.js`、
> `open-sse/shared/mimoAccount.js`、`src/lib/oauth/providers/xiaomi-mimo.js`、
> `src/lib/oauth/utils/server.js`、`src/app/api/oauth/xiaomi-mimo/*`、
> `src/app/api/oauth/[provider]/[action]/route.js`。

## 0. 为什么这家要单独适配

MiMo 桌面版**不是**标准 OAuth2，也不是"填个 API key 就完事"：

| 能力 | 认证方式 | 走哪个端点 |
|---|---|---|
| 云端 LLM（`mimo-v2.5-pro` 等） | API key `sk-...` | `https://api.xiaomimimo.com/v1` |
| **桌面卡**（`mimo-desktop`：`mimo-v2.6-pro` / `mimo-v2.6-flash`） | **小米账号会话 Cookie** | `https://mimo-server-cn.xiaomimimo.com/api/route/chat/completions` |
| TTS（`mimo-v2.5-tts`） | API key | 见 `ttsConfig` |

两个关键结论决定了整个设计的形状：

1. **Preview 模型只认账号 Cookie**，API key 打不通 —— 所以想用 Preview 就必须拿到桌面版的登录态。
2. 桌面版的登录是**自定义 ECDH + AES-GCM 授权码**流程（不是 OAuth2 授权码），
   平台页面把一段密文交回客户端，客户端用本地私钥解出 `sk-`。

设计选择（当初定的"设计 A"）：**不新开一个 provider**，而是在现有 `xiaomi-mimo` 上做**双认证**
（`authModes: ["oauth", "apikey"]`），按模型选端点。这样用户无论用哪种方式登录，
模型列表是同一份，不会出现"两个小米"。

注册表要点：

```js
id: "xiaomi-mimo", alias: "xiaomi-mimo", uiAlias: "mimo",
aliases: ["mimo", "mimo-desktop", "xmd"],   // 兼容旧配置里的叫法
priority: 290, category: "oauth", authModes: ["oauth", "apikey"],
serviceKinds: ["llm", "tts"], color: "#FF6900",
```

模型清单（云端卡 `xiaomi-mimo`）：

```
mimo-v2.6-pro               云端卡现有型号（1M 上下文 / 128K 输出）
mimo-v2.6-flash             云端卡现有型号
mimo-v2.5-tts               kind: "tts" —— 不参与文本 LLM 的默认禁用
```

桌面卡 `mimo-desktop` 现在卖的是**同名的** `mimo-v2.6-pro` / `mimo-v2.6-flash`，带
积分倍率（1x / 0.4x），走账号会话；两卡同名靠 **provider id** 区分。旧的
`mimo-x-pro-preview` / `mimo-x-flash-preview` 已被上游下线，两卡都不再列出。
> （官方 URL 就是这么拼的，别"修正"它）。

## 1. 凭据路径：桌面版把登录态放在哪

这些路径**不存在 10Router 里，全是桌面客户端的**，且三个平台各不相同。
统一收在 `open-sse/shared/mimoAccount.js` 一个模块里（只有一处，两边不会漂移）：

```js
// Electron 的 userData（Chromium profile 根）
desktopUserDataDir():
  win32   %APPDATA%/Xiaomi MiMo
  darwin  ~/Library/Application Support/Xiaomi MiMo
  linux   $XDG_CONFIG_HOME（默认 ~/.config）/Xiaomi MiMo

// 账号分区 Cookie 库（passToken 在这）
desktopCookiePath():
  <userData>/Partitions/xiaomi-account/Network/Cookies

// auth.json —— 注意：不在 Electron profile 里！
desktopAuthJsonPaths():
  $XDG_DATA_HOME/mimocode/auth.json   ← 首选
  ~/.local/share/mimocode/auth.json   ← 回退（用户改过 XDG_DATA_HOME 时仍可用）
```

`auth.json` 的位置来自桌面客户端启动内置引擎时的 `authDataDir`，它是 **XDG *data* 目录**
（macOS 也不例外，不是 `~/Library`）；已退役的独立 mimocode CLI 写的是同一个目录，
所以一条路径同时覆盖两者。

### 读 Cookie 时的两个必须

1. **桌面版运行时会独占锁住 Cookie 库** → 先复制再读；复制失败就放弃（返回 null），不报错。
   复制的副本持有活的账号会话，所以按 `0600` 创建、用完即删。
2. **锁定要变成有类型的错误**：`EBUSY / EPERM / EACCES` 一律转成 `DESKTOP_LOCKED` 抛给上层，
   由 UI 提示"请先退出桌面版"；而**配额/用量这类路径必须降级、绝不抛**
   （拿不到就当作没有用量信息）。

## 2. 授权码流程（自定义 ECDH + AES-GCM）

### 2.1 握手与参数

```
客户端                                    平台
  │ 生成 X25519 密钥对
  │ pk = base64url(SPKI DER)              ← 必须是 base64url！见 §5.2
  │ ── GET /authorize?pk&redirect_uri&kn=mimocode&key_name&app=MiMo ──▶
  │ ◀── (回调) 或 (页面显示一段可复制的密文)
  │ 用本地私钥 ECDH + AES-GCM 解出 { uid, sk }
```

授权 URL 的**五个参数一个都不能少**（`buildAuthorizeUrl()`）：

```js
new URLSearchParams({ pk, redirect_uri, kn: "mimocode", key_name, app: "MiMo" })
```

`app: "MiMo"` 是**平台用来决定这份授权码为哪个客户端签发的**。缺了它，
页面交回的是为**另一个客户端密钥**加密的载荷 —— 长度正常、格式正常，
而任何一把我们的私钥都打不开。这是本项目踩过的最大一个坑（§5.1）。

配置集中在 `XIAOMI_MIMO_CONFIG`（`src/lib/oauth/constants/oauth.js`）：

```js
platformUrl: "https://platform.xiaomimimo.com",   // 可用 MIMO_PLATFORM_URL 覆盖
defaultBaseUrl: "https://api.xiaomimimo.com/v1",
kn: "mimocode",
app: "MiMo",
timeoutMs: 300000,        // 5 分钟：本地回调监听器等多久
pendingTtlMs: 24h,        // 待用私钥能活多久（粘贴授权码用，见 §2.4）
```

### 2.2 载荷线格式（逐字节，别改顺序）

```
base64url 解码后：
  bytes 0..31     32 字节  临时公钥（裸 X25519）
  bytes 32..43    12 字节  AES-GCM nonce      ← 在公钥【后面】
  bytes 44..n-16  密文
  最后 16 字节      GCM auth tag

密钥 = SHA256( ECDH(客户端私钥, 临时公钥) )
```

临时公钥的 SPKI 前缀是 `302a300506032b656e032100`（12 字节）拼上那 32 字节裸密钥。

**临时公钥在前、nonce 在后** —— 这和"nonce 在前"的直觉相反，而且是**本项目的真因级 bug**
（§5.3）。这份布局是逐字节对齐官方客户端 `app.asar` 里的解密函数得来的，不是推测。

### 2.3 本地回调监听器

`startXiaomiMimoProxy()`（`src/lib/oauth/utils/server.js`）：

- 绑定 `127.0.0.1` 的**临时端口**，`callbackUrl = http://127.0.0.1:<port>/callback/<32 hex>`
  —— 路径是**每个监听器随机生成的**（`crypto.randomBytes(16)`）。
  **这条随机路径本身就是防跨站的能力凭证**：不知道它的页面根本到不了处理逻辑（其余路径 → 404）。
  它取代了更早的"Origin 必须是 loopback"守卫 —— 那个守卫方向是错的，见 §5.4。
- 平台登录页是**从它自己的 https 源跨域调用**这个监听器的（官方客户端因此专门处理
  `OPTIONS` + `Access-Control-Allow-Origin`）。所以：只对平台源回 CORS 头，**不拒绝**其它来源。
- 结果用 **302 回平台自己的** `/authorize/callback?status=success|error&message=...` 报告，
  不再渲染我们自己的 HTML 页（官方就是这样，平台页面据此收尾）。
- 失败原因只有两个常量：`missing_data`、`decrypt_failed` —— **绝不把载荷回显进响应**。
- **回调里没有 `state`**（协议如此），所以无法按会话归因，只能**逐把待用私钥试**。
  归因规则：只有一个待用会话时把失败记到它头上；有多个时全部保持 pending，不误杀。

### 2.4 粘贴授权码通道（一等公民，不是兜底）

平台的授权页可能**显示一段码让人复制**，而不是回调我们的 localhost。这段码就是
**同一个 ECDH 密文**，所以走同一条解密入库路径（`completeXiaomiMimoFlow()`）。

- `POST /api/oauth/xiaomi-mimo/submit-code { code }` → `{ status:"done", state, result:{uid,baseUrl} }`
  或 400 `{ status:"error", error }`。
- 返回 **`state`** 是为了让模态框接着走已有的 `/exchange`：`sk-` 由服务端落库，
  **密钥从不经过浏览器**。
- **监听器超时（5 分钟）不能清掉待用私钥**。`stopXiaomiMimoProxy()` 只做"停止监听"；
  待用私钥的生命周期由 `registerXiaomiMimoSession()` 按 `pendingTtlMs`（24h）清理。
  （桌面版自己的登录引擎也是 24h，就是为了这个通道。）这里**曾经写反**过：见 §5.5。
- 粘贴文本会先归一化：容忍整段 URL / 裸 `u=` / `code=`、各种标签（`授权码：`、`验证码`、
  `Authorization code:`）、包裹的引号反引号、结尾标点；`decodeURIComponent` 包在 try/catch 里
  （一个裸 `%` 曾经变成 500）。
- **`payload_too_short`（< 60 字符）必须和 `decrypt_failed` 分开**：低于最小密文长度是
  **复制**问题，告诉用户"码不匹配"会让他去重抄一段本来好好的码。

### 2.5 错误文案与 i18n

服务端返回的文案会**原样显示在模态框里**，因此：

- 必须**说清下一步做什么**，不能只说"请重新复制"；
- **必须进 locale 表**（`public/i18n/literals/zh-CN.json` / `zh-TW.json`）。
  这些字符串**住在服务端**，模态框的字面量扫描看不见它们 —— 漏了就会在中文界面里
  突然冒出一句英文。`tests/unit/xiaomi-mimo-routes.test.js` 里有一条守卫用例会正则抽出
  这张映射表并逐个断言两个 locale 都有。

当前五个（`submit-code`）：

| error | 提示 |
|---|---|
| `empty_payload` | Paste the authorization code first. |
| `payload_too_short` | 太短，不是完整授权码（通常 100+ 字符），用页面上的 Copy 按钮整段复制 |
| `no_pending_session` | 本次登录已失效，点「Sign in via Browser」重新开始 |
| `decrypt_failed` | 与本次登录不匹配：整段复制，或重新获取 |
| `missing_api_key` | 这段码里没有 API key，请重新登录 |

模态框另有一条**错误态恢复按钮**（重新走一次浏览器登录），避免卡死在死路上。

### 2.6 端点契约

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/oauth/xiaomi-mimo/auto-import` | 从桌面版 profile 自动导入：`{found, apiKey, uid, baseUrl, source, hasDesktopSession, desktopLocked, error?}` |
| POST | `/api/oauth/xiaomi-mimo/api-key` | 手工填 `sk-` |
| GET | `/api/oauth/xiaomi-mimo/authorize?state=` | 启动监听器 + 登记密钥对；返回 `{ authorizeUrl, manualUrl, state }` |
| GET | `/api/oauth/xiaomi-mimo/poll-status?state=` | 轮询；**`done` 之后不能清会话**（否则 `/exchange` 拿不到） |
| POST | `/api/oauth/xiaomi-mimo/submit-code` | 粘贴授权码（§2.4） |
| POST | `/api/oauth/xiaomi-mimo/exchange` | 应用 `sk-`、建连接 |
| GET | `/api/oauth/xiaomi-mimo/stop-proxy` | 停止监听（**不清会话**） |

`manualUrl` = 平台那个**专门显示可复制授权码**的页面
（`redirect_uri=https://platform.xiaomimimo.com/authorize/code/callback`），
其它参数与自动版完全相同。模态框在有输入框时给出「打开授权码页面」链接。

## 3. 双凭据模型与身份匹配（2026-09-15 定型）

MiMo 有**两条互相独立的凭据链**，各自的模型家族不同。理解这张表是理解后面所有
「为什么没合并 / 为什么 401 / 为什么测试失败」的前提：

| 凭据 | 来源 | 能调什么 | 存哪 |
|---|---|---|---|
| **`sk-` API Key** | 浏览器授权（ECDH 解出）/ 手动粘贴 | **计费模型 + 订阅计划**（`mimo-v2.5-pro` 等，走 `api.xiaomimimo.com`） | `connection.accessToken` |
| **桌面账号会话**（`passToken`） | MiMo 桌面版登录（扫码）/ 桌面版 Cookie 库 | **专属 Preview 模型**（`mimo-x-pro/flash-preview`，走 `mimo-server-cn`） | `providerSpecificData.mimoPassToken` |

**一条连接可以同时持有两者**——这是刻意的设计：路由按**模型名**分派
（Preview → 会话；其余 → key），若两条凭据分散在不同连接上，账号选择器选错那半就必然失败。

### 3.1 三条写入路径与合并规则

| 路径 | 写入内容 | `authMethod` |
|---|---|---|
| 桌面扫码导入（`auto-import` → `api-key` 路由，`sessionOnly`） | 仅会话 | `desktop-session` |
| 浏览器授权（`exchange`） | `sk-`，**并顺带读取本机桌面会话一起写入** | `oauth` |
| 手动粘贴 key | `sk-` | `api_key` |

三条路径都经过 **共享身份匹配器** `src/lib/oauth/xiaomiIdentity.js`：

```
uid → mimoUserId → email(`${uid}@xiaomi`) → accessToken
```

- **命中即合并**（更新那条连接，不新建）；
- **不命中则新建**（不同 uid = 不同小米账号，各自独立）；
- `mimoUserId` 这一档专门兜住**浏览器 payload 不带 uid** 的情况——此时用桌面会话读到的
  账号 id 匹配，否则同一账号会建出第二条（见坑 6.10）。

> 历史教训：`exchange` 与 `api-key` 两条路由**各自维护过一份匹配规则**，且 api-key 侧只在
> `sessionOnly` 时才查 `mimoUserId` —— 规则漂移的直接后果就是「同账号两条连接」。现在
> 统一走 matcher，并有用例锁住「不同账号不匹配」「跨 provider 不匹配」。

### 3.2 连接测试怎么测

`testSingleConnection` 按**连接实际持有的凭据**选择探测方式：

| 连接持有 | 测试方式 |
|---|---|
| 真 `sk-` | `GET /models`（原逻辑） |
| 仅桌面会话（占位 token / `authMethod: desktop-session`） | 向 `mimo-server-cn` 发一次**最小请求**（`mimo-v2.6-flash`，content 用纯字符串）——只有真实调用才能证明会话可用 |
| 两者都有 | 优先 `sk-`（更便宜，失败原因也更明确） |

**坑**：`authType` 在仓库里存在 `api_key` / `apikey` **两种拼写**，测试分派此前只认后者，
导致会话连接走错分支报 `Provider test not supported`（见坑 6.11）。

## 4. 取号与端点选择（执行器）

`open-sse/executors/xiaomi-mimo.js`：

```js
ACCOUNT_SESSION_PROVIDER = "mimo-desktop"
COOKIE_KEY               = "__mimoAccountCookie"
```

- 桌面卡（`mimo-desktop`）→ `https://mimo-server-cn.xiaomimimo.com/api/route/chat/completions` +
  `Cookie: <账号会话>`；其余 → 云端 API + `sk-`。
- **判定键是 provider id，不是模型 id**：两卡卖同一个 `mimo-v2.6-pro`，只有 provider
  能分出"扣云端余额"还是"扣桌面积分"。
- **401 → 失效缓存并重试一次**（账号 Cookie 30 分钟缓存，`COOKIE_TTL_MS`）。

## 5. 自动化与"不打扰"

- `auto-import` 会在桌面版**登录过**的情况下直接复用其登录态；桌面版正开着时
  Cookie 库被锁 → `desktopLocked: true`，UI 提示退出桌面版，**但绝不因为锁而让导入失败**。
- 导入/配额路径一律 **fail-open**：任何异常都退化成"没有额外信息"，不阻塞用户。

## 6. 踩过的坑（按严重程度，含真因复盘）

### 6.1 授权 URL 漏了 `app=MiMo`（症状：码永远不匹配）
平台据此决定为哪个客户端签发。缺了它就加密给别的客户端密钥。
→ 现在 `buildAuthorizeUrl()` 与官方构造器逐参数一致。

### 6.2 `pk` 用了标准 base64，而不是 base64url
官方是 `Buffer.from(publicKey).toString("base64url")`。X25519 SPKI 转标准 base64
**末尾必带 `=`**，还可能含 `+` `/` —— 这些字符不在 base64url 字母表里，
严格解码器会**静默跳过**，把 DER 拼成另一个（或无法导入的）公钥，
等于让平台加密给一把我们不持有的密钥。→ `pk` 用 base64url；
解密入口对标准 base64 再做一次归一化容错。

### 6.3 真因：载荷布局**前后颠倒**（症状：232 字符、格式正常、怎么都不匹配）
我们曾经按 `nonce(12) + 临时公钥(32) + ...` 读，官方是
`临时公钥(32) + nonce(12) + ...`。于是把临时公钥的前 12 字节当 nonce、把真 nonce 当公钥，
**ECDH 派生出的密钥全错，GCM tag 必然失败**。

> **为什么测试没拦住**：我们自己的加密测试助手也按同一个错误布局拼载荷，
> 自加密自解密当然全绿。**测试助手必须对齐对端实现，而不是对齐我们自己的解码器。**
> 现在助手与官方逐字节一致，并有一条"官方字节布局"断言（含字段偏移），
> 把顺序改回去会立刻变红。

### 6.4 Origin 守卫方向反了
早先要求回调的 `Origin` 必须是 loopback —— 而平台登录页是从**它自己的 https 源**调用的，
于是**唯一的合法调用方被 403**，自动回调这条路一直是断的。
→ 改为"随机回调路径 + 只对平台源回 CORS"，与官方一致。

### 6.5 监听器超时把待用私钥清空了
`stopXiaomiMimoProxy()` 曾经 `xiaomiMimoSessions.clear()`，于是用户一看回调不成就改去粘贴时，
私钥已经被 5 分钟超时清掉 —— 报"不匹配"。而当时那条测试用例还把 bug 当成契约固定了下来。
→ 现在只停止监听，TTL 由 `pendingTtlMs` 管；测试改成"停止后仍可用"。

### 6.6 回执方式不对
返回自定义 HTML → 平台页面无从知道结果（弹窗一直挂着）。
→ 302 到 `${platform}/authorize/callback?status=...`。

### 6.7 死配置
`XIAOMI_MIMO_CONFIG.callbackPath` 曾写着 `"/"`，与"随机路径"的现实矛盾且已无引用。
→ 已删除，避免下一个读代码的人被带偏。

### 6.8 扫码登录的用户「检测不到」——强依赖 auth.json 的假阴性（2026-09-15 修复，`d1bde6eb`）

**症状**：用户在 MiMo 桌面版里**扫码登录**（官方登录页），dashboard 点「连接」却提示
「Xiaomi MiMo Desktop auth file not found … Make sure you are signed in」，或（桌面版开着时）
「Desktop is running and is holding its credential store — quit it and retry」。

**真因（两层叠加）**：

1. **扫码登录不产生 `auth.json`**。`auth.json` 只在「通过客户端拿/写 `sk-` API Key」时才落盘；
   纯扫码登录只把账号会话（`passToken`）写进 Chromium Cookie 库
   `%APPDATA%\Xiaomi MiMo\Partitions\xiaomi-account\Network\Cookies`（**明文 `value` 列**，
   不是 `encrypted_value` —— 已在本机实测确认）。而 `auto-import` 原先**硬性要求 `auth.json`
   存在且含 `sk-`**，否则一律 `found:false` —— 于是 `hasDesktopSession:true` 明明已经读到，
   却被前端当「未检测到」丢弃。
2. **桌面版运行时的文件独占锁是真实存在的**：其 Network 子进程以 `dwShareMode=0` 打开 Cookies，
   任何 `CreateFileW`（含 `FILE_SHARE_READ|WRITE|DELETE`、`FILE_FLAG_BACKUP_SEMANTICS`）都返回
   `ERROR_SHARING_VIOLATION(32)`。**没有**用户态办法在运行时读取（DuplicateHandle 需先枚举目标
   进程句柄，成本高且脆弱，不做）。所以「退出桌面版」这一步在**首次读取**时确实必要。

**修复**：把「桌面会话」升为一等凭据，不再强绑 `auth.json`：

- `auto-import`：无 `auth.json` 但读到 `passToken` → 返回 `{found:true, sessionOnly:true, uid}`；
- `api-key` 路由：接受 `sessionOnly`（无 `sk-`），`accessToken` 存稳定占位
  `mimo-desktop-session-<uid>`（下游要求非空 token 的路径不受影响），连接标
  `authMethod:"desktop-session"`；dedup 增加「同 `mimoUserId`」一档，**绝不把真 key 降级成占位**；
- 弹窗：会话模式显示绿色卡片「已检测到桌面版登录会话」+ 按钮「使用桌面版会话连接」；
- **实测**：导入后 `mimo/mimo-x-flash-preview` 经 `/v1/chat/completions` 返回 200 正文。

**给未来的教训**：`passToken`（账号会话）与 `sk-`（云端 key）是**两条独立凭据链**——Preview 只认前者、
云端只认后者。任何「必须有 X 才算登录」的判定都会在另一种登录姿势下假阴性。导入完成后连接里已存
`mimoPassToken`（`getServiceCookie` 优先用它），之后**桌面版开着也能正常调用**，无需退出。

### 6.9 弹窗把 sessionOnly 响应误判为「未找到」（2026-09-15，`afc3784c`）

后端已经正确返回 `{found:true, sessionOnly:true}`，前端却仍弹「未找到本地凭据」。
根因是**判定条件写了 `data.found && data.apiKey`** —— sessionOnly 响应没有 `apiKey`，
于是走了 not-found 分支，还显示后端那段英文原文（中英混排）。修法：判定只看 `data.found`，
并由后端改为返回**错误码**（`code`）+ 明细（`details`），前端按码映射三语文案。

> 教训：改「后端返回结构」时必须同步搜一遍**所有消费该响应的判定条件**——
> 同一份逻辑当时在弹窗里有两处（`detect()` 与 `useEffect`），只改一处仍会复现。

### 6.10 同一账号被拆成两条连接（2026-09-15，`06631197`）

浏览器授权成功后没有合并进已有的会话连接。两层原因：
① `exchange` 与 `api-key` 的匹配规则不一致（见 §3.1）；
② `exchange` 只拿浏览器 payload 的 `uid` 去匹配，**payload 不带 uid 时两个条件都落空** → 新建。

修法：抽出共享 matcher，并让 `exchange` 把**桌面会话读到的 `mimoUserId`** 一并作为匹配键。
用例覆盖「uid 缺失但有 mimoUserId」「不同账号不匹配」「跨 provider 不匹配」。

### 6.11 会话连接的测试报 `Provider test not supported`（2026-09-15，`5fdb3d5a`）

`testSingleConnection` 用 `authType === "apikey"` 分派，而会话连接存的是 **`api_key`**（下划线），
两边都不匹配 → 落到 OAuth 分支 → `OAUTH_TEST_CONFIG` 里没有 xiaomi-mimo → 报「不支持」。

修法：① 分派兼容两种拼写；② 会话连接改用 **Preview 模型真实探测**（占位 token 打 `/models`
必然 401，那不是「密钥无效」而是「这条连接本来就没有 key」）。

## 7. 测试与验证

- 单测：`tests/unit/xiaomi-mimo-{oauth,routes,submit-code,account,executor,paths,icon,tts}.test.js`
  （8 文件）+ `xiaomi-identity.test.js`（身份匹配规则，7 例）。路径类用例用伪造 home，并**只 mock `node:os.homedir`**（不要 mock `tmpdir`），
  且用 `assertSandboxed()` 保证**绝不写到沙箱外**（曾经因此覆盖过开发机上的真实 Cookie 库）。
- `process.platform` 是数据属性，要改就用
  `Object.defineProperty(process, "platform", { value, configurable: true })` 并在 `afterEach` 还原。
- **解密相关用例必须 `redirect: "manual"`**：否则 `fetch` 会真的跟到平台域名去（单元测试不该发真网络请求）。
- 手工验证：起一个临时 `DATA_DIR` + 非默认端口跑 sidecar；未鉴权时受保护路由返回 **401**
  只证明路由存在、不证明逻辑对。日志里会打
  `code rejected (decrypt_failed): N chars, M pending session(s)` —— **只打长度和计数，绝不打载荷**。
- 构建/替换/验证的通用流程见 `docs/zh-CN/local-build-and-verify.md`。

## 8. 相关文件

| 关注点 | 文件 |
|---|---|
| 注册表（模型 / 双认证 / 别名） | `open-sse/providers/registry/xiaomi-mimo.js` |
| 取号与端点选择 | `open-sse/executors/xiaomi-mimo.js` |
| 桌面版凭据路径 / Cookie / 用量 | `open-sse/shared/mimoAccount.js` |
| 握手与解密 | `src/lib/oauth/providers/xiaomi-mimo.js` |
| **账号身份匹配（共享 matcher）** | `src/lib/oauth/xiaomiIdentity.js` |
| 本地监听器 / 会话 / 粘贴解密 | `src/lib/oauth/utils/server.js` |
| 常量 | `src/lib/oauth/constants/oauth.js` |
| 端点 | `src/app/api/oauth/xiaomi-mimo/*`、`src/app/api/oauth/[provider]/[action]/route.js` |
| 连接测试 | `src/app/api/providers/[id]/test/testUtils.js`（`case "xiaomi-mimo"`） |
| 模态框 | `src/shared/components/XiaomiMimoAuthModal.js` |
| 连接行标签/显示名 | `src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js` |
| 编辑弹窗的 OAuth 判定 | `src/shared/components/EditConnectionModal.js` |
| 图标 | `public/providers/xiaomi-mimo.png`（128×128 PNG，按 provider id 解析） |
