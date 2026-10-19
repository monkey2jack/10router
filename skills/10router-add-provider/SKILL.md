---
name: 10router-add-provider
description: Self-serve adding a custom OpenAI/Anthropic-compatible upstream provider (baseUrl + its own API key + models) to a running 10Router — no source change, no repackage, live immediately. Use when the user wants to register a self-hosted gateway / sk-xxx / baseUrl as a routable node, or an agent needs to add a custom provider to 10Router.
---

# 10Router — Add a Custom Provider (Self-Serve)

Lets an AI agent (or user) call the internal management API of a **running** 10Router to
register a custom OpenAI/Anthropic-compatible upstream (baseUrl + its own key + models) as a
routable node. **No source change / no repackage, no restart needed — live for subsequent `/v1/*` requests immediately.**

Requires `TENROUTER_URL` (and an admin-capable auth key). Entry skill:
https://raw.githubusercontent.com/techysy/10router/main/skills/10router/SKILL.md

---

## Confirm three things first

| Item | Notes |
|------|-------|
| **Target URL** | `$TENROUTER_URL` (management API port follows your deployment; NAS/fnOS often `:20127`, adjust per instance) |
| **Auth** | dashboard LLM key (below) or the deployer's own CLI token |
| **Model routing** | custom-node models MUST be `{prefix}/{model}` — never a bare model name |

## Auth: dashboard LLM key (the self-serve exemption)

Only **`POST /api/provider-nodes` and `POST /api/providers` at the root path** are open to a
dashboard LLM API key (a key from Dashboard → Keys). GET/PUT/DELETE and `[id]` sub-routes still
need the deployer's CLI token / login JWT.

```bash
AUTH="Authorization: Bearer ${TENROUTER_KEY}"    # TENROUTER_KEY = dashboard LLM key
```

> Deployers can also derive a CLI token on the host from `machine-id` + `cli-secret`:
> `sha256(machine-id + "9r-cli-auth" + cli-secret).slice(0,16)`, fixed salt `9r-cli-auth`.
> Send it as the `x-10r-cli-token` header (not `Authorization: Bearer`); servers before the rename read `x-9r-cli-token`.
> Custom data paths live under your DATA_DIR (`~/.10router/` or fnOS `/vol4/@appdata/10router/`).

## Two-step registration

10Router splits a "custom-compatible node" into two steps: first create a **node**
(baseUrl/prefix/type), then a **connection** (its upstream key, linked to the node).

### Step 1: create an openai-compatible node

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

Fields: `name`(display) / `prefix`(lowercase unique, the routing prefix) / `apiType`(`chat`|`responses`) /
`baseUrl`(upstream root) / `type`(`openai-compatible` | `anthropic-compatible` | `custom-embedding`).

### Step 2: add a connection (upstream key, linked to the node)

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

- `provider` = the **full node id** from step 1 (starts with `openai-compatible-`, etc.)
- `apiKey` is the **upstream's own** key
- Once the connection exists, the API pulls prefix/apiType/baseUrl from the node automatically

## Model routing: must use the `{prefix}/` prefix

**Custom-node models are `{prefix}/{model}` — never a bare model name.** Claude models
(`claude-opus-5`) by bare name hit the 10Router **built-in anthropic** provider and error with
`No active credentials for provider: anthropic`, conflicting with your custom node. Use:

```
justworker/claude-opus-5    → routes to JustWorker
```

Tested: `POST /v1/chat/completions` + `Authorization: Bearer <dashboard key>` returns Claude
responses (signature/reasoning present).

## Probe the upstream first (avoid registering a dead key/baseUrl)

```bash
curl -s https://api.<host>/v1/models -H "Authorization: Bearer sk-..."          # should list model ids
curl -s -X POST https://api.<host>/v1/chat/completions \
  -H "Content-Type: application/json" -H "Authorization: Bearer sk-..." \
  -d '{"model":"<model>","messages":[{"role":"user","content":"hi"}],"max_tokens":10}'  # 200 = usable
```

Use the real model ids returned (user-stated lists often differ). Upstreams may expose
`supported_endpoint_types` to hint at dual openai/anthropic formats.

## End-to-end example

```bash
# 0) create node
NODE=$(curl -s -X POST $TENROUTER_URL/api/provider-nodes \
  -H "Content-Type: application/json" -H "$AUTH" \
  -d '{"name":"MyGW","prefix":"mygw","apiType":"chat","baseUrl":"https://gw.example.com/v1","type":"openai-compatible"}')
NODE_ID=$(echo "$NODE" | python3 -c 'import sys,json;print(json.load(sys.stdin)["node"]["id"])')

# 1) add connection
curl -s -X POST $TENROUTER_URL/api/providers \
  -H "Content-Type: application/json" -H "$AUTH" \
  -d "{\"provider\":\"$NODE_ID\",\"apiKey\":\"sk-UPSTREAM_KEY\",\"name\":\"MyGW\",\"priority\":1}"

# 2) verify routing (model MUST be prefixed)
curl -s -X POST $TENROUTER_URL/v1/chat/completions \
  -H "Content-Type: application/json" -H "Authorization: Bearer ${TENROUTER_KEY}" \
  -d '{"model":"mygw/<upstream-model>","messages":[{"role":"user","content":"hi"}]}'
```

## Notes

- **Loopback special-case**: accessing from the deploy host's own `127.0.0.1`, dashboardGuard treats
  loopback via `isLocalRequest`. To verify the POST exemption really 401s, test from a **non-loopback**
  address with an invalid key.
- No restart needed after adding node/connection at runtime.
- Both steps POST the **root path** (not `[id]`); sub-routes still require CLI token/JWT.
- This is a **custom runtime node** — distinct from editing `open-sse/providers/registry/` source +
  repackaging a built-in provider. The former is delivery-free and suits temporary/self-hosted
  gateways; built-ins ride along with version releases.
