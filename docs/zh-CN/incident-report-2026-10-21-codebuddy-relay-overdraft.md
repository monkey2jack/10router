# 事故复盘与故障报告：CodeBuddy CN 到期优先调度失效致「余师洋」账号透支 (T0)

> **事故等级**：T0（生产调度逻辑缺陷致核心资产非预期消耗）  
> **故障模块**：`open-sse/services/usage/expiryExtractor.js`、`open-sse/services/relaySelection.js`、`src/sse/services/auth.js`  
> **涉及服务**：CodeBuddy CN 多账号调度通道  
> **受影响账号**：`余师洋`（积分被异常集中透支至 623.82 / 4,550，34 个资源包被连续击穿）  
> **修复版本**：v1.5.2-patch (2026-10-21)

---

## 一、 事故现象与业务影响

### 1. 现场事实
在 10Router 配额管理面板中，配置了 4 个 CodeBuddy CN 账号并全部开启「到期优先调度 (Earliest Expiry First)」：
- `1698`：可用 2,534.83 积分，最早赠送包剩余 **10天 13小时** 到期；
- `1697`：可用 2,555.5 积分，最早赠送包剩余 **10天 13小时** 到期；
- `洋芋`：可用 2,022.12 积分，最早赠送包剩余 **15天 12小时** 到期；
- `余师洋`：初始 4,550 积分，最早赠送包剩余 **26天 6小时** 到期（**全池最晚到期**）。

### 2. 故障表现
- 系统**完全没有将流量路由给最急迫（10天后到期）的 1698 与 1697 账号**；
- 流量被 100% 持续、单一地锁死在到期时间最充裕（26 天后到期）的「余师洋」账号上；
- 「余师洋」账号总共 40 个资源包中有 **34 个被连续击穿抽干**，积分从 4,550 剧烈透支至 623.82；
- 与此同时，真正即将到期的 1698 / 1697 账号资产处于零消耗闲置状态，面临过期作废风险。

---

## 二、 根因剖析（Root Cause Analysis）

经过断点级代码调用推演，确认该事故由 **四重逻辑缺陷层层嵌套、相互共振** 引起：

```
[codebuddy-cn 基础包标记为 recurring: true]
                 │
                 ▼
[expiryExtractor: 错误地认为 recurring 耗尽依然要保留 resetAt]
                 │
                 ▼
[10-31 月末重置时间强行劫持所有账号的 earliestPackageExpiry]
                 │
                 ▼
[auth.js 排序: timeA === timeB，到期排序失效，退化为静态优先级]
                 │
                 ▼
[余师洋排在优先级 #1 (ring[0])] ───┐
                                    ├──► [流量被死锁在余师洋身上，狂抽 34 个包]
[Monthly 归零导致 minRemaining=0% ──┤
 触发 relaySelection 全红兜底: 永远打 ring[0]]
```

### 缺陷 1：`Monthly` 基础包标记为 `recurring: true`，耗尽后劫持到期时间戳
在 `open-sse/services/usage/codebuddy-cn.js` 中，基础体验包被标记为 `Monthly`（`recurring: true`，每月最后一天如 10-31 重置）。
在 `open-sse/services/usage/expiryExtractor.js` 中存在一段豁免逻辑：
```javascript
// 历史代码：只有 non-recurring 耗尽才会 return
if (pkg.recurring !== true) {
  if (total > 0 && used >= total) return;
  if (pkg.remaining <= 0) return;
}
```
**设计本意**：针对 Antigravity 这种 5 小时循环速率桶，即使桶空了，5小时后的重置时间依然是徽章需要展示的。  
**现场崩塌**：CodeBuddy 的 `Monthly` 实质上是一个**资产赠送包**。即便它的 500 点基础分**早已用尽（used=500, total=500）**，算法依然不放过它。由于 `Monthly` 的重置日（10-31）比余师洋的真实存活赠送包（11-17）更早，**`Monthly` 强行占领了 `earliestPackageExpiry`**。  
结果：**池内所有账号提取出的到期时间全部变成了同一个 `10-31T16:00:00Z`**。

### 缺陷 2：时间戳相同导致到期排序失效，退化为静态优先级
在 `src/sse/services/auth.js` 中：
```javascript
orderedConnections = [...availableConnections].sort((a, b) => {
  const timeA = (a.earliestPackageExpiry && new Date(a.earliestPackageExpiry).getTime() > now) ? ... : Infinity;
  const timeB = (b.earliestPackageExpiry && new Date(b.earliestPackageExpiry).getTime() > now) ? ... : Infinity;
  if (timeA !== timeB) return timeA - timeB;
  return (a.priority || 999) - (b.priority || 999);
});
```
由于每个账号的 `earliestPackageExpiry` 都被 `Monthly` 强行写成了同一天，`timeA === timeB`，到期排序完全失效，直接退化为 `a.priority` 排序。而在列表最上方的「余师洋」拥有最高优先级，被固定排在了队首（`ring[0]`）。

### 缺陷 3：`Monthly` 归零污染红区信号，Relay 触发全红死锁
在 `expiryExtractor.js` 中遍历计算账号剩余比例 `minRemaining`：
```javascript
const remaining = liveRemainingPercentage(pkg); // 耗尽的 Monthly 返回 0%
if (remaining !== null && remaining < minRemaining) minRemaining = remaining; // 变成 0%
```
无论账号整体还剩几千分，只要 `Monthly` 被用完，账号的 `earliestPackageRemaining` 全部被硬赋值为 **0%**。  
在 `open-sse/services/relaySelection.js` 中：
- `isCarrierHealthy` 要求剩余必须 `>= 5%`，因此所有账号全部被判定为“不健康”；
- 命中第 107 行全红兜底策略：
  ```javascript
  // Nothing healthy: fall back to the head of the ring...
  return { connection: ring[0], stepped: prevIdx !== 0 };
  ```
- **算法彻底放弃接力与换号，每一笔请求都永远死锁在 `ring[0]`（余师洋）头上！**

### 缺陷 4：Relay 接力机制接管轮询，禁止了任何自然换号
在 `src/sse/services/auth.js` 中，开启 `earliestExpiryFirst` 会直接短路掉 `round-robin`。由于 Relay 坚信首位是唯一候选，且轮询被抑制，导致全网流量源源不断地只打向一个账号。

---

## 三、 修复方案与代码变更

### 1. 到期提取算法修复（`open-sse/services/usage/expiryExtractor.js`）
区分“速率限制窗口”与“资产赠送型周期包”：对标记为 `giftPack: true`（如 CodeBuddy Monthly）的周期包，一旦其额度耗尽（`used >= total`），**立即退出计算，绝不劫持到期日**：
```javascript
const isExhausted = () => {
  const used = Number(pkg.used ?? 0);
  const total = Number(pkg.total ?? 0);
  if (total > 0 && used >= total) return true;
  if (pkg.remaining !== undefined && Number(pkg.remaining) <= 0) return true;
  if (pkg.remainingPercentage !== undefined && Number(pkg.remainingPercentage) <= 0) return true;
  return false;
};

if (pkg.recurring !== true || pkg.giftPack === true) {
  if (isExhausted()) return;
}
```

### 2. 供应商属性标注（`open-sse/services/usage/codebuddy-cn.js`）
在 CodeBuddy CN 的 usage handler 中，为 `Monthly` 显式打上 `giftPack: true`，明确其为配额包而非限速窗口。

### 3. 排序与流量调度回归
- 修复后，系统正确穿透已耗尽的 Monthly，识别各账号真实存活包到期日：
  `1698 (10d)` ➔ `1697 (10d)` ➔ `洋芋 (15d)` ➔ `余师洋 (26d)`
- 流量恢复严格按到期日从近到远消耗；余师洋账号自动安全挂起并受到保护。

---

## 四、 预防措施与长效机制

1. **多包型供应商回归测试**：在 `tests/unit/earliest-expiry-first.test.js` 中追加包含“已耗尽月度包 + 存活多赠送包”的真实场景断言；
2. **红区信号防穿透保护**：对于多资源包账号，`earliestPackageRemaining` 以全账号可用总额或活跃包为基准，禁止已死亡的孤包拉低全局健康度；
3. **监控告警与可视化**：在 Quota 页面上继续强化每个账号的存活包到期提示，并在日志中输出每次 relay 选号命中的账号名称与剩余到期时长。
