# mirasim 桌面端本地用量账本（数据源参考）

> 整理自 2026-09-10 / 09-11 Windows 本机实测验证。供 10router-sync 插件 `--source mirasim`
> （v1.1.0，commit 33bb8f9e）与「10Router 侧疑似 mirasim 孪生行」类排查参照。
> 相关：[mirasim-dsh-toolcall-loss.md](./mirasim-dsh-toolcall-loss.md)（mirasim 内嵌 dsh 的上游 bug，另一话题）。

## 账本位置与结构

**逐调用账本（最权威）**：`~/.mirasim/insights/usage-YYYY-MM.ndjson`，按月分文件。
每行一次模型调用，JSON 字段：

| 字段 | 说明 |
|---|---|
| `ts` / `id` | 时间戳；`id` 全局唯一（`uuid:uuid`），跨月去重键 |
| `agent` | claude / codex / kimi（**没有 zcode**，见下） |
| `model` / `provider` | 裸模型名（无 provider 前缀，见「识别信号」）；协议 anthropic / openai-responses / openai-chat |
| `upstreamHost` | `relay.mirasim.ai` 或 null(=local)；**指向 10Router 时是 IP/localhost——防双计的关键字段** |
| `leg` / `viaRelay` | relay / direct；`viaRelay:false` + `leg:"direct"` 与 upstreamHost 组成「走了 10Router」信号 |
| `status` / `durationMs` | HTTP 码 / 耗时；status ≥ 400 的失败调用 token 全 0 |
| token 五项 | `input` / `output` / `cacheRead` / `cacheWrite` / `reasoning`。**`input` 是净新增输入，不含缓存**——三协议腿实测绝大多数行 `cacheRead > input`（anthropic 全量 110K vs 缓存读 4.71 亿；openai-chat 1651 万 vs 1.23 亿；openai-responses 584 万 vs 1.45 亿）。真实输入 = `input + cacheRead + cacheWrite`。10router-sync v1.5.0 起转换器按此口径落 `prompt_tokens`；存量行由 `scripts/normalize-mirasim-input.mjs` 订正（2026-09-24 双库执行，delta 本机 115 万 / NAS 7.86 亿） |
| `reqBytes` / `resBytes` | 请求/响应字节数 |
| `repo` / `workspace` / `effort` / `agent` | 工作区与推理档溯源 |
| `relayCallId` | 中转回填的对账键 |

## 其他 insights 文件（不是用量源，勿混淆）

- `analytics/events-*.ndjson` —— 产品遥测；`turn.finish` 只有时长/TTFB，无 token。
- `traffic/<session>/index-*.ndjson` —— 请求原始索引，有完整 path 字段（排查请求形态时有用）。
- `session-usage-*.ndjson` —— 会话汇总。

## ZCode agent 不在 insights 账本里

insights 只记 claude / codex / kimi；zcode 走 `.mirasim/zcode/h-*` 目录，**无 token 账本**。
两边用量数字对不上是预期行为，不是丢数据。

## 「走了 10Router」的识别信号（易踩的坑）

- `model` 字段**没有** provider 前缀（全是裸名如 `cbcn/glm-5.3-flash`、`claude-opus-5`），
  **不能**用模型名判断流量去向。
- 可靠信号：`upstreamHost`（指向 10Router 时是 IP/localhost）+ `viaRelay:false` + `leg:"direct"`。
- 反向（10Router 侧识别 mirasim 来源）：10Router 网关自己**不感知客户端类型**——db 里
  `provider=mirasim-anthropic` / `endpoint=mirasim://claude` 的行是**同步导入器写的标记**，
  不是网关记的。2026-09-11 曾疑似「10r db 里 8-27 的 20 行 mirasim-anthropic 与 mirasim
  账本孪生」，实为 E2E 测试导入的样本（`meta.imported:true` 可辨），非 10Router 自记账。

## 防双重计数（导出侧排除，commit 2b38f89f）

mirasim 的 agent 可能指向一个 10Router 节点——同一笔调用在两本账里**签名永不碰撞**
（10Router 侧 provider=mirasim endpoint；mirasim 侧 upstreamHost=IP、provider=anthropic），
**服务端行签名去重救不了，必须在导出侧排除**。规则（`isSelfHostedUpstream()`）：

`upstreamHost` 命中 loopback/私网（127/10/192.168/172.16-31/localhost）且
（端口 ∈ {20127, 20128, 80, 443} **或** host 与导入目标 endpoint 同机）→ 跳过。

- matcher 12 用例单测覆盖；当时真实数据零误伤（1449 行全是 relay.mirasim.ai）。
- 已知边界：**非标准端口的异机私网 10Router 会被漏掉**，靠导出日志的 skipped 计数暴露。
- 离线 `--export` 模式无法对比 endpoint，只按端口判定。

## 量级与 UI 参考

- 实测量级：2 个月约 2000 有效调用，cacheRead 4 亿+ token。
- 桌面 App 自带用量 UI（「Token 用量走势」「云端用量与路由」，web bundle
  `app/<ver>/web/assets/index-*.js` 确认）。
