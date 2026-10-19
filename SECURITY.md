# 安全政策（Security Policy）

## 支持的版本

| 版本 | 是否接收安全修复 |
| --- | --- |
| 最新 Release（当前 v1.2.x） | ✅ |
| 更早版本 | ❌ 请先升级到最新版 |

## 如何报告漏洞

**请勿在公开 Issue 中描述未披露的漏洞。** 请使用 GitHub 的私有漏洞报告通道：

→ **https://github.com/techysy/10router/security/advisories/new**

报告时请尽量附上：影响的版本与部署形态（npm / Docker / fnOS fpk / 桌面端）、复现步骤或 PoC、你评估的影响面。**不要在报告或任何公开渠道粘贴真实凭据**（上游 API key、OAuth token、仪表盘密码）。

## 响应节奏

- **72 小时内**确认收到；
- **7 天内**给出影响评估与修复计划；
- 修复随下一个 patch 版本发布；对「可未授权读取凭据 / 完全绕过鉴权」级别的问题，会提前发独立的 patch 版本；
- 修复发布前，报告人可全程参与修复方案的讨论与验证；发布后在 advisory 中致谢（除非你希望匿名）。

## 范围

**在范围内**：仪表盘鉴权与会话（登录绕过、JWT 处理）、凭据存储与传输路径、上游请求代理与翻译层（注入、SSRF）、MITM 组件、更新器供应链、CLI。

**不在范围内**：

- 需要对 `$DATA_DIR` 有写权限的攻击路径 —— 能写数据目录者本就能读整库（含密码重置入口），等同已完全失陷，不作为漏洞处理（#33 中已论证）；
- 对上游供应商自身服务的滥用；
- 自托管部署中由运维配置直接导致的问题（如显式开放公网且未设置密码）。

## 安全港

以善意目的、在报告前后不利用漏洞影响真实用户数据、不发起破坏性测试的前提下进行的本地安全研究，不会被追究。

## 已公开的安全议题

v1.0.7 第三方审计的 11 项清单与修复进度在 #9 公开跟踪（同族项 #31 单独追踪）。历史修复记录见 `CHANGELOG.md` 各版本的 🔒 段落。

---

## English Summary

**Do not open public issues for undisclosed vulnerabilities.** Use GitHub Private Vulnerability Reporting: <https://github.com/techysy/10router/security/advisories/new> — acknowledged within 72 hours, assessed within 7 days; fixes ship in the next patch release (out-of-band for auth-bypass / credential-exposure issues). Out of scope: attacks requiring write access to `$DATA_DIR` (equivalent to full compromise — see #33), abuse of upstream providers, and misconfigurations explicitly chosen by the operator. Supported versions: the latest release line only. See the Chinese sections above for full details.
