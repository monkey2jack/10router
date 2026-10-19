# 10router-sync (ZCode / OpenCode / mirasim / 小米 MiMo / 10Router·9Router 实例插件)

把本机 ZCode 的模型调用流水（`~/.zcode/cli/db/db.sqlite` 的 `model_usage` 表）、OpenCode 桌面端的会话用量（`~/.local/share/opencode/opencode.db` 的 `session` 表）、mirasim 桌面端的调用账本（`~/.mirasim/insights/usage-*.ndjson`）、小米 MiMo 桌面版的逐条消息用量（`~/.local/share/mimocode/mimocode.db` 的 `message` 表），或**另一个 10Router/9Router 实例**的用量库（其 `data.sqlite` 的 `usageHistory` 表）导出并导入 10Router 的用量统计，复用 10Router 的 `/api/settings/database/import-usage` 接口。

同时提供 **`/10router-sync:status`**：只读查看一个 10Router 实例的实时状态（渠道熔断 / 账号健康 / 用量）。

## 能力

- **幂等**：10Router 按行签名去重，重复运行不会产生重复数据
- **防双重计数**：ZCode 源默认**只导出官方渠道**（`builtin:*`，如 `builtin:bigmodel-*`、`builtin:zai-*`）——自定义/网关类 provider 的流量已由 10Router 自身或其他同步源记账，导出会重复（需要时用 `--include-custom` 恢复导出）；mirasim 源按 `upstreamHost` 排除中转流量
- **溯源**：导入后 provider 显示为 `zcode-<名称>`（如 `zcode-bigmodel-start-plan`）、`opencode-<providerID>`、`mirasim-<协议>`、`mimo-<providerID>`，cost 记 0（订阅制渠道），agent/会话/时长等明细在 meta 里；`--source 10r` 原样保留源实例的 provider/cost/status（同名 provider 在目标侧自然合并），来源路径记在 `meta.syncedFrom`
- **鉴权**：同步用虚拟 key（`sk-…`，推荐）或仪表盘密码，与 10Router v1.0.7+ 的导入鉴权匹配；**状态监控只能用面板密码或本地 CLI token**（详见下方状态监控章节）

## 安装

**方式一：ZCode 插件市场（推荐，npm/桌面/源码安装用户通用）**

ZCode → Settings → Plugin Management → Discover 页 → 点 `+` 添加市场，填 GitHub 仓库 `techysy/10router`（市场索引在仓库根 `marketplace.json`）→ 找到 **10router-sync** 点 Get 安装。

**方式二：从目录安装（本地开发）**

Plugins → 从目录安装，选择 `zcode-plugin/` 目录（含 `.zcode-plugin/plugin.json`）。或直接把目录拷贝到 ZCode 插件目录。

## 使用

- 斜杠命令：`/10router-sync:sync-usage`（同步用量）、`/10router-sync:status`（查看实例状态），均可带参数（如 NAS 地址）
- 技能：对 ZCode 说「导出 ZCode 使用量到 10Router」即自动触发
- 直接跑脚本：

```bash
# 预览（不导入）
node scripts/export-usage.mjs --endpoint http://127.0.0.1:20127 --key sk-… --dry-run

# 导入（本机可直连 10Router 时）
node scripts/export-usage.mjs --endpoint http://127.0.0.1:20127 --key sk-…
```

数据源由 `--source` 指定：`--source zcode`（默认）读 ZCode，`--source opencode` 读 OpenCode 桌面端，`--source mirasim` 读 mirasim 桌面端，`--source mimo` 读小米 MiMo 桌面版，`--source 10r` 读另一个 10Router/9Router 实例的用量库。OpenCode / mirasim / MiMo / 10r 不会自动检测——导出其用量须显式指定 `--source`。

### OpenCode 用量同步

```bash
# 导入 OpenCode 用量（本机可直连 10Router 时）
node scripts/export-usage.mjs --source opencode --endpoint http://127.0.0.1:20127 --key sk-…

# 离线：先导出，再在能连通 10Router 的机器导入
node scripts/export-usage.mjs --source opencode --export opencode-usage.json
node scripts/export-usage.mjs --import opencode-usage.json --endpoint http://<host>:<port> --key sk-…
```

### mirasim 用量同步

mirasim 桌面端的调用账本在 `~/.mirasim/insights/usage-YYYY-MM.ndjson`（逐调用记录，含
input/output/cacheRead/cacheWrite/reasoning 五项 token 计量与 agent/model/workspace 明细）。

```bash
# 导入 mirasim 用量（本机可直连 10Router 时）
node scripts/export-usage.mjs --source mirasim --endpoint http://127.0.0.1:20127 --key sk-…

# 离线：先导出，再在能连通 10Router 的机器导入
node scripts/export-usage.mjs --source mirasim --export mirasim-usage.json
node scripts/export-usage.mjs --import mirasim-usage.json --endpoint http://<host>:<port> --key sk-…
```

说明：导入后 provider 显示为 `mirasim-<协议>`（如 `mirasim-anthropic`、`mirasim-openai-responses`、`mirasim-openai-chat`），cost 记 0（mirasim 中转为套餐制）；失败调用（HTTP ≥400 无 token 消耗）自动跳过；agent/leg/upstreamHost/effort/repo/workspace 等溯源明细在 meta 里。`prompt_tokens` 记**真实输入 = input + cacheRead + cacheWrite**——mirasim 账本的 `input` 只算净新增（缓存分列），原样落库会把缓存重度会话的输入低估几个量级（v1.5.0 起；存量历史行已由 `scripts/normalize-mirasim-input.mjs` 订正）。

### 小米 MiMo 桌面版用量同步

小米 MiMo 桌面版（mimocode）把每轮 assistant 消息的完整 token 计量记在
`~/.local/share/mimocode/mimocode.db` 的 `message` 表里（input/output/reasoning/
cache.read/cache.write 五项，附带 modelID/providerID/agent/mode/时间戳）。

```bash
# 导入 MiMo 用量（本机可直连 10Router 时）
node scripts/export-usage.mjs --source mimo --endpoint http://127.0.0.1:20127 --key sk-…

# 离线：先导出，再在能连通 10Router 的机器导入
node scripts/export-usage.mjs --source mimo --export mimo-usage.json
node scripts/export-usage.mjs --import mimo-usage.json --endpoint http://<host>:<port> --key sk-…
```

说明：导入后 provider 显示为 `mimo-<providerID>`（如 `mimo-xiaomi`、`mimo-mimo`），cost 记 0（套餐制）；
空转/中断的 0-token 轮次自动跳过；message id/会话/agent/mode 等溯源明细在 meta 里。`--source mimocode` 是 `--source mimo` 的别名。

### 10Router / 9Router 实例用量同步

把**另一个 10Router（或遗留 9Router）实例**的用量汇总进你常看的那块仪表盘（NAS 上的实例、
兄弟中继、9Router 老安装）。源实例 `data.sqlite` 的 `usageHistory` 行与导入格式完全一致，
原样透传：provider/cost/status 都保留（同名 provider 在目标侧自然合并），只有
`connectionId` 是源实例的外部 uuid——挪进 `meta.sourceConnectionId` 并置空，避免污染目标的
按账户聚合；`meta.syncedFrom` 记录来源库路径（或 `--tag <标签>` 自定义）。

```bash
# 自动发现本机实例库（%APPDATA%\10router|9router\db\data.sqlite，Unix 为 ~/.10router|~/.9router/db/data.sqlite）
node scripts/export-usage.mjs --source 10r --endpoint http://127.0.0.1:20127 --key sk-… --dry-run

# 显式指定源库（NAS 拷贝 / 挂载盘 / 拷贝过来的 data.sqlite）
node scripts/export-usage.mjs --source 10r --db /path/to/data.sqlite --endpoint http://<host>:<port> --key sk-…

# 离线：先导出，再在能连通 10Router 的机器导入
node scripts/export-usage.mjs --source 10r --db /path/to/data.sqlite --export 10r-usage.json
node scripts/export-usage.mjs --import 10r-usage.json --endpoint http://<host>:<port> --key sk-…
```

说明：`--source 10router` / `--source 9r` / `--source 9router` 均为别名；`--limit N` 只取最新 N 条；
读运行中的库是快照式复制（可能缺最后几秒的流量），不必停源实例。

**同实例防护**：若源库路径是本机默认实例库、且 `--endpoint` 指向 loopback，脚本会以退出码 2 拒绝——
把实例导回自己比空跑更糟：所有行都会撞上已有行签名，而服务端在撞签时会给旧行补写
`meta.imported=true`，把全部实时行标成「导入行」。确实是另一个实例时加 `--force`。
反过来也成立：**不要**把上游流量由目标实例供着的下游实例往回导——链式行签名两边不同，
服务端去重拦不住，会双倍统计。

### 离线模式（ZCode 与 10Router 不在同一网段）

本机无法直连 10Router 时，先导出 JSON（无需网络与凭据），把文件带到任何能连上
10Router 的机器再导入：

```bash
# ① ZCode 机器上导出
node scripts/export-usage.mjs --export zcode-usage.json

# ② 能连通 10Router 的机器上导入
node scripts/export-usage.mjs --import zcode-usage.json --endpoint http://<host>:<port> --key sk-…
```

导出的 JSON 也可以直接在 10Router 仪表盘导入（设置 → 数据库备份 → JSON 用量导入）。
幂等去重按行签名，导出后隔多久导入、重复导入都安全。

环境变量：`TENROUTER_ENDPOINT` / `TENROUTER_KEY` / `TENROUTER_PASSWORD`。

## 实例状态监控：`/10router-sync:status`

只读查看一个 10Router 实例的实时状态，三段输出：

| 段 | 内容 |
|---|---|
| **渠道熔断** | 仍在冷却期的 provider，含剩余时间、strike 次数、是否已升级（60s → 10min）。判断渠道级风控（如 CodeBuddy 11128）是否正在生效的直接入口 |
| **账号健康** | 按 provider 分组，各连接的启用状态与**当前生效的 per-model 锁**（含剩余时间） |
| **用量** | 今日请求数/tokens/成本 + 累计请求/tokens + 最常用模型 + 缓存命中率 + 连续活跃天数 |

```bash
# 本机实例：零配置（自动推导本地 CLI token）
node scripts/status.mjs

# 远程实例：用面板密码换会话 Cookie
node scripts/status.mjs --endpoint http://192.168.31.101:20127 --password <面板密码>

# 机器可读
node scripts/status.mjs --json
```

> ⚠️ **鉴权与 sync-usage 不同**：本命令读的 `/api/settings`、`/api/providers`、
> `/api/usage/dashboard` 由 `dashboardGuard` 保护，**只认 JWT 会话 Cookie 或本地 CLI
> Token，虚拟 `sk-` key 在这里无效**（sk- 只开 LLM API 与 import-usage 路由）。脚本的
> 取凭据顺序：`--cli-token` → `--password` → loopback endpoint 时自动推导本地 CLI token。

退出码：`0` 正常 · `1` 实例不可达或部分读取失败（报告仍打印能读到的部分）· `2` 参数错误
或凭据缺失/失效。

## 运维工具：用量库校验与清理

导错了数据需要从 10Router 侧删除时，**不要手工 DELETE** —— `usageDaily` 日聚合是增量维护的，
没有任何代码会从 `usageHistory` 重建它：裸删会让仪表盘长期显示幽灵数字，手写重建则极易踩
「UTC 日期 vs 服务器本地日期」和「五个聚合维度只重建了两个」这两个坑。

| 工具 | 用途 |
|---|---|
| `scripts/verify-usage-db.mjs` | 只读体检：完整性 / 外键 / **usageDaily 与 usageHistory 逐日逐字段一致性** / lifetime 计数器 |
| `scripts/clean-usage-db.mjs` | 按 `--provider <名>` 或 `--where "<谓词>"` 删行，忠实重建受影响日桶并修正计数器；默认只预览，`--apply` 才写入，自带事后校验 |
| `scripts/usage-daily.mjs` | 上述两者共享的聚合契约实现（与 10Router 的 `usageRepo.js` 保持同步） |

```bash
# 体检（只读，随时可跑）
node scripts/verify-usage-db.mjs /path/to/data.sqlite

# 预览要删什么（不写入；--export 可先备份这些行）
node scripts/clean-usage-db.mjs /path/to/data.sqlite --provider zcode-xxxx --export removed.json

# 执行（自带事后校验，失败会提示回滚）
node scripts/clean-usage-db.mjs /path/to/data.sqlite --provider zcode-xxxx --apply
```

**操作前必须先停 10Router 服务**（或改在副本上操作）——应用持有该数据库，并发写入会损坏文件。
Node 22 需加 `--experimental-sqlite`；Node 24+ 直接跑。

## 脚本一览

| 脚本 | 用途 |
|---|---|
| `scripts/export-usage.mjs` | 主程序：五源导出（zcode / opencode / mirasim / mimo / 10r）→ 在线导入 / 离线导出导入 |
| `scripts/verify-usage-db.mjs` | 10Router 用量库只读体检（见上节） |
| `scripts/clean-usage-db.mjs` | 10Router 用量库删行 + 日聚合重建（见上节） |
| `scripts/usage-daily.mjs` | 聚合契约共享实现，被上面两个工具引用 |
| `scripts/normalize-mirasim-input.mjs` | 订正旧 mirasim 行输入口径（2026-09-24 已在双库执行；新装实例不需要）。可安全重跑：新口径行（含 CreditDaddy 写入）自动跳过，重复对只报告不改动；默认 dry-run |

## 文档

| 文档 | 内容 |
|---|---|
| [CHANGELOG.md](./CHANGELOG.md) | 本插件各版本变更记录 |
| [AGENTS.md](./AGENTS.md) | 面向非 ZCode agent 的复用说明（脚本契约、退出码、关键行为、排查） |
| [commands/sync-usage.md](./commands/sync-usage.md) | 斜杠命令定义 |
| [skills/zcode-usage-sync/SKILL.md](./skills/zcode-usage-sync/SKILL.md) | ZCode 技能说明 |

## 创建虚拟 key

10Router 仪表盘 → API Keys → 新建（如命名 `zcode-usage-sync`），把生成的 `sk-…` 传给脚本。key 可随时在仪表盘单独吊销，无需暴露仪表盘密码。
