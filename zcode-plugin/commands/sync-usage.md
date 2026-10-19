---
description: Export ZCode, OpenCode, mirasim, Xiaomi MiMo's local usage ledger — or another 10Router/9Router instance's usage — into 10Router (idempotent; online direct import or offline JSON export; --source opencode / mirasim / mimo / 10r for those sources). 将 ZCode/OpenCode/mirasim/小米MiMo 本地用量（或另一个 10Router/9Router 实例的用量）导出并导入 10Router（幂等；可在线直传或离线导出 JSON；其他来源用 --source opencode / mirasim / mimo / 10r 指定）
---

Export ZCode model-usage records into 10Router by running the plugin's export script.

Steps:

1. Determine the mode: if this machine can reach the 10Router endpoint, sync online. If it cannot (different network / no route), export offline: `--export zcode-usage.json` (no endpoint or credentials needed), tell the user to carry the file to a machine that can reach 10Router, and give them the import command (`--import zcode-usage.json --endpoint <URL> --key <sk-…>`).
2. Determine the 10Router endpoint: default `http://127.0.0.1:20127`; if the user gave an address in $ARGUMENTS (e.g. a NAS IP), use it via `--endpoint`.
3. Determine credentials: use `--key sk-…` (virtual key from 10Router dashboard → API Keys, recommended) or `--password`. If neither is known, ask the user for one.
4. Run a dry-run first and summarize what would be exported:

```bash
node "$ZCODE_PLUGIN_ROOT/scripts/export-usage.mjs" --endpoint <URL> --key <sk-…> --dry-run
```

5. If the dry-run looks right (non-zero rows, sensible provider split), run the real import and report the `imported X, skipped Y` result. The operation is idempotent — safe to re-run.
6. If the user writes in Chinese, respond in Chinese.
7. To sync a non-ZCode source, pass `--source opencode` / `--source mirasim` / `--source mimo` / `--source 10r` (they are not auto-detected; "全平台" means running all sources one by one). `--source 10r` reads another 10Router/9Router instance's `data.sqlite` (auto-discovered locally, or `--db <path>` for a NAS copy / mounted share; the script refuses to import a db that belongs to the very instance behind a loopback `--endpoint` — use `--force` only if it truly is a different instance).

Arguments (all optional): $ARGUMENTS
