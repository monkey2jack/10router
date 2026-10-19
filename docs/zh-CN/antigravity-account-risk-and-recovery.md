# Antigravity 账号风险与恢复（用户向）

> **用途**：讲清 Antigravity（反重力）渠道的**账号形态风险**与**被风控后怎么处理**——低价家庭拼车为什么容易翻车、付款资料地区怎么对齐、403 之后该做什么、风控恢复要多久。
> **定位**：本文面向**使用者**；技术排障（错误码 → 根因 → 出路、代码文件索引）见 [antigravity-integration-guide.md](./antigravity-integration-guide.md)。
> **信源标注**：带「官方」标记的来自 Google 官方文档/支持回复；带「社区」标记的是拼车圈经验汇总，**非官方承诺**，不要当铁律去跟车头争论。

---

## 〇、先读这段：10Router 在这里是什么角色

10Router 的 antigravity 渠道**对外表现为一个合格的官方 IDE 客户端**（复用官方 IDE 的 clientId/clientSecret 与 UA，见技术文档 §一）。因此：

- Google 的账号级门禁（风控 / 地区 / 资格 / 年龄）会**原样落在你绑定的那个 OAuth 账号上**
- 触发风控的**主因是账号本身形态**——拼车号、新小号、机房 IP、频繁换环境——**而不是"用了路由器"这件事本身**
- 但**第三方 OAuth 调用确实是风控的一个观察面**：同一账号短时间内在多个客户端/多个 IP 反复授权，会被计入异常特征

**结论**：账号够干净（独立订阅、住宅 IP、环境稳定），用不用路由器都不容易出事；账号本身是拼车号/机房 IP，不用路由器也一样会被标记。**别把"路由器"当成风控的根因，也别把它当成免罪符。**

---

## 一、低价 Google One（AI Premium）拼车风险

Antigravity 的额度需要 **Google One AI Premium** 权益。市面上低价车大多是**家庭组拼车共享**（一个车头的 AI Premium 分给组内成员），**不是独立订阅**——风险远高于自己购买。

> ⚠️ 以下为**社区**高频踩坑汇总，请当作"可能发生的场景"而非官方规则。

### ⚠️ 重大风险

**1. 12 个月冷却锁（社区）**
账号一旦退出/被踢出家庭组，**12 个月内不能加入任何其他家庭组**。车头跑路、订阅被封，你的账号直接废掉一年无法上车。

**2. 车头账号风险完全传导给你（社区）**
低价车车头很多使用虚拟卡、盗刷卡、违规优惠开通。车头被 Google 风控 → 订阅直接取消 → 你瞬间丢失 Antigravity / Gemini Pro / 云存储；严重时你的账号连带被标记风控。

> 👉 **不要把重要私人 Gmail 账号上陌生低价车**，建议专门小号。

**3. 地区硬性匹配（社区 + 官方可佐证）**
家庭组校验的是 **Play 商店付款资料地区**，**不是代理 IP、也不是账号注册地区**。
- 你的付款资料地区必须和车头**完全一致**，否则无法接受家庭邀请
- 频繁切换付款地区会触发账号风控
- 国内原生账号大概率无法加入美区家庭组，需要先关闭旧付款资料再建立对应地区资料

**4. 额度并非完全独立（社区）**
家庭组共享套餐，Antigravity 的 agent 额度存在灰度共享，组内其他人重度使用会消耗你的可用额度；云存储空间全家共用（文件本身互相不可见）。

**5. 共享开关会自动关闭（社区）**
车头需要手动开启「与家庭成员共享 Google One」，该开关**会随机自动关闭**。关闭后你直接失去 AI Premium 权益——**不是你账号的问题**，需要车头重新打开开关。

### ✅ 上车前账号自查清单

- 账号**不要有正在生效的 Google One 订阅**（加入家庭组前需先取消自有订阅并等待过期）
- **清理付款资料**，将 Play 付款地区修改为与车头完全一致的地区，等待系统同步（社区称最长 24h）
- **完成账号年龄验证**：<https://myaccount.google.com/age-verification>
  —— 未验证会出现"拿到家庭权限但无法使用 Gemini/Antigravity"的分裂现象（见 §三）
- 确认账号**过去 12 个月没有加入过其他家庭组**（社区），否则无法接受邀请
- 邀请邮件大概率进垃圾邮件/推广标签，注意查收，优先用 Gmail 接收

### 🛠️ 成功加入后的可用性校验

| 检查项 | 位置 | 期望 |
|---|---|---|
| AI Premium 权益标识 | <https://one.google.com/settings> | 显示已获得 AI Premium |
| Antigravity 刷新周期 | Antigravity 客户端 `/usage` 页面 | **5 小时刷新 = 正常 Pro 权益**；7 天 = 未生效 |
| 异常现象 | —— | Gemini 可以 Pro，但 Antigravity 依旧低额度 → 等 1–6 小时同步，或重新登录账号 |

---

## 二、Play 付款资料地区修改

> ⚠️ **硬性铁则（社区）**：只要账号已经加入家庭组，你就**没有**修改 Play 付款国家的按钮。必须先退出家庭组 → 改完地区 → 再重新接受家庭邀请。
> 而退出家庭组会触发 **12 个月冷却锁**——这是本流程最大的风险。**小号操作，不要拿主号乱试。**

### 前置限制（踩中就改不了）

- 🔒 **冷却周期**：Play 付款资料 12 个月只能切换 1 次国家，改完 1 年内不能再次切换
- 🔒 **家庭组锁**：身处家庭组内 → 修改国家选项**直接消失**
- 🪪 必须提供**目标国家的本地账单地址**（美区需填美国地址）
- ⏱️ 修改完成后全 Google 服务同步需 2–48 小时，**Antigravity 不会立刻生效**
- 💰 旧地区 Play 余额无法在新地区使用

### 完整操作流程（网页端 pay.google.com，不要用安卓 Play 商店）

1. **退出当前家庭组**：访问 <https://families.google.com> 退出。
   ⚠️ 一旦退出即进入 12 个月家庭组冷却期，务必确认。
2. 打开 <https://pay.google.com/> 登录目标账号 → 右上角 **设置 ⚙️**
3. 找到 **付款资料** → 创建/编辑付款资料
4. **删除全部旧的其他地区付款配置文件**，只保留一份
5. 将国家/地区修改为与车头完全一致的国家（Antigravity 需要 **United States**）
6. 填写美国有效账单地址（街道、城市、州、邮编）
   —— 社区称不绑可用信用卡也能建立美区付款资料档案，但部分账号强制要求添加本地支付方式才能保存地区修改
7. 保存，确认国家显示 **United States**
   —— 校验位置：pay.google.com → 设置 → 付款资料
8. **等待系统同步**：最低 2 小时，最长 48 小时。
   不要改完立刻接受邀请，社区称这样经常校验失败。
9. 同步完成后接收家庭组邀请，加入车头家庭组
10. 加入后 Play 付款国家**锁死**，直到将来退出家庭组（又触发 12 个月冷却）
11. 全部完成后用**无痕窗口**打开 <https://antigravity.google.com>，使用**美国原生住宅 IP** 访问测试

### 🚩 高频踩坑（对应 `ineligible location` / location 类报错）

- ❌ 只改代理 IP、不改 Play 付款资料 → 依旧报地区不可用（Antigravity 优先读付款资料地区，不是 IP）
- ❌ 已经在家庭组内还试图修改地区 → 找不到修改按钮
- ❌ 改完付款资料立刻测 Antigravity → Google 后端没同步，持续报错，耐心等同步窗口
- ❌ 使用数据中心/机房代理 IP → 哪怕付款资料是美区，仍可能被拦；需要原生住宅 IP
- ❌ 一个账号短时间内反复切换家庭组、切换付款地区 → 被风控标记，可能永久无法使用

### 备选方案（拼低价车场景非常推荐）

因为退出家庭组 = 12 个月冷却锁风险极高，**直接用全新空白小号**：新账号还没加入过家庭组，直接新建美区付款资料，再接受家庭邀请。**避免主力账号触发 12 个月家庭锁。**

### 校验是否修改成功的检查清单

- [ ] pay.google.com 设置页：付款资料国家 = **United States**
- [ ] families.google.com：确认不在任何家庭组（加入后应显示已在家庭）
- [ ] myaccount.google.com/age-verification：**完成年龄验证**
- [ ] one.google.com：确认 AI Premium 权益显示
- [ ] antigravity.google.com 无痕窗口 + 美区住宅 IP 访问，不再弹 location 报错

> 补充：**即使 Gemini 网页版 AI Premium 正常可用，Antigravity 依然独立校验 Play 付款资料地区 + 访问 IP，两者缺一不可。**

---

## 三、年龄验证（18+ 硬门槛）

**这是 `VALIDATION_REQUIRED` 的首要原因，先于其它风控原因排查。**

Antigravity 官方 FAQ 明写：

> **Why is my age unverified?** At the moment, Antigravity is unavailable to under-18 users. If you do meet the minimum age requirement, you may verify your age to continue using Antigravity.
> —— 官方：<https://antigravity.google/docs/faq>

Google 支持团队给出的自助入口（官方）：

| 入口 | 用途 |
|---|---|
| <https://myaccount.google.com/birthday> | 核对/补全生日（先确认生日已填且正确） |
| <https://myaccount.google.com/age-verification> | 完成年龄验证（要求验证时走这里） |

**典型症状**：
- 请求返回 `403` + `"Verify your account to continue."` + `reason: VALIDATION_REQUIRED`
- 更迷惑的形态：**Gemini 权益正常但 Antigravity 仍不可用**——权益层过了，Antigravity 自己的资格校验没过

技术排查细节（`validation_url` 用法、`plt=` 时效、重试时机）见技术文档 §三。

---

## 四、403 被风控：分级与恢复时效

> ⚠️ 本节时效为**社区**经验汇总，**非 Google 官方 SLA**，实际以 Google 回复为准。

### 先判断：是哪种受限？

| 类型 | 表现 |
|---|---|
| **仅 AI 接口受限** | 网页可登录、账号可用，仅 Antigravity / Gemini 高级 API 被锁（403） |
| **完整账号停用** | 无法登录 |

**注意**：API 权限受限 ≠ 账号全封。别一看到 403 就当成账号没了。

### 恢复时效（社区经验）

**仅 AI 接口受限**：
- 轻度自动风控：静置 **24–72 小时**自动恢复
- 中度人工风控：提交申诉 **3–7 个工作日**
- 重度标记（路由器中转场景）：最长 **1–2 周**，或**永久锁死 AI 权限**

**完整账号停用**：
- 常规申诉：**1–3 个工作日**
- 高峰期：**3–7 个工作日**
- 多次重复提交申诉会直接降权、拒审

### 为什么拼车用户高危（社区）

- 新小号 + 无完整美区付款资料
- 低价家庭组拼车（风控重点监测群体）
- 第三方 OAuth 调用（非官方客户端）
- 短时间内频繁登录、切换 IP、反复重授权
- 机房/代理 IP，非原生住宅美 IP

> 这类账号**申诉通过率远低于正常独立订阅用户**。

---

## 五、申诉前置准备（必须先做完再提交）

> 社区经验：不做前置操作，申诉基本会被直接驳回。

1. **立即停止所有 API 调用**
   - 在 10Router 里**删除该账号连接**，彻底停止调用
   - 禁止反复登录/退出/重授权，避免加重风控标记
2. **清理第三方 OAuth 授权**
   - 访问 <https://myaccount.google.com/connections>
   - 删除 Antigravity、Cloud AI Companion、以及所有不明的第三方/OAuth 授权
3. **固定干净网络环境**
   - 使用稳定的**美国原生住宅 IP**，全程不切换节点
   - 仅用浏览器网页登录，不要在此期间使用第三方客户端
4. **账号基础校验**
   - ✅ 确认 **18+ 年龄验证**已完成
   - ✅ Google One AI Premium 权益在网页端正常显示
   - ✅ 冷置账号至少 **6 小时**再提交申诉

---

## 六、申诉入口

### 场景 A：账号网页能登录，只是 API 返回 403

1. 用**干净美区 IP** 登录被限制账号
2. 打开 Gemini API 支持表单：<https://support.google.com/geminiapi/contact/gemini_api_support>
3. 填写要点：
   - 产品：Gemini API
   - 问题类型：Access / Permission issues
   - 描述：英文（下述模板），**表单不要粘中文**
   - 附上 403 错误截图（隐藏隐私信息）
4. 提交，等待邮箱回复
   —— **禁止重复多次提交**，社区称重复提交会直接被拒

> 备选入口：<https://support.google.com/accounts/gethelp>

**英文申诉模板（仅 API 受限场景）**：

> ⚠️ 提交前整改动作务必先做实（邮件里写了就要真做了，Google 后台查得到）：
> 清理 <https://myaccount.google.com/connections> 全部第三方 OAuth 授权 + 在浏览器里实际走完一次
> 验证流程（含年龄验证）→ 改密码 → 开两步验证。
> 描述里**不要解释触发原因**，不提路由器/中转/代理等任何敏感词，用行动替代辩解。

```text
Dear Google Gemini API Support Team,

I am writing about a `403 PERMISSION_DENIED` error ("Verify your
account to continue") returned when calling the Gemini API from my
personal Google account ({{your_account}}@gmail.com), which I use
for coding, learning, and development experiments.

Since encountering the error, I have taken the following steps to
secure the account:
• Reviewed and removed all third-party application access and unused
  OAuth authorizations from my account settings
• Completed the account verification flow in a browser, including
  age verification
• Changed my password and enabled two-step verification

I respectfully believe this restriction may have been triggered in
error. I am fully committed to complying with Google's Terms of
Service and policies, and would be grateful for a manual review of
my account's API access and the opportunity to restore it.

Thank you for your time and consideration.

Sincerely,
{{Name}}
{{your_account}}@gmail.com
```

**中文对照（仅供核对，表单不要粘贴中文）**：

> 我写信是关于我的个人 Google 账号（{{your_account}}@gmail.com）调用 Gemini API 时返回的 `403 PERMISSION_DENIED`（"Verify your account to continue"）错误。该账号用于我个人的编程、学习和开发实验。遇到错误后，我已采取以下措施保障账号安全：审查并移除了所有第三方应用访问和未使用的 OAuth 授权；在浏览器中完成了账号验证流程（含年龄验证）；修改了密码并启用两步验证。我尊重地认为该限制可能是误判，恳请人工复核我的账号 API 访问权限并予以恢复。我承诺完全遵守 Google 服务条款。谢谢。

### 场景 B：账号整体被停用，网页无法登录

1. 干净美 IP 浏览器打开：<https://accounts.google.com/signin/recovery>
2. 输入账号，按页面提示选择「账号被停用」
3. 填写申诉表单，粘贴英文模板（下述）
4. 提交，等待 Google 邮件回复

**英文申诉模板（账号停用场景）**：

> ⚠️ 提交前三项整改动作务必先做实（邮件里写了就要真做了，Google 后台查得到）：
> 清理 <https://myaccount.google.com/connections> 全部第三方 OAuth 授权 → 改密码 → 开两步验证。
> 描述里**不要解释触发原因**（"多网络环境""连接不稳定"等说法等于自认异常行为），用行动替代辩解。

```text
Dear Google Account Review Team,

I am writing to appeal the suspension of my Google account
({{your_account}}@gmail.com), which I use personally as an individual
developer for coding, learning, and Google Cloud experimentation.

This account is central to my daily development work, and its suspension
has brought my personal projects to a halt. I respectfully believe the
suspension may have been triggered in error.

Since receiving the notice, I have taken the following steps to secure
the account:
• Reviewed and removed all third-party application access and unused
  OAuth authorizations from my account settings
• Changed my password and enabled two-step verification
• Confirmed my account details, including age verification, are complete

I am committed to fully complying with Google's Terms of Service and
policies. I would be grateful for a manual review of my account, and
for the opportunity to restore access.

Thank you for your time and consideration.

Sincerely,
{{Name}}
{{your_account}}@gmail.com
```

> ⚠️ **API 权限受限优先走 Gemini API 支持表单**，不要走账号恢复表单——入口不对会无人处理。

---

## 七、申诉后跟进规则（社区经验）

1. 提交后**不要反复登录测试 API**，保持账号冷置
2. 查看申诉关联的 Gmail 邮箱，所有通知发到此邮箱
3. 时效参考 3–7 个工作日，高峰期延长
4. 结果判定：
   - 收到**模板拒绝回复** → API 权限大概率永久封禁
   - **7 天无回复** → 部分情况静默解封，继续静置，间隔 24 小时轻量测试
   - **申诉通过** → 恢复 AI 接口权限，但**不要再立刻高频调用**

**判定标准（社区"7 天定生死"）**：

| 情况 | 结论 |
|---|---|
| 7 天内收到模板拒绝 | 该账号 Antigravity 永久报废，无法恢复 |
| 7 天无回复 | 大概率静默解封，继续冷置 |

---

## 八、避坑总结

- **陌生低价家庭拼车**：只用小号，绝不放私人邮件、照片、重要数据
- **优先问清车头**是否为自己真实信用卡订阅，拒绝虚拟卡/盗刷车头
- **心理预期**：拼车随时翻车，不要做生产唯一依赖
- **最稳妥方案**：自己办理当地可用支付方式，独立订阅 Google One AI Premium
- **重度风控账号直接放弃**：拼车小号一旦被 `VALIDATION_REQUIRED` 标记，折腾恢复的成本 > 换新干净小号

### 新号永久避坑规则

- 新号**先建好美区付款资料、完成年龄验证**，再进家庭组
- 刚上车 **24 小时内严禁任何 API 调用**
- 优先官方网页/官方插件，**控制第三方客户端调用频率**
- **固定 IP**，不要频繁切换节点、设备、登录环境

---

## 九、安全使用 Antigravity 本身

- **不要在主力生产机器直接给完整本地权限**，建议虚拟机/沙盒环境运行。Agent 会自主执行 shell 命令，有删除文件风险；关闭无确认的自动执行模式。
- **不要直接导入带密钥、业务敏感密码的项目**——代码默认可能用于 Google 模型训练，企业敏感代码禁止直接使用。
- **额度耗尽会直接强制终止任务**，生产业务不要强依赖。

---

## 免责声明

家庭组共享属于 Google 官方功能，但第三方低价拼车存在大量违规操作风险（虚拟卡、盗刷卡、违规优惠等），使用产生的账号损失**自行承担**。本文中标注「社区」的内容为拼车圈经验汇总，非 Google 官方规则，仅供参考。

---

## 相关文档

| 文档 | 内容 |
|---|---|
| [antigravity-integration-guide.md](./antigravity-integration-guide.md) | 技术接入与排查：错误码 → 根因 → 出路、`validation_url` 用法、模型 tiered 寻址、配额端点、代码文件索引 |
| [antigravity-account-risk-and-recovery.md](./antigravity-account-risk-and-recovery.md)（本文） | 用户向：拼车风险、付款资料地区、年龄验证、风控分级与申诉 |
