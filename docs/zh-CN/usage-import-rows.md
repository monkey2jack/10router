# 用量导入行在详情页的展示契约（meta.imported）

> 2026-09-05 修复入库（commit 1a91bf33，单测 6/6）。本文固化当时的背景、机制与两个数学/工程
> 结论，供「导入的数据在某视图看不到」「重导备份双显示」类排查与后续复用标记法参照。
> 相关：[usage-usageKey-contract.md](./usage-usageKey-contract.md)（实时写入侧去重契约）、
> [ARCHITECTURE.md](./ARCHITECTURE.md)（用量统计总览一句话版）。

## 背景：两条数据链路

仪表盘 Usage 详情 tab（request-details API）只读 `requestDetails` 表（代理观测日志，环形
上限 200 条）；而所有**使用量导入**（ZCode 插件、9r 备份、设置页「导入使用量」）只写
`usageHistory` → 导入行在详情 tab 不可见。导入与代理是两条链路，详情页最初只覆盖代理链路；
9r 备份导入同样中招。

## 机制（三条，均在 commit 1a91bf33）

1. **写入侧打标**：`importUsageRows`（`src/lib/db/repos/usageRepo.js`）给导入行写
   `meta.imported=true`；**去重命中时也补标记**（回填存量行——重跑一次导入即完成历史数据
   迁移，无需专门的数据迁移脚本）。
2. **读取侧合成**：`getRequestDetails`（requestDetailsRepo.js）把带标记的 usageHistory 行
   合成 requestDetails 形状，与原表**按时间戳归并分页**。合成行 `id` 前缀 `imported-`、
   `ok→success` 状态映射、payload 区块显示 redacted。实时代理流量双写两表但无标记 →
   天然不重复。
3. **下拉联合**：`/api/usage/providers` 用 `meta LIKE '%"imported":true%'` 联合两个来源的
   DISTINCT provider。

## 归并分页正确性（数学证明，勿再凭直觉立 bug）

曾怀疑「双源各取 top-K 深页漏行」是边缘 bug——**误报，已撤回**（v1.0.8 前复核，见
release-review-v1.0.7）。证明：两源各取 top-K（K = offset + pageSize）时，某源的全局前 K
名必在其本地前 K 名内，故全局 top-K ⊆ 两源局部 top-K 的并集；合并排序后的前 K 名恰为全局
top-K，`slice(offset, K)` 对**任意** imported 行数都正确。既有单测不需补深分页场景。
教训：对「双源各取 limit」的直觉怀疑要先证明再立 bug。

## 已知边界

- `meta LIKE '%"imported":true%'` 全表扫在万行级为几十 ms，详情页低频可接受。
- **罕见碰撞**：重导一份**含本机实时流量**的备份时，签名撞上活行会给活行打标记，导致该行
  在详情页双显示（仅外观问题，正常外部导入不触发）。与「同实例防护」（10router-sync
  `--source 10r` 的 exit 2 拒绝）是同一现象的两种后果——撞签打标本身就是证据。
- 回滚 = revert；标记字段对旧代码惰性，无需数据迁移。

## 健康度评分的例外：meta.gatewaySync（9r/10r 网关同步行）

数据口径原文：「外部导入行**不参与**健康度评分但计入热力图与生涯统计」。2026-09-16 起补一个
例外——**`meta.gatewaySync = true` 的导入行参与健康度评分**：

- **为什么**：10r/9r 来源的行在源实例上是**真实网关观测**（真实状态码），被一刀切排除
  不合理——兄弟实例的失败率应当计入节点/模型评分。
- **谁来打标**（判据都是「源实例上的**原生**行」）：
  - 10router-sync `--source 10r`（插件转换器）：源行 meta 无 `imported` 标记 → 打
    `gatewaySync`；源行若本身是 B 实例从 zcode/mirasim/mimo 导入的（`imported:true`）→
    **不打**，链式同步多远都保持排除（防客户端账本网关观测洗白）。
  - 服务端 9r 备份 sqlite 导入路径（`importUsageFromSqlite`）：同规则逐行自动打标。
  - 泛用 JSON 导入（`readUsageFromJson` / 仪表盘手传文件）**不打标**——来源混杂，从保守。
- **谓词**（`getUsageDashboard` 的 `notImported`）：
  `meta IS NULL OR meta NOT LIKE '%"imported":true%' OR meta LIKE '%"gatewaySync":true%'`。
- 延迟/速度轴仍不参与（usageHistory 无 TTFT/时长字段），只贡献请求数与成功率轴——与
  「缺数据轴权重回退成功率」的既有设计天然兼容。
- 锁定测试：`tests/unit/usage-dashboard-import-exclusion.test.js`（gatewaySync 参与 /
  链式导入继续排除 / sqlite 路径只给原生行打标，共 11 例）。

## 排查指引（How to apply）

「导入的数据在某视图看不到」时先分清两张表的分工：

- `usageHistory` —— **记账**（所有导入 + 实时聚合的家，usageDaily 由它增量聚合）；
- `requestDetails` —— **payload 观测**（仅实时代理流量，环形 200 条）。

`meta.imported` 标记法可复用到任何「两链路合一展示」的场景：写侧打标 + 去重回填 + 读侧
合成，三件缺一不可。
