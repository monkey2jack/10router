# CodeBuddy CN (codebuddy-cn) Upstream Error Codes — Reference & Fixes

> Purpose: When troubleshooting the 10Router CodeBuddy channels (`codebuddy-cn`, alias `cbcn`, upstream `https://copilot.tencent.com`; and `codebuddy-intl`, alias `cbai`, upstream `https://www.codebuddy.ai`), consult this table first to classify the error — **code bug (fixable)** vs **intermittent risk-control** vs **upstream/client format defect** — so you don't chase config changes on a 400. **The code space is shared by both channels** (`11102`/`11133`/`11134`/`11140` all observed on intl too); differences are called out inline.
> Maintained: 2026-09-16, adding the 11128 channel-level circuit breaker rework and the 11140 account-level block. Full per-code details live in the docs listed in "Related docs".

## 1. Error-code quick table

| Code | HTTP | Message (excerpt) | Nature | Owner | Fix / path |
|------|------|-------------------|--------|-------|-----------|
| `11101` | 400 | Non-stream chat request is currently not supported | code bug (fixable) | executor | force `stream=true` (CodeBuddy is stream-only); 10router aggregates SSE→JSON for non-stream clients |
| `11128` | 400 | Illegal API invocation from an unapproved channel | **channel-level risk-control (intermittent)** | server | 10router now trips a **channel-level circuit breaker** (no per-account retry walk); not config-fixable — wait out the window or switch channel. See section below |
| `11133` | 400 | the request parameters were rejected by the model provider (`model_param_invalid`) | mostly client/upstream defect | mirasim/upstream | bisect request-side vs response-side; workaround = use hy4. See related docs |
| `11134` | 500 | the model provider is temporarily unavailable, please retry later or switch… | upstream temporarily unavailable | upstream | wait for the upstream-reported reset; **this is NOT a catalog error — do not delist the model**. See section below |
| `11140` | 403 | `{"code":11140,"msg":"request illegal","requestid":"…"}` | **account-level risk-control** | server | nothing local helps — quota endpoint still 200, independent of shape/model/proxy; wait or rotate account. See section below |
| `11150` | 400 | reasoning effort value is not supported by the current model | code bug (fixable) | executor | DeepSeek rejects `auto`/`off` → request-side `auto→high`, `off→drop` (commit `167f272f`) |
| `11151` | 400 | assistant carries reasoning | upstream format | upstream | upstream validation on assistant-carried reasoning; avoid that request shape |
| `6004` | 429 | 使用量已超出频率限制，将于…重置 | quota rate-limit | server | auto-recovers per CodeBuddy reset time; normal quota consumption |
| `401` | 401 | 鉴权服务请求失败 | token/network | upstream | usually one-off timeout; retry; persistent → check token |
| `402` | 402 | (billing) | balance/quota | upstream | account balance/free quota exhausted; top up / rotate |

> Mnemonic: **`11150`/`11101` = code fixable; `11133` = client serialization/upstream format (10router can mostly only mitigate); `11134` = upstream temporarily not serving (**recognizes the id — do not delist**); `11128` = channel-level risk-control (not a bug, request-burst related); `11140` = account-level risk-control (whole channel blocked for that account, wait/rotate); `6004`/`429` = quota limit (wait for reset).**

## 2. Per-code details & fixes

### 11101 — Non-stream not supported (fixable)
CodeBuddy upstream only accepts streaming (HTTP 400 code 11101). `CodeBuddyExecutor.transformRequest` forces `stream=true`; 10router aggregates SSE→JSON for non-streaming clients.
- Location: `open-sse/executors/codebuddy-cn.js`

### 11128 — unapproved-channel security-policy block (channel-level, don't over-edit)
CodeBuddy server **security policy** blocks requests it deems "from an unapproved channel". Key points:
- **Channel is not broken**: same account+model in native `openai→openai` small requests can run green hundreds of times.
- Trigger correlates with single-request shape; observed:
  - `FMT: claude→openai` (Claude client translated into CodeBuddy); successful batches were mostly `openai→openai`
  - **high tool-count (e.g. 54 vs ~31 on successful batches)** — the more tools, the more likely the security heuristic flags agent-abuse
  - huge context (500+ MSG) — **2026-09-17 Win addition: a single real-world mega-session also trips it**: `1676 MSG · 54 TOOL · THINK:high` with a **4.5MB** request body (real tool results) got 11128 on a lone account, while a **126KB** session from the same account went straight 200 ten minutes later. Note the earlier NAS "single requests always 200" verdict was measured with **synthetic** filler shapes — a real multi-turn session's size/content density is a different ballpark. **Volume itself is a trigger dimension**, not only multi-account bursts.
  - account under quota pressure (accompanied by 429 `6004` / modelLock)
- **Not about account/format/model being banned** (glm/hy/deepseek all hit it at 54 tools; the same two accounts go straight 200 on a 31-tool deepseek).
- **Not 10router-config fixable** (no missing header/key); path = wait out the breaker window / reduce request shape (fewer tools/messages) / switch channel.
- Memory: `11128 = channel-level risk-control; wait for the breaker or switch channel`.
- Community: workbuddy/codebuddy reverse-proxy projects (codebuddyapi-proxy, workbuddy2api) hit it too — not specific to this project.

#### 2026-09-16 re-verification: this is a **channel** property, and the per-account retry walk amplifies it

Re-measured on the production instance (NAS):

| Experiment | Result |
|---|---|
| Direct upstream, same account: `1MSG` / `31TOOL` / `54TOOL` / `1752MSG+54TOOL` | **all 200** |
| Per-account (4), replaying the real failing shape `5MSG+54TOOL` (incl. ZCode-identity system prompt) | **all four accounts 200** |
| Account distribution of 11128 in the log | `1697(12) / 1698(10) / 余师洋(4) / 洋芋(5)` |
| 11128 probe latency | 323–654ms (upstream **fast reject**, not a timeout) |

**The key scene** — when it hits, the log looks like:

```
[22:39:01] ▶ POST cbcn/hy4-preview · 5 MSG · 54 TOOL · ACC:余师洋
[22:39:01] ✗ ERROR 400 · 475ms → 11128
[22:39:01] [FALLBACK] ⇄ ACC:余师洋 UNAVAILABLE (400) → NEXT ACCOUNT
[22:39:01] ▶ POST cbcn/hy4-preview · 5 MSG · 54 TOOL · ACC:1698
[22:39:02] ✗ ERROR 400 · 654ms → 11128
... 1697 → 洋芋 same 11128 (total <2s, then "all 4 accounts locked")
```

**Conclusion (revising the earlier "single-request shape" reading)**:
- A single request (ZCode / dsh / 1 MSG / 54 TOOL) **always returns 200 direct** → not a bad account, not a bad model, **and not a ZCode-entry signature** (a ZCode-identity system prompt passes straight through too).
- Failures only appear **as a burst when several accounts are hammered with the same model inside one second** → an **egress/burst fingerprint** triggering channel-level policy; the account-fallback walk is exactly the amplifier.

#### 10router's handling: channel-level circuit breaker (since v1.1.2)

- `open-sse/config/errorConfig.js`: the two 11128 rules carry `channelScope: true`; `checkFallbackError` surfaces the flag.
- `markAccountUnavailable`: a `channelScope` error adds **no per-account `modelLock`** (it only records `lastError` for the dashboard), and returns `channelScope: true`.
- `src/sse/handlers/chat.js`: on `channelScope` it **aborts account fallback immediately** and sets a provider-level breaker in `settings.channelBlocks[provider]` — **60s for the first offence, escalating to 10min on a repeat within 5min**; while blocked it returns 503 + `Retry-After` without touching upstream. **Any successful request clears the breaker immediately.**
- **Interaction with earliest-expiry quota refresh**: the SWR refresh is **skipped while the breaker is active** (an extra upstream call only slows recovery when the channel is being rejected wholesale); once a breaker has actually been in force, a successful request runs `invalidateQuotaCache(provider)` (see `src/sse/services/auth.js`) so the next account selection refetches `earliestPackageExpiry` — the breaker window may have crossed a package boundary, so earliest-expiry ordering must not rank on pre-breaker data.
- Effect: upstream calls during a 11128 hit drop from "4/sec × replaying every 30s" to "1 / 60s", and the four accounts are no longer wrongly locked (other models are unaffected).

> When diagnosing, **first check whether the hits are a burst** (multiple accounts, same model, same second): if so, it's the channel breaker's domain — don't go digging into individual accounts. Only if one account hits 11128 continuously *while the others are fine* should you work at the account level.

### 11133 — request parameters rejected (model_param_invalid)
CodeBuddy's vague expression for "parameters don't meet model requirements" (`extError.code` mostly `400001`/`model_param_invalid`). Past investigations found two real root causes:
1. **Response-side empty name (10router fixable)**: codebuddy splits one tool call into two streamed tool_calls; later chunks repeat `function.name:""`. Clients overwrite the accumulated name with the empty one → `unknown tool ""` → resends an empty-name request → 11133. Fix: `open-sse/utils/stream.js` PASSTHROUGH branch deletes the empty `name` (commit `48e39b44`).
2. **Request-side name dropped (10router can't fix)**: the client (e.g. **mirasim**-hosted dsh) serializes assistant tool_calls with an empty name itself; 10router's `ensureToolCallIds` only fills `id`, never fixes `name` → empty name reaches CodeBuddy. Workaround: use **hy4-preview** (mirasim serializes it correctly), or return a friendly error from 10router.
3. **Multi-turn trigger**: single-turn (15-17 MSG) is fine; **multi-turn (54 MSG)** surfaces a historical tool_calls/tool mismatch. Diagnostic: repro on **official DeepSeek** for a clear error ("assistant message with 'tool_calls' must be followed by tool messages…") to pin the real root cause.

### 11134 — model provider temporarily unavailable (upstream transient state, not a catalog issue)

Original: `the model provider is temporarily unavailable, please retry later or switch [to another model]`, HTTP **500**.

**Observed on CodeBuddy international (2026-09-11)**: `gpt-6-astra` returned this code 3 times in a row, while the same id had probed **200** earlier — i.e. the same model oscillates between "available/not available", an upstream-side transient state independent of 10router's catalog, auth, or request shape.

**Discriminator (to avoid wrongly delisting models)**: a catalog-level error is `11102` (`model service info not found`, **400**) — that is "the upstream does not recognize this id". `11134` means **the upstream recognizes the id but is temporarily not serving it**. Therefore:

- **Do NOT** remove the model from the registry just because it fails for a while (that is the whole point of distinguishing `11102` from `11134`);
- on the 10router side, cool down / retry per the upstream-supplied reset seconds, or fall back to another model;
- same family as `gemini-3.5-flash`'s `429 / code 14003`: **a transient account or upstream state is not a catalog error** (see the header notes (2)/(3) in `open-sse/providers/registry/codebuddy-intl.js`).

### 11140 — account-level risk-control blocks the whole channel (first reported on intl 2026-09-12)

HTTP **403**, code `11140`, original: `{"code":11140,"msg":"request illegal","requestid":"…"}`. An **account-granularity** block of the entire chat endpoint for that channel — unlike `11128` (request-burst related, self-healing), once `11140` hits, **all models and all request shapes return 403 continuously**.

> ⚠️ Copy trap: `msg: "request illegal"` reads like "this request is illegal", which lures you into bisecting request shapes — **that's a dead end**. Measured: any model, any shape, continuously 403 on that account; `request illegal` actually means "**this account's requests are rejected wholesale**". Treat 11140 as an account problem immediately.

**First case (community member, intl/cbai)**: last success 09-12 00:51, first 11140 at 07:59, still 403 at 08:42. Local causes systematically excluded:

| Hypothesis | Evidence against |
|---|---|
| Bad account/token | ✗ quota endpoint still returns 200 |
| Request shape rejected | ✗ bisected 12 request shapes, all 403 |
| Proxy/egress banned | ✗ same on both the 20171 and socks5 egresses |
| Single model banned | ✗ not model-specific — all models 403 |
| Code bug | ✗ reproduced identically on local v1.1.0 intl channel |

**Conclusion and path**: an upstream account-level risk-control; nothing local can be changed — **wait it out or rotate the account**. Do not touch the catalog over it (the model ids themselves were not flagged).

**Suspected trigger (not confirmed, recorded only)**: that account had **two connections, one via Google and one via GitHub OAuth, on the same instance** — both OAuth entries registered to the same email are in fact **the same CodeBuddy account** (the two connections' JWT `sub` and `refreshToken` are identical). Polling/failover alternated between the two connections hitting the same account, suspected of amplifying the risk-control signal. **A single sample cannot establish causation**, but it surfaces a general trap:

> ⚠️ **Same email + two OAuth providers = one account, not redundancy**. intl supports Google / GitHub OAuth login; authorizing the same email through both entry points creates two "seemingly independent" connections, but the account, quota pool, and risk-control state are entirely the same — multi-account failover **silently fails** here. How to tell: compare the two connections' JWT `sub` (or refreshToken); if identical, it is the same account — delete one and add a genuinely different second account.

**Telling `11140` apart from `11128`**: `11128` recovers immediately with a different small request shape (single-request heuristic); `11140` returns 403 no matter the shape (the account is flagged). Bisect the shape once before deciding.

### 11150 — DeepSeek rejects reasoning_effort auto/off (fixable, committed)
CodeBuddy **DeepSeek-series models** support only `low/medium/high/xhigh/max/none`, **not `auto`/`off`**; GLM/Kimi support `auto`. dsh sends `THINK:auto` by default → forwarded verbatim → 400 `11150`.

Fix (commit `167f272f`, `open-sse/executors/codebuddy-cn.js`):
- deepseek + `auto` → map to `high`
- deepseek + `off` → drop the field (equivalent to `none`)
- other values / non-deepseek logic unchanged

### 11151 — assistant carries reasoning
CodeBuddy validation when an assistant message carries reasoning content. Upstream format constraint; avoid that request shape.

### 6004 / 429 — quota frequency limit
An account exceeding a model's usage cap returns `6004` (HTTP 429) with a reset time; auto-recovers. Normal quota consumption; 10router multi-account fallback switches to the next account automatically.

## 3. Diagnostic methodology (reusable across codes)
1. **Classify the code first**: read 10router.log — `11150`/`11101` fixable, `11133` mostly client/upstream, `11128` channel-level risk-control, `11140` account-level risk-control, `11134` upstream transient, `6004` wait for reset. Don't edit connection config on a bare 400/11128.
2. **Diff same-model failure vs success**: compare the `FMT / MSG / TOOL / THINK / ACC` fields; the difference is the suspect trigger.
3. **Is the channel dead?** If the channel serves other models right now (e.g. deepseek-v4-flash stream 200 continuously), the account/channel is alive — a single model/request is being blocked.
4. **Bisect request-side vs response-side**: `DEBUG_RAW_REQ` (chat.js entry) vs `DEBUG_CB_REQ` (end of transformRequest). Clean up afterwards (remove env + temp code, re-run `npm run build`).
5. **Repro an opaque error on provider B**: when A returns 11133 (empty param), repro on official DeepSeek for a clear message that pinpoints the root cause.
6. **Note the calling client**: NAS-direct dsh / mirasim-hosted dsh / codex / Claude Code take different paths with different root causes — ask/note which before diagnosing.
7. **Check whether the connections are genuinely multiple accounts** (especially important on intl): Google/GitHub OAuth on the same email = the same CodeBuddy account (identical JWT `sub`/`refreshToken`) — "two connections" is not redundancy, and failover/polling are both hitting one account and one risk-control state. See the `11140` section.

## 4. Related docs
- `11150` reasoning_effort → `docs/en|zh-CN/CodeBuddy-reasoning-effort-fix.md`
- `11128` channel-level risk-control + circuit breaker → this doc's 11128 section; historical case → skill `llm-api-channel-health/references/10router-codebuddy-11128-unapproved-channel.md`
- `11133` stream empty-name (response side) → skill `10router-dev/references/codebuddy-streaming-toolcall-empty-name.md`
- `11133` model-specific (hy4 vs deepseek) → skill `10router-dev/references/codebuddy-toolcall-model-specific.md`
- `11133` request-vs-response → skill `10router-dev/references/codebuddy-toolcall-request-vs-response.md`
- `11133` multi-turn + official-DS diagnostics → skill `10router-dev/references/codebuddy-toolcall-official-ds-multiturn.md`
- `11128` live test + onboardUser ownership → skill `10router-dev/references/codebuddy-intermittent-11128.md`
