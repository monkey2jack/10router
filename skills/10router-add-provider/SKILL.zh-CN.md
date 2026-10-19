---
name: 10router-add-provider
description: 给运行中的 10Router 自助添加自定义 OpenAI/Anthropic-compatible 上游供应商（baseUrl + 自己的 API key + 模型），不改源码、不重打包，加完立即生效。当用户想把某个自建网关 / sk-xxx / baseUrl 注册成可路由节点，或 agent 需要往 10Router 加自定义供应商时使用。
---

# 10Router — 自助添加自定义供应商

让 AI agent（或用户）对一个**正在运行**的 10Router 调内部管理 API，把一个自定义
OpenAI-compatible / Anthropic-compatible 上游（baseUrl + 自己的 key + 模型）注册成可路由节点。
**免改源码 / 免重打包，加完无需重启，对后续 `/v1/*` 请求立即生效。**

需要 `TENROUTER_URL`（以及可写管理的认证 key）。入口技能见
https://raw.githubusercontent.com/techysy/10router/main/skills/10router/SKILL.zh-CN.md

---

## 先确认三件事

| 项 | 说明 |
|----|------|
| **目标地址** | `$TENROUTER_URL`（本文管理 API 端口沿用部署默认，NAS/fnOS 常为 `:20127`，按实例调整） |
| **认证** | dashboard LLM key（管理操作见下）或部署者自己的 CLI token |
| **模型路由** | 自定义节点模型必须是 `{prefix}/{model}`，**不能用裸模型名** |

## 认证：dashboard LLM key（agent 自助添加的豁免）

仅 **`POST /api/provider-nodes` 与 `POST /api/providers` 的根路径**放行 dashboard LLM API key
（Dashboard → Keys 里的 key）。GET/PUT/DELETE 及 `[id]` 子路由仍需部署者 CLI token / 登录 JWT。

```bash
# 用 Dashboard 生成的 LLM key 即可发起两步注册
AUTH="Authorization: Bearer ${TENROUTER_KEY}"    # TENROUTER_KEY = dashboard LLM key
```

> 部署者也可在 NAS 上从 `machine-id` + `cli-secret` 推演 CLI token：
> `sha256(machine-id + "9r-cli-auth" + cli-secret).slice(0,16)`，salt 固定 `9r-cli-auth`。
> 放在请求头 `x-10r-cli-token` 里（不是 `Authorization: Bearer`）；改名前的老服务端读 `x-9r-cli-token`。
> 自定义数据的实际路径见你的 DATA_DIR（`~/.10router/` 或 fnOS 的 `/vol4/@appdata/10router/`）。

## 两步注册流程

10Router 把「自定义兼容节点」拆成两步：先建 **node**（定义 baseUrl/prefix/类型），
再建 **connection**（填上游 key 并关联 node）。

### 第 1 步：建 openai-compatible node

```bash
curl -s -X POST $TENROUTER_URL/api/provider-nodes \
  -H "Content-Type: application/json" -H "$AUTH" \
  -d '{
    "name": "JustWorker",
    "prefix": "justworker",
    "apiType": "chat",
    "baseUrl": "https://api.justwoker.icu/v1",
    "type": "openai-compatible"
  }'
# → {"node":{"id":"openai-compatible-chat-<uuid>","prefix":"justworker",...}}
```

字段：`name`(显示名) / `prefix`(小写唯一，模型路由前缀) / `apiType`(`chat`|`responses`) /
`baseUrl`(上游根地址) / `type`(`openai-compatible` | `anthropic-compatible` | `custom-embedding`)。

### 第 2 步：加 connection（填上游 key 并关联 node）

```bash
curl -s -X POST $TENROUTER_URL/api/providers \
  -H "Content-Type: application/json" -H "$AUTH" \
  -d '{
    "provider": "openai-compatible-chat-<uuid>",
    "apiKey": "sk-UPSTREAM_KEY",
    "name": "JustWorker",
    "priority": 1
  }'
# → {"connection":{"id":"...","providerSpecificData":{prefix,apiType,baseUrl,nodeName}}}
```

- `provider` 传**第 1 步返回的 node 完整 id**（以 `openai-compatible-` 等开头）
- `apiKey` 是**上游自己**的 key
- 连接创建后 API 自动从 node 带出 prefix / apiType / baseUrl

## 模型路由：必须带 `{prefix}/` 前缀

**自定义节点的模型 ID 是 `{prefix}/{model}`，不能用裸模型名。** 尤其 Claude 系模型
（`claude-opus-5`）裸名会命中 10Router **内置 anthropic** provider 而报
`No active credentials for provider: anthropic`，与自定义节点冲突。用：

```
justworker/claude-opus-5    → 路由到 JustWorker
```

实测 `POST /v1/chat/completions` + `Authorization: Bearer <dashboard key>` 成功返回
Claude 响应（含 signature/reasoning）。

## 添加前先对上游自测（避免注册后才暴露 key/baseUrl 无效）

```bash
curl -s https://api.<host>/v1/models -H "Authorization: Bearer sk-..."          # 应列模型 id
curl -s -X POST https://api.<host>/v1/chat/completions \
  -H "Content-Type: application/json" -H "Authorization: Bearer sk-..." \
  -d '{"model":"<model>","messages":[{"role":"user","content":"hi"}],"max_tokens":10}'  # 200 才算可用
```

模型 id 以实际返回为准（用户口述可能不一致）。上游可带 `supported_endpoint_types` 提示双格式。

## 端到端示例

```bash
# 0) 建 node
NODE=$(curl -s -X POST $TENROUTER_URL/api/provider-nodes \
  -H "Content-Type: application/json" -H "$AUTH" \
  -d '{"name":"MyGW","prefix":"mygw","apiType":"chat","baseUrl":"https://gw.example.com/v1","type":"openai-compatible"}')
NODE_ID=$(echo "$NODE" | python3 -c 'import sys,json;print(json.load(sys.stdin)["node"]["id"])')

# 1) 加 connection
curl -s -X POST $TENROUTER_URL/api/providers \
  -H "Content-Type: application/json" -H "$AUTH" \
  -d "{\"provider\":\"$NODE_ID\",\"apiKey\":\"sk-UPSTREAM_KEY\",\"name\":\"MyGW\",\"priority\":1}"

# 2) 验证路由（模型必须带前缀）
curl -s -X POST $TENROUTER_URL/v1/chat/completions \
  -H "Content-Type: application/json" -H "Authorization: Bearer ${TENROUTER_KEY}" \
  -d '{"model":"mygw/<upstream-model>","messages":[{"role":"user","content":"hi"}]}'
```

## 注意

- **loopback 特判**：从部署机自身 `127.0.0.1` 访问，dashboardGuard 对 loopback 有 `isLocalRequest`
  特判。要验证 POST 豁免是否真的 401，应从**非 loopback** 用无效 key 测，确认真被拒。
- 运行时加 node/connection 后**无需重启**。
- 两步都 POST **根路径**（非 `[id]` 子路由）；子路由仍走 CLI token/JWT。
- 这是**自定义运行态节点**，区别于「改 `open-sse/providers/registry/` 源码 + 重打包内置供应商」：
  前者免重发、适合临时/自建网关；内置要跟着版本发布走。
