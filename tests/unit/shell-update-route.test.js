// POST /api/version/shell-update —— 仪表盘 → 桌面壳 更新握手的写入端。
// 契约:仅 INSTALL_CHANNEL=desktop 接受(npm/Docker/fpk 没有壳在消费,拒之以免
// 按钮静默无效);version 只是信息字段,不合形即丢;成功即在 DATA_DIR 落
// update-request.json(文件名/形状见 src/lib/updateCheck.js,消费端
// desktop/updateRequest.js —— 该侧的解析/过期/一次性消费另有测试文件)。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { UPDATE_REQUEST_FILE } from "../../src/lib/updateCheck.js";

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "10r-shellupd-"));

let dir;
const requestPath = () => path.join(dir, UPDATE_REQUEST_FILE);

const post = (body) =>
  new Request("http://localhost/api/version/shell-update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

beforeEach(() => {
  dir = mkTmp();
  process.env.DATA_DIR = dir;
  process.env.INSTALL_CHANNEL = "desktop";
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  delete process.env.INSTALL_CHANNEL;
});

const { POST } = await import("../../src/app/api/version/shell-update/route.js");

describe("POST /api/version/shell-update", () => {
  it("writes the marker with the requested version on the desktop channel", async () => {
    const res = await POST(post({ version: "1.3.2" }));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    const stored = JSON.parse(fs.readFileSync(requestPath(), "utf8"));
    expect(stored.version).toBe("1.3.2");
    expect(Number.isFinite(stored.requestedAt)).toBe(true);
  });

  it("refuses non-desktop channels without writing anything", async () => {
    process.env.INSTALL_CHANNEL = "fpk";
    const res = await POST(post({ version: "1.3.2" }));
    expect(res.status).toBe(403);
    expect(fs.existsSync(requestPath())).toBe(false);
  });

  it("drops a malformed version but still accepts the request", async () => {
    const res = await POST(post({ version: "..\\evil\n" }));
    expect(res.status).toBe(200);
    expect(JSON.parse(fs.readFileSync(requestPath(), "utf8")).version).toBe("");
  });

  it("accepts an empty body (version is optional)", async () => {
    const res = await POST(undefined);
    expect(res.status).toBe(200);
    expect(JSON.parse(fs.readFileSync(requestPath(), "utf8")).version).toBe("");
  });
});
