---
description: Show a 10Router instance's live status — channel breakers (provider-wide cooldowns), account health (active/locked connections per provider), and usage totals (today + lifetime). Read-only. 查看 10Router 实例的实时状态——渠道熔断（整渠道冷却）、账号健康（各渠道启用/锁定情况）、用量统计（今日与累计）。只读操作。
---

Show the status of the 10Router instance the user watches, by running the plugin's status script.

Steps:

1. Determine the 10Router endpoint: default `http://127.0.0.1:20127`; if the user gave an address in $ARGUMENTS (e.g. a NAS IP), pass it via `--endpoint`.

2. Determine credentials. The dashboard endpoints this command reads (`/api/settings`, `/api/providers`, `/api/usage/dashboard`) accept **only** a JWT session cookie or the local CLI token — a virtual `sk-` key does **not** work here. Three paths, in order of preference:
   - **Local instance (loopback endpoint)**: pass nothing — the script auto-derives the CLI token from the local data dir (`machine-id` + `auth/cli-secret`). Zero configuration.
   - **Remote instance**: pass `--password <dashboard password>`; the script exchanges it for a session cookie via `POST /api/auth/login`.
   - **Explicit token**: pass `--cli-token <token>` if the user already has one.

3. Run:

```bash
node "$ZCODE_PLUGIN_ROOT/scripts/status.mjs"
```

For a remote instance:

```bash
node "$ZCODE_PLUGIN_ROOT/scripts/status.mjs" --endpoint http://<host>:<port> --password <password>
```

4. Report the result. The script prints three sections:
   - **渠道熔断** — providers currently in a channel-wide cooldown, with remaining time and strike count. `✅ 无熔断` means all channels are serving.
   - **账号健康** — per provider: how many connections are enabled, and which have active per-model locks.
   - **用量** — today's requests/tokens/cost, plus lifetime totals, top model, cache hit rate, and streak.

5. If the script exits non-zero, read the `error:` line: exit 1 means unreachable or partial read failure (the report still prints what it could read), exit 2 means a bad argument or missing/invalid credentials — in that case ask the user for the dashboard password.

6. Use `--json` when the user wants machine-readable output or you need to parse specific fields.

7. If the user writes in Chinese, respond in Chinese.

Arguments (all optional): $ARGUMENTS
