// 仪表盘 → 壳 的更新握手：数据目录里的 marker 文件（与 reset-password /
// update-check-disabled 同一套「落文件、另一侧轮询消费」的约定）。仪表盘
// 「检查更新」发现新版本且本端是桌面安装时，POST /api/version/shell-update
// 写入此文件（服务端写入侧见 src/lib/updateCheck.js —— 文件名与 JSON 形状
// 两处必须同步改）；壳每 3 秒消费一次，命中即跑自己的 checkForUpdates()，
// 检查/下载/SHA256/安装全部复用壳的既有流程，文件里只承载「用户要更新」
// 这一个意图，不带任何权威数据。
const fs = require('fs');
const path = require('path');

const REQUEST_FILE = 'update-request.json';
const MAX_AGE_MS = 15 * 60 * 1000;   // 写入后未被消费的宽限期（壳中途退出时兜底过期）
const CLOCK_SKEW_MS = 5 * 60 * 1000; // requestedAt 落在未来的容忍量（双机时钟漂移）

function requestPath(dataDir) {
    return path.join(dataDir, REQUEST_FILE);
}

// 解析请求体。坏 JSON / 缺 requestedAt / 过老 / 超前过多 → null（调用方丢弃）。
function parseUpdateRequest(raw, { now = Date.now(), maxAgeMs = MAX_AGE_MS } = {}) {
    let obj;
    try { obj = JSON.parse(raw); } catch { return null; }
    if (!obj || typeof obj !== 'object') return null;
    const ts = Number(obj.requestedAt);
    if (!Number.isFinite(ts) || ts <= 0) return null;
    if (ts - now > CLOCK_SKEW_MS || now - ts > maxAgeMs) return null;
    return { requestedAt: ts, version: typeof obj.version === 'string' ? obj.version : '' };
}

// 读取并消费：文件无论内容好坏一律删除——请求只生效一次；删除失败时还有
// maxAge 兜底（15 分钟后过期）。无文件/坏文件/过期 → null。
function consumeUpdateRequest(dataDir, opts) {
    let raw;
    try { raw = fs.readFileSync(requestPath(dataDir), 'utf8'); } catch { return null; }
    try { fs.rmSync(requestPath(dataDir), { force: true }); } catch { /* best effort */ }
    return parseUpdateRequest(raw, opts);
}

module.exports = { REQUEST_FILE, MAX_AGE_MS, CLOCK_SKEW_MS, requestPath, parseUpdateRequest, consumeUpdateRequest };
