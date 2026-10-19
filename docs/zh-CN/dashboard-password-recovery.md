# 仪表盘密码找回：reset-password 文件格式说明

> 适用版本：v1.2.1+（`.txt` 别名自 v1.3.1 起支持）。登录页「忘记密码？」面板内嵌同款说明。
> 实现：`src/lib/auth/passwordReset.js`；fnOS 由 App Center 设置页写入（`fnos-packaging/cmd/config_callback`）。

忘记或被锁在仪表盘外时（issue #33），无需重装：在**数据目录**放一个找回文件，下次登录尝试时自动生效。

## 文件格式

| 项 | 要求 |
|----|------|
| 文件名 | `reset-password`（一字不差）；带**任意扩展名**也可以（`reset-password.txt` / `.md` 等，v1.3.1+——Windows 上建无扩展名文件不便）。多个并存时无扩展名版本优先，其余按文件名字典序逐个生效。注意 `reset-password-old` 这类**不带点**的名字不会被当作找回文件 |
| 编码 | UTF-8 纯文本 |
| 内容 | **只写新密码本身**：单独一行，不带引号、不带 JSON、不带任何其他文字 |
| 空白 | 首尾空白与换行自动忽略（`trim`）；⚠️ 内容**中间**不能有换行——多行内容会把换行符算进密码 |
| 留空 | 文件为空：删除已存密码，回退到首次登录密码（fnOS 的 `initial-password` 文件 / `INITIAL_PASSWORD` 环境变量）；都没有则回到"本机设置首个密码"状态 |

## 数据目录位置

| 安装形态 | 路径 |
|----------|------|
| Windows | `%APPDATA%\10router` |
| macOS / Linux | `~/.10router` |
| Docker | 挂载的 `DATA_DIR` |
| fnOS | 应用卷上的 `@appdata/10router`（也可直接走 应用中心 → 10Router → 应用设置，填新密码保存，省去手动放文件） |

## 生效与安全

- **无需重启**：登录请求、`/api/auth/status`（登录页加载）、服务启动三个入口都会先消费该文件——放好后直接去登录页用新密码登录即可。
- **读后即删**：文件一旦被读取立即删除，明文不残留；判断成功的标准就是文件消失且新密码可登录。
- **权限边界**：能写数据目录的人本就可以读取其中整个数据库（含全部上游凭据），该机制不扩大任何攻击面。
- 首次登录的 fnOS 实例：安装时生成的随机密码在同目录 `initial-password` 文件里。

## 操作示例

Windows（PowerShell）：

```powershell
Set-Content -NoNewline -Encoding utf8 "$env:APPDATA\10router\reset-password.txt" "my-new-password"
```

macOS / Linux / Docker（容器内执行）：

```sh
printf 'my-new-password' > ~/.10router/reset-password
```

然后打开登录页，用 `my-new-password` 登录；文件消失即生效。
