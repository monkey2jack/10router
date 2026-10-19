# 静默丢数据三连 + 明文凭据透传（v1.1.2 开发期，2026-09-16）

四个同族缺陷：**数据在代码管道里被静默丢弃或静默透传，没有任何报错**——
前三个丢数据，第四个泄露数据。全部在 v1.1.2 测试期（NAS test.17-21 / Win
test.14-19 滚动）内发现并修复，各配回归测试钉死。

## 一、saveRequestUsage 丢弃 entry.meta（落库通道被掐断）

- **现象**：延迟随用量行旅行功能（`meta.latencyMs/ttftMs`）上线后，新写入的
  usageHistory 行 meta 全空；新写的单测（meta 路径算速度）红。
- **根因**：`saveRequestUsage` 的 INSERT 语句 meta 参数写死为
  `stringifyJson(entry.usageKey ? { usageKey } : {})`——调用方传的整个
  `entry.meta` 对象被静默丢弃。该 bug 与生俱来，此前没有任何调用方依赖
  entry.meta，所以从未暴露。
- **闸门**：`usage-dashboard-import-exclusion.test.js`「computes speed from
  usageHistory meta latency」（meta 延迟落库+算速度+算分整链路）；
  `usage-stats-usagekey.test.js` 同时断言 meta 字段落库。

## 二、saveUsageStats 丢弃 usageKey（去重合同在主链路失效）

- **现象**：代码审查（同功能开发中）发现：chatCore 四个调用点全部传
  `usageKey: randomUUID()`，但 `saveUsageStats` 的解构签名**根本没有
  usageKey 参数**——参数在调用边界被静默丢弃。
- **后果**：同毫秒、同 token 数的两笔独立请求命中内容去重被合并为一行
  （usageKey 合同当初正是为修这个而生，见
  [usage-usageKey-contract.md](usage-usageKey-contract.md)）。
- **闸门**：`usage-stats-usagekey.test.js`——同毫秒同内容双调用、不同 key
  → 两行都存活且各带自己的 key。

## 三、传输导入行测试报 "Provider test not supported"（dispatch 走错分支）

- **现象**：Win→NAS 连接迁移（传输导出/导入）后，NAS 上点连接测试返回
  `Provider test not supported`；同一连接在 Win 测试正常。**用户在 NAS
  仪表盘实测发现**。
- **根因**：`accountTransfer.importAccounts` 默认 `authType: "oauth"`；
  测试 dispatch 按 authType 分流——apikey 路由进含 xiaomi-mimo 专属探测
  （key→/models、会话→Preview 真实调用）的 `testApiKeyConnection`，
  oauth 路由进不含小米 case 的 `testOAuthConnection` → 通用报错。Win 之
  所以正常，只因它的行恰好由 api-key 路由创建（authType=apikey），浏览器
  授权合并不改 authType——两条创建路径产生了**同一功能、不同 authType**
  的行，测试路径却按 authType 分流。
- **修复**：xiaomi-mimo 恒走 apikey 分支的专属 case（该 case 自身按凭据
  形态选探测，不依赖 authType）。
- **闸门**：无独立单测（testUtils 分支派发未纳入单测面）；此为遗留缺口，
  见教训 3。

## 四、GET /api/providers 明文回显 mimoPassToken（审查发现）

- **现象**：发布后审查发现：providers 列表接口抹掉了 accessToken 四件套
  并暴露 `hasAccessToken/hasDesktopSession` 布尔，但
  `providerSpecificData` **整包透传**——小米桌面会话 cookie（mimoPassToken）
  原文返回给任何持有仪表盘会话的消费方。
- **修复**：响应中删掉该键保布尔；PUT 路由为 merge 语义（先展 existing 再
  展 incoming），编辑/导入回传丢字段不会抹掉存量值。
- **闸门**：`providers-route-secret-stripping.test.js` 双凭据两例，断言
  布尔在、值不在、序列化全文不含密钥字面量。

## 为什么没拦住

1/2 是**函数签名层面的丢参**——TypeScript 之外的 JS 解构签名不报多余参数，
调用点看起来完全正常；只有真正断言"产物里有这个字段"的测试才能拦住。
3 是**多入口收敛同一实体**（传输导入/浏览器授权/api-key 各写各的
authType）后，下游按 authType 分流的隐含耦合断裂——单元测试都在各自分支
内绿，没有跨入口的派发一致性测试。4 是**安全属性没有契约测试**：脱敏逻辑
与新字段（providerSpecificData 透传）同时演进时，后者把前者架空。

## 教训（浓缩版）

1. **签名即合同**：跨模块传参后必须有测试断言"参数真的到了终点"（落库行
   /HTTP 响应），不能信签名看起来对；
2. **同一实体多入口写入时，下游分流依据必须收敛**——按 authType 分流的
   派发点要么归一字段，要么对特例 provider 短路；
3. **脱敏是安全契约**：新增透传字段时，把"响应全文不含密钥字面量"写成
   断言，别靠人眼。
