# 全量审查报告（v1.1.1 → HEAD，2026-09-17）

> **审读范围**：`v1.1.1`（`c49cdf73`，2026-09-14 发布）→ HEAD（`5427acae`），**共 87 次提交**（150 个文件变更，+8013 / −621 行）；另含本轮工作区改动（429 退避对齐与限流友好提示、模型家族聚合补漏、概览卡片单位缩写、providers/[id] P1 脱敏、issue #21 Cline 刷新 400 修复、测试容错）。
> **审读方法**：全量 Git 提交记录梳理 + 核心模块（安全/熔断/退避/凭据刷新/数据账本/i18n/供应商治理）代码逐项审查 + 全量自动化套件与 `known-fails` 基线门禁 + 三注册表基线（providers 90 / alias 120 / oauth-urls）byte-for-byte 复核 + 新增测试套件实测 + CI main tip 状态核验。
> **变更记录**：初版覆盖 `v1.1.1 → b7fd164f`（80 提交）；2026-09-17 复审轮扩至 HEAD + 工作区——纠正 §一 安全结论（单条接口泄漏修复）、补 issue #21 修复审查、上轮两条建议项全部落地。

---

## 结论

**整体健康度：良好 / 具备生产就绪度，0 阻断性问题。**

- 全量套件 **2663 例：2534 通过 / 35 失败（100% 落在 40 条已知基线内）/ 94 跳过——0 新增回归**；providers / alias / oauth-urls 三注册表基线 byte-for-byte 一致。
- CI main tip（`5427acae`）绿；历史 `b7fd164f` / `7b548f34` 两轮 CI 红经核验为 **Registry baselines 快照漂移**，已随后续提交自愈，当前工作区复核三基线全绿。
- 上轮报告标记的 P1（单条接口明文回显 `mimoPassToken`）**已在本轮修复**并配契约测试；issue #21（Cline 后台刷新 400）**已修复**并配 9 例测试；§六 两条非阻塞建议项全部落地。

---

## 一、安全与敏感凭据防护

| 检查项 | 状态 | 审读说明 |
|---|---|---|
| **供应商接口双凭据脱敏（列表）** | ✅ 达标 | `GET /api/providers` 显式 `delete psd.mimoPassToken`，仅暴露 `hasDesktopSession` / `hasAccessToken` 布尔（`328ecc41`，契约测试双凭据两例）。 |
| **供应商接口脱敏（单条 GET/PUT）** | ✅ 本轮修复（P1） | 初版只查了列表接口；复审发现 `GET/PUT /api/providers/[id]` 仍整包回显 `providerSpecificData`，明文泄漏小米桌面会话 cookie。已加 `toSafeConnection()` 同规则脱敏 + 能力布尔；PUT merge 语义保证编辑回传缺字段不灭失存量 token；契约测试扩 3 例（单条 GET、部分编辑不灭失、无 psd 编辑不灭失）。前端核验：该接口现有消费者仅用 PUT 开关且忽略响应体，修复无 UI 影响。 |
| **敏感接口鉴权守卫** | ✅ 达标 | `src/dashboardGuard.js` 将 `/api/oauth/xiaomi-mimo/auto-import` 纳入 `ALWAYS_PROTECTED` 与 `LOCAL_ONLY_PATHS`；仪表盘接口只认 JWT cookie / CLI token。 |
| **OAuth 传输加解密** | ✅ 达标 | 导出/导入受传输口令保护，`scrypt` + `AES-256-GCM`（`10router-oauth-secure-v1` 信封）端到端封包。 |
| **凭据自动刷新链路（issue #21 复审新增）** | ✅ 已修复 | Cline/ClinePass 后台刷新原走通用 OAuth2 蛇形表单 → 上游 400（要求 JSON + 小驼峰 `refreshToken`/`grantType`）。专用 `refreshClineToken()` 落地：请求体形态与上游校验一致、头部复用 `clineAuth.js`、`dedupRefresh` 防并发重复刷新、`expiresAt`→`expiresIn` 归一入持久化层；`REFRESH_HANDLERS` 注册 `cline`+`clinepass`。chat/user 的 `Bearer workos:` 前缀逻辑未动（该处本就正确）。 |
| **全量 Diff 敏感字段扫描** | ✅ 达标 | 87 提交 + 工作区 diff 无新增裸写真实 key / JWT / 私有凭据。 |

---

## 二、核心链路、熔断与并发

- **CodeBuddy 11128 渠道级熔断（完整闭环）**：
  - `channelScope: true` 规则位 + provider 级熔断（60s 起步 / 5 分钟内复发升 10 分钟）+ 任一成功请求清除熔断 + 熔断期跳过配额刷新、恢复后 `invalidateQuotaCache`；
  - `withChannelScopeHint` 双语友好提示（首命中 400 与窗口内 503 两处）；
  - 复审轮补录：极端体积本地兜底 `isOversizedForCbcn`（明显超限不触达上游）+ Claude 协议错误体顶层 `type:"error"` + 纯中文主文案（`0c58d552`）；
  - localDb shim 导出守卫 + `mutateSettings` 事务 RMW（并发竞态修复）+ 真实 store 竞态测试。
- **429 退避与上游重试提示对齐（本轮新增）**：
  - `extractRetrySeconds()` 解析上游「请约 N 秒后重试」（中英双语），`backoffCooldown()` 冷却取 `max(指数退避, 上游提示秒数)`、30 分钟封顶；`checkFallbackError` 两条 `backoff` 分支统一接入；
  - 背景：NAS 生产日志（2026-09-17）实证上游要求 23s 而网关 2s/4s/8s/16s 连打 4 个 429 全废；
  - `withRateLimitHint()` 限流文案友好化接入 `chat.js`（两路径）与 `combo.js` 兜底路径；渠道熔断路径经测试确认不受影响。
- **配置与数据层并发安全**：`mutateSettings` 事务内原子 RMW；`channel-block-repo.test.js` 真实 store 5 例；afterAll 清理 EPERM 容错（本轮落地）。

---

## 三、数据层与使用量账本

- **健康度打分与导入数据隔离**（既有）：`notImported` 条件排除 `meta.imported` 行，`meta.gatewaySync=true` 网关同步行按设计计入；缓存命中率过滤失真样本；趋势图空档填 0。
- **模型家族归一化两轮（复审新增）**：
  - 第一轮（`5427acae`）：首段剥连字符版本段，`gpt-6` / `gpt-4o` 归并 `gpt`；
  - 第二轮（本轮工作区）：首段剥贴版数字，`hy4-preview` / `hy3` → `hy`、`qwen3.8` → `qwen`；纯数字首段护栏、UUID 归 other；
  - 图例与图表数据同集合折叠（`MAX_LEGEND_SERIES = 6`，other 固定最右不简写）。
- **概览卡片单位缩写接入（本轮）**：4 张计数卡改走 `fmtTokens(值, locale)`，Est. Cost 保持 `fmtCost`。

---

## 四、跨端环境、供应商治理与国际化

- **供应商治理（复审新增）**：`gorouter` / `tabiauto` 下架；OpenCode Free / MiMo Code Free 归「体验」分类（`community: true` 默认隐藏）；`siliconflow-cn` 图标别名补齐。
- **小米 Token Plan 出口节点匹配（`ece00841`）**：ip.sb geoip 探测（3s 超时 / 15min 缓存 / fail-open）+ cn/sgp/ams 自动预选 + `testUtils.js` 硬编码 sgp 缺陷修复（按 `providerSpecificData.region` 动态路由）。
- **桌面壳与 i18n（既有）**：`translate` 缺失崩溃修复、图标边距优化、zh-CN/zh-TW 70+ 词条、Endpoint 页 i18n 清扫等（详见 CHANGELOG v1.1.2）。
- **ZCode 插件 v1.4.0**：`/10router-sync:status` 状态监控命令；三处版本号同步；发布前专项审计通过。

---

## 五、自动化测试与回归基线比对

| 测试指标 | 统计结果 | 说明 |
|---|---|---|
| **测试总数** | 2663 | 单元 + 快照集成（841 suites） |
| **通过数量** | 2534 | |
| **跳过/预期失败** | 94 | skipped |
| **失败总数** | 35 | **100% 吻合** 40 条 `known-fails` 基线（5 条基线项本轮未复现，属环境性波动） |
| **新增回归失败** | **0** | 回归门禁 `verify-no-regression.mjs` ✅（issue #21 修复前后各跑一轮） |
| **注册表基线** | 全绿 | providers 90 / alias 120 / oauth-urls byte-for-byte 一致 |
| **本轮新增测试** | 23 例全绿 | `cline-refresh-token` 11（含 PR #22 三点增量）+ `rate-limit-hint` 9 + `providers/[id]` 脱敏契约 3 |
| **CI main tip** | 绿 | `5427acae` Tests 通过；历史两轮红 = Registry baselines 漂移已自愈 |

---

## 六、上轮建议项处置（全部闭环）

1. ~~**`GET /api/providers/[id]` 脱敏补充**~~ ✅ **本轮修复**（P1 升格处理：`toSafeConnection()` + 3 例契约测试）。
2. ~~**测试退出临时目录权限释放**~~ ✅ **本轮落地**（`channel-block-repo.test.js` afterAll try/catch 容错）。

---

## 七、复审轮明细（`b7fd164f` 之后 7 提交 + 工作区）

| 提交/范围 | 内容 | 核验结论 |
|---|---|---|
| `ece00841` | ip.sb 出口节点匹配 + testUtils region 修复 | ✅ fail-open 设计正确、测试端点动态路由；两测试文件在位 |
| `0c58d552` | 11128 极端体积兜底 + Claude 协议错误体 + 纯中文提示 | ✅ 兜底判定纯函数化；`type:"error"` 补顶层不破坏 OpenAI 形态 |
| `6dc4b8fa` | 体验分类 + gorouter/tabiauto 下架 + siliconflow-cn 图标 | ✅ registry/图标/文案一致；providers 基线 byte-for-byte 复核绿 |
| `04bbd369` | ZCode 插件 v1.4.0 status 命令 | ✅ 发布前专项审计通过；三处版本号 1.4.0 一致 |
| `ee7860ad` | 图例顶部右侧 + 6 项上限 + 移动端自适应 | ✅ other 固定最右、图表数据同集合折叠 |
| `5427acae` | 家族归一化去连字符版本段 | ✅ CI 绿；本轮续修贴版数字形态 |
| `7b548f34` | 审查报告收录（文档） | ✅ 本次扩写纠错的对象 |
| 工作区 | 429 退避/限流文案、hy4/hy3 家族、概览缩写、P1 脱敏、**issue #21 Cline 刷新**（09-18 吸收 PR #22 同场景三点增量：`clientType:"extension"` / accessToken `workos:` 前缀归一 / 永久性认证错误 `unrecoverable_refresh_error` 标记）、测试容错 | ✅ 全量门禁 0 新增回归（修复前后三轮）；23 例新测试绿；PR #22 superseded 关闭 |

---

## 八、发版 checklist（代码侧就绪，动作项待发版时执行）

- [x] 87 提交 + 工作区全审，0 阻塞
- [x] 四版本位处于 1.1.1 干净态（`package.json` / `cli/package.json` / `desktop/package.json` / `fnos-packaging/manifest`——发版时一次同步 bump 1.1.2，v1.0.8 教训）
- [x] CHANGELOG 开发日志补齐复审轮全部条目（429 退避 / 家族聚合 / 图例 / 体验分类 / egress / 插件 v1.4.0 / P1 脱敏 / issue #21）
- [x] 全量套件 0 新增回归 + 三注册表基线绿 + CI main tip 绿
- [ ] bump 1.1.2 四处一次同步（`scripts/test-build-version.mjs` 仅测试盖号用，发版直接改文件）
- [ ] 用户端三语 changelog（`public/i18n/changelog/{en,zh-CN,zh-TW}.md`）+ README 版本表 + Release notes（发版面校准，版本历程倒序）
- [ ] tag **单独推**（与 main 同一把推会静默丢 tag 事件，v1.0.8 教训）→ 盯 4 个 `v*` 工作流
- [ ] Release 建好后删旧版 `nsis.7z` + `Web-Setup` 资产（防死链；届时核对 Releases 页现存资产，原则保留最近两版）
- [ ] Gitee `push main --tags`（artifact-backup 镜像）
- [ ] NAS 热替换到正式版（当前 `1.1.2-test.7` = `5427acae`；工作区改动需先随 test.8 或直接随正式版带上）；Windows 桌面同理

## 九、遗留（不阻塞 1.1.2）

1. **#9 安全审计 6 未修项**（默认监听 / 默认密码兜底 / 凭据明文等）——维持 v1.1.1 定案挪 1.2，行为变更需迁移指引。
2. **#10 内容过滤流重试设计**——需先拍策略（计费放大风险），挪 1.2。
3. zh-TW 字典缺口（Endpoint Suggested-free-models 等低频静态文案仍英文）。
4. `db-benchmark` / `embeddings.cloud` Windows 环境性失败已在 known-fails 基线内标注。
5. NAS/桌面两端均未吃到本轮工作区改动（429 退避修复尤应尽早部署——日志中的 4 连空打在部署前会继续发生；issue #21 用户的 cline 连接在部署前仍会到期断连）。
