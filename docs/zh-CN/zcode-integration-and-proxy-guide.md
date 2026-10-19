# ZCode 与 10Router 全链路接入与反代实战指南

> **文档归档**：`docs/zh-CN/zcode-integration-and-proxy-guide.md`  
> **适用版本**：10Router v1.3.0+，CreditDaddy 桌面版，ZCode 客户端  
> **更新时间**：2026-09-30  

---

## 概述与核心概念

在 10Router 架构中，**ZCode**（智谱推出的 AI 编码客户端与生态）存在两种完全不同的协同方向，理解这两者的边界是避免配置混乱的关键：

1. **客户端反代（ZCode → 10Router）**：把 ZCode 客户端作为消费端，将其请求重定向到 10Router 网关，从而在 ZCode 中无缝调用 10Router 聚合的 40+ 供应商、模型组合（Combo）以及多账号熔断降级。
2. **额度反代 / 供应商接入（10Router → ZCode 额度）**：把 ZCode 账户里的模型额度反向供给 10Router 统一调度，供 Claude Code、Cursor、Zed、Windsurf 或局域网内其他设备消费。

由于 ZCode 官方存在**两种性质截然不同的额度**（免费体验套餐 vs 正式付费订阅），接入链路完全不同：

| 额度类型 | 官方产品名 | 上游端点与协议 | 访问控制特征 | 10Router 接入方案 |
|---|---|---|---|---|
| **免费体验包** | Start Plan / Trust Build / Weekend Build | `zcode.z.ai/api/v1/zcode-plan/anthropic` | 强制阿里云滑块验证码（错误码 3007），无公开 API | 走 **`zcode-free`** 供应商，联动 **CreditDaddy** 本地额度网关 |
| **正式订阅套餐** | Coding Plan 官方编码套餐 | `open.bigmodel.cn/api/coding/paas/v4`<br>`open.bigmodel.cn/api/anthropic` | 标准 API Key（`id.secret` 格式），长效无验证码 | 直接作为 10Router **自定义提供商** 或 GLM-CN 节点接入 |

---

## 场景一：消费 ZCode 免费体验包（`zcode-free` 联动 CreditDaddy）

### 1. 架构原理

ZCode 经常发放 Start Plan、Trust Build 以及周末狂欢额度（如 GLM-5.3-Flash 数亿 Token），这些额度只挂接在 `zcode.z.ai` 的内部 Plan 接口上。直接调用该接口会被阿里云滑块风控拦截（HTTP 400 `{"code":3007,"msg":"captcha verify failed"}`）。

为了在**不违规暴力破解或伪造指纹**的前提下合规消费此额度，10Router 与 **CreditDaddy 桌面版** 建立了无缝协同网关：
- **CreditDaddy**：负责账户会话维护，并在需要时通过静默窗口完成验证码交互，本地暴露无鉴权的 `POST http://127.0.0.1:47860/gateway/zcode/v1/messages`（与 MiniMax 线的 `/gateway/minimax/v1/messages` 同形）；
- **10Router (`zcode-free`)**：内置该体验包供应商，配置驱动转发请求，支持局域网分布式部署。

```
[Claude Code / Cursor / CLI]
          │
          ▼
   10Router Gateway (/v1/chat/completions)
          │
          ▼
   zcode-free 供应商 (open-sse)
          │ (转发 Anthropic 协议)
          ▼
   CreditDaddy 桌面版 (http://127.0.0.1:47860)
          │ (静默验证码 + 账号轮换)
          ▼
   zcode.z.ai (官方体验套餐端点)
```

### 2. 配置步骤

#### 第一步：准备 CreditDaddy 桌面版
1. 启动 CreditDaddy 桌面端，在账号管理中登录并绑定 ZCode 账号；
2. 确认 CreditDaddy 面板中的「体验包接口 / 额度网关」已开启，默认监听端口为 `47860`。

#### 第二步：在 10Router 中启用 `zcode-free`
1. 打开 10Router 仪表盘，进入 **「提供商」** 页面；
2. 在「体验」分类或「所有提供商」中找到 **ZCode Free** 卡片；
3. `zcode-free` 属于 `noAuth` 供应商，**无需添加连接凭据**，开箱即用；
4. **配置主机（可选）**：
   - 如果 10Router 与 CreditDaddy 运行在**同一台电脑**：网关主机保持留空即可（默认使用 `http://127.0.0.1:47860`）；
   - 如果 10Router 部署在 **NAS / 局域网服务器**，而 CreditDaddy 运行在 Windows/Mac 宿主机：点击卡片设置，在「网关主机」中填写宿主机局域网地址（如 `192.168.31.50:47860`）。

> **局域网部署必读（ZCode 线与 MiniMax 线同）**
>
> CreditDaddy 的网关**不校验任何 key**，它由 **IP 白名单**保护。因此远程访问时，10Router 侧**不需要**为它创建带 key 的连接（旧版卡片文案曾这么写，是错的），只要在 CreditDaddy 面板里放行即可：
>
> 1. 在本卡片「CreditDaddy 网关主机」填入 CreditDaddy 所在机器的 IP（端口默认 `47860`）；
> 2. 在 CreditDaddy 同一面板里打开「允许局域网访问 / Allow LAN access」；
> 3. 把**本 10Router 机器的 IP** 加入其白名单；
> 4. **重启 CreditDaddy**——该开关是启动时读取的，不重启不生效。
>
> 路径输入框显示的是**实际生效的路径**（默认 `/gateway/zcode/v1/messages`，MiniMax 线为 `/gateway/minimax/v1/messages`，Trae 线为 `/gateway/trae/v1/messages`），与后端 `auth.js` 的内置兜底一致。CreditDaddy 侧统一按品牌分线，**只有这三个形状的端点存在**；留空即用默认，一般不需要改。旧版的裸端点 `/gateway/v1/messages` 已随 CreditDaddy 迁移移除，若 10Router 返回 **404**，先确认填的路径带品牌段（`/gateway/zcode/…`），以及 CreditDaddy 版本是否已升到迁移之后。

#### 第三步：调用模型
通过 10Router 标准 OpenAI 兼容端点调用：
- 模型 ID：`zcode-free/glm-5.3-flash`
- 请求端点：`http://127.0.0.1:20127/v1/chat/completions`

> **提示**：10Router v1.3.0 优化了 Token 展示口径，对于 zcode-free 这类高缓存命中（~99%）的流，输入 Token 与缓存 Token 不再出现 1:1 的失真显示。

---

## 场景二：接入 ZCode 正式订阅套餐（Coding Plan）

如果你购买了智谱官方的 ZCode Coding Plan 订阅套餐，其背后是具有独立开发者资质的标准 API 凭据，**完全不受 3007 验证码限制**。

### 1. 获取 Coding Plan 专用 API Key
1. 访问智谱大模型开放平台（[open.bigmodel.cn](https://open.bigmodel.cn)）并使用与 ZCode 相同的手机号/账号登录；
2. 进入「API Keys / 密钥管理」；
3. 查找自动创建的 `zcode-api-key` 或新建一个密钥，获取格式为 `id.secret`（例如 `1234567890abcdef.xxxxxxxxxxxx`）的 API Key。

### 2. 在 10Router 中添加节点
可以直接使用 10Router 内置的 **GLM-CN（智谱 AI）** 供应商或通过 **自定义提供商** 接入：
- **供应商类型**：`glm-cn` 或 `OpenAI-compatible`；
- **Base URL**：
  - OpenAI 格式：`https://open.bigmodel.cn/api/coding/paas/v4`
  - Claude 格式：`https://open.bigmodel.cn/api/anthropic`
- **API Key**：填入获取到的 `id.secret` 密钥；
- **可用模型**：`glm-5.3`、`glm-5.3-flash`、`glm-5.2`、`glm-4.7` 等全系列编码模型。

---

## 场景三：将 ZCode 客户端反代至 10Router 统一网关

如果你希望在 ZCode IDE 客户端内享受 10Router 提供的全模型路由、多账号备灾以及模型组合（Combo）：

### 1. 在 10Router 中创建访问密钥
1. 进入 10Router 仪表盘 → **「访问密钥 (API Keys)」**；
2. 点击「创建密钥」，生成一个格式为 `sk-...` 的网关密钥（例如 `sk-10r-my-zcode-key`）。

### 2. 在 ZCode 客户端中配置代理端点
1. 打开 ZCode 客户端设置；
2. 找到 **模型提供商 (Model Providers)** 或 **自定义端点 (Custom Endpoint)** 配置；
3. 添加新节点：
   - **Provider Name**：`10Router`
   - **API Base URL**：`http://127.0.0.1:20127/v1`（若 10Router 运行在 NAS 上，填写 `http://192.168.31.101:20127/v1`）
   - **API Key**：填入在 10Router 生成的 `sk-...`
4. 勾选需要使用的模型，例如 `claude-3-7-sonnet`、`deepseek-v4.1-flash`、或者你在 10Router 中配置好的 Combo（如 `auto-coding`）。

---

## 场景四：本地用量与账本双向同步

通过安装官方配套插件 **`10router-sync`**，可以将 ZCode 客户端本地产生的模型推理消耗实时回流到 10Router 用量仪表盘中：

1. **插件能力**：
   - 自动识别 ZCode 客户端本地的 `~/.zcode/` 历史账本；
   - 智能识别官方套餐渠道 ID（包括 `account:bigmodel-start-plan` 与历史 `builtin:` 形态）；
   - 自动补齐缺失的模型预估计价（不会覆盖原库已算好的成本）；
   - 严格防止多端同步签名漂移导致的重复行事故。
2. **执行同步**：
   - 在已配置的环境中直接运行：
     ```bash
     zcode /10router-sync:sync-usage
     ```
   - 或使用 CLI 统一导入端点 `POST /api/settings/database/import-usage`。

---

## 常见问题排查与避坑指南

### 1. 为什么直接请求 `zcode.z.ai` 会报 400 / 3007 错误？
- **现象**：终端报错 `{"code":3007,"msg":"captcha verify failed"}`。
- **原因**：ZCode 免费体验套餐端点具备网页级防刷验证码策略，普通 HTTP 客户端缺少合法的滑块校验 Token。
- **解法**：请勿尝试暴力模拟指纹。请使用 **场景一** 方案，借助 CreditDaddy 桌面版作为本地网关中继，10Router 原生 `zcode-free` 模块即可平滑处理。

### 2. CodeBuddy / ZCode 出现 11128 报错怎么办？
- **现象**：`reason=invalid_request status=400 / 11128`。
- **原因**：这是上游渠道级的风控拦截（与请求的内容特征和上下文极端体积相关），换同渠道账号通常无效。
- **10Router 的保护机制**：10Router 内置了 `channelScope` 渠道熔断保护，单次命中 11128 即刻暂时冷冻整个渠道，避免盲目重试把整个账号池全部打死；建议用户开新会话或利用 10Router 的上下文自动压缩功能。

### 3. 输入 Token 数量与缓存 Token 数量显示完全一样？
- **原因**：在 v1.2.1 及更早版本中，未折叠的 Claude usage 结构把 `prompt_tokens` 视作不含缓存的值，导致视图层在 `prompt < cache` 时直接用缓存值顶替输入值。
- **解法**：v1.3.0 已引入 `usageDisplay.js` 标准归一化，已完全修复该统计视觉偏差。
