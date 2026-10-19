# 用 Agent 给 10Router 添加自定义供应商（运行时操作指南）

本指南面向 **AI Agent（Hermes / Claude Code / 其他）**，说明如何**不改源码、不重打包**，
直接对一台**正在运行**的 10Router 调内部 API，把一个自定义
OpenAI-compatible / Anthropic-compatible 上游（baseUrl + 自己的 API key + 模型）注册成可路由节点。

> 适用：例如用户拿到的某个 `sk-xxx` + baseUrl + 模型列表，不是 10Router 内置供应商，
> 想临时/自助加进去用 `/v1/*` 统一路由。免改代码、加完立即生效。

---

## 1. 先搞清楚三件事

| 项 | 值 | 说明 |
|----|-----|------|
| **目标实例地址** | `http://<IP>:20127` | NAS 上 fnOS appcenter 部署为 **20127**（本文示例）。本机 dev/start 默认是 20128，按实际实例改 |
| **API 认证** | CLI token **或** dashboard LLM API key | 见下节 |
| **模型路由前缀** | 自定义节点模型必须是 `{prefix}/{model}` | 不能用裸模型名（会撞内置 provider） |

---

## 2. 认证：CLI token 或 dashboard LLM key

`/api/provider-nodes` 与 `/api/providers` 走 dashboardGuard 保护，默认需 CLI token 或登录 JWT。

### 方式 A：CLI token（在 NAS 本机推演）

```bash
MID=$(cat /vol4/@appdata/10router/machine-id)
SEC=$(cat /vol4/@appdata/10router/auth/cli-secret)
CLI_TOKEN=$(echo -n "${MID}9r-cli-auth${SEC}" | sha256sum | cut -c1-16)
```

> 规则：`sha256(machine-id + "9r-cli-auth" + cli-secret).slice(0,16)`，salt 固定 `9r-cli-auth`（salt 参与哈希，改名会让所有 token 失效，故保留旧值）。
>
> **放在请求头 `x-10r-cli-token` 里，不是 `Authorization: Bearer`**——guard 只从该头读 CLI token，
> 塞进 Bearer 会被当成 LLM key 校验而 401。旧名 `x-9r-cli-token` 服务端仍兼容（老版 CLI/插件），新代码用新名。

验证（NAS 上走 loopback）：
```bash
curl -s -H "x-10r-cli-token: ${CLI_TOKEN}" http://127.0.0.1:20127/api/provider-nodes
```

### 方式 B：dashboard LLM API key（agent 自助添加的意图所在）

仅 **`POST /api/provider-nodes` 与 `POST /api/providers` 的根路径**放行 dashboard LLM API key
（`apiKeys` 表的 key，agent 本就持有）；GET/PUT/DELETE 及 `[id]` 子路由仍需 CLI token/JWT。
这是本功能开放给 agent 自助添加的豁免点，不要用于别的写操作。

```bash
curl -s -X POST http://<IP>:20127/api/provider-nodes \
  -H "Content-Type: application/json" -H "Authorization: Bearer <DASHBOARD_LLM_KEY>"
```

---

## 3. 两步注册流程

10Router 把「自定义兼容节点」拆成两步：先建 **node**（定义 baseUrl / prefix / 类型），
再建 **connection**（填上游 API key 并关联 node）。

### 第 1 步：建 openai-compatible node

```bash
curl -s -X POST http://<IP>:20127/api/provider-nodes \
  -H "Content-Type: application/json" -H "x-10r-cli-token: ${CLI_TOKEN}" \
  -d '{
    "name": "JustWorker",
    "prefix": "justworker",
    "apiType": "chat",
    "baseUrl": "https://api.justwoker.icu/v1",
    "type": "openai-compatible"
  }'
# → {"node":{"id":"openai-compatible-chat-<uuid>","prefix":"justworker",...}}
```

字段：
- `name` — 显示名
- `prefix` — **小写、全库唯一**，作为模型路由前缀
- `apiType` — `chat` | `responses`
- `baseUrl` — 上游 OpenAI-compatible 根地址
- `type` — `openai-compatible` | `anthropic-compatible` | `custom-embedding`

### 第 2 步：加 connection（填上游 key 并关联 node）

```bash
curl -s -X POST http://<IP>:20127/api/providers \
  -H "Content-Type: application/json" -H "x-10r-cli-token: ${CLI_TOKEN}" \
  -d '{
    "provider": "openai-compatible-chat-<uuid>",
    "apiKey": "sk-UPSTREAM_KEY",
    "name": "JustWorker",
    "priority": 1
  }'
# → {"connection":{"id":"...","providerSpecificData":{prefix,apiType,baseUrl,nodeName}}}
```

- `provider` 传 **第 1 步返回的 node 完整 id**（以 `openai-compatible-` 等开头）
- `apiKey` 是**上游自己**的 key
- 连接创建后，API 自动从 node 带出 prefix / apiType / baseUrl

> 两步都可带 dashboard LLM key 认证（见 2 方式 B）。

---

## 4. 模型路由：必须带 `{prefix}/` 前缀

**自定义兼容节点的模型 ID 是 `{prefix}/{model}`，不能用裸模型名。**

尤其 Claude 系模型（`claude-opus-5` / `claude-opus-5-thinking`）裸名会命中 10Router **内置
anthropic** provider 而报 `No active credentials for provider: anthropic`，与你的自定义节点冲突。用：

```
justworker/claude-opus-5            → 路由到 JustWorker
justworker/claude-opus-5-thinking
```

实测 `POST /v1/chat/completions` + `Authorization: Bearer <LLM key>` 成功返回 Claude 响应
（含 signature/reasoning，是 Claude thinking 特征）。

---

## 5. 添加前先对上游自测（避免注册后才暴露 key/baseUrl 无效）

```bash
# 1) 列模型 —— 应返回模型 id 列表
curl -s https://api.<host>/v1/models -H "Authorization: Bearer sk-..."

# 2) 最小对话 —— 返回 200 才算可用
curl -s -X POST https://api.<host>/v1/chat/completions \
  -H "Content-Type: application/json" -H "Authorization: Bearer sk-..." \
  -d '{"model":"<model>","messages":[{"role":"user","content":"hi"}],"max_tokens":10}'
```

- 模型 id 以实际返回为准（用户口述可能不一致）
- 上游可带 `supported_endpoint_types` 提示 openai / anthropic 双格式

---

## 6. 端到端示例（一次跑通）

```bash
# 0) 变量
IP=192.168.31.101           # NAS 上 10router
MID=$(ssh yangyu@$IP 'cat /vol4/@appdata/10router/machine-id')
SEC=$(ssh yangyu@$IP 'cat /vol4/@appdata/10router/auth/cli-secret')
TOKEN=$(echo -n "${MID}9r-cli-auth${SEC}" | sha256sum | cut -c1-16)

# 1) 建 node
NODE=$(curl -s -X POST http://$IP:20127/api/provider-nodes \
  -H "Content-Type: application/json" -H "x-10r-cli-token: $TOKEN" \
  -d '{"name":"MyGW","prefix":"mygw","apiType":"chat","baseUrl":"https://gw.example.com/v1","type":"openai-compatible"}')
echo "$NODE"
NODE_ID=$(echo "$NODE" | python3 -c 'import sys,json;print(json.load(sys.stdin)["node"]["id"])')

# 2) 加 connection
curl -s -X POST http://$IP:20127/api/providers \
  -H "Content-Type: application/json" -H "x-10r-cli-token: $TOKEN" \
  -d "{\"provider\":\"$NODE_ID\",\"apiKey\":\"sk-UPSTREAM_KEY\",\"name\":\"MyGW\",\"priority\":1}"

# 3) 验证路由（模型必须带前缀）
curl -s -X POST http://$IP:20127/v1/chat/completions \
  -H "Content-Type: application/json" -H "Authorization: Bearer <dashboard_llm_key>" \
  -d '{"model":"mygw/<upstream-model>","messages":[{"role":"user","content":"hi"}]}'
```

---

## 7. 注意事项

- **本地测试不要用来判断「鉴权保护边界」**：从 NAS 自身 `127.0.0.1` 或跨机访问，dashboardGuard
  对 loopback 有 `isLocalRequest` 特判。要验证 POST 豁免是否真的 401，应从**非 loopback**
  （如 `192.168.31.101:20127`）用无效 key 测，确认真被拒。
- 运行时加 node/connection 后**无需重启**，对后续 `/v1/*` 请求立即生效。
- 两步都要 POST **根路径**（不是 `[id]` 子路由）；子路由仍走 CLI token/JWT，别指望 LLM key 能删改。
- 这是**自定义运行态节点**，有别于「改 `open-sse/providers/registry/` 源码 + 重打包内置供应商」：
  前者免重发、适合临时/自建网关；内置要跟着版本发布走。

---

## 参考

- 运行态 API 鉴权细节 / dashboardGuard 豁免见项目仓库 agent 操作记录
- `docs/zh-CN/ARCHITECTURE.md` — 系统总体架构与数据模型
