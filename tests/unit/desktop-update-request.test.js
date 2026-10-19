// 仪表盘 → 壳 更新握手 marker(desktop/updateRequest.js)的消费端纯逻辑。
// 契约的写入端在 src/lib/updateCheck.js(writeUpdateRequest),其行为测试在
// shell-update-route.test.js —— 两侧的文件名与 JSON 形状必须保持一致。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import updateRequest from "../../desktop/updateRequest.js";
const { MAX_AGE_MS, parseUpdateRequest, consumeUpdateRequest, requestPath } = updateRequest;

const NOW = 1_800_000_000_000;

describe("parseUpdateRequest", () => {
  it("accepts a fresh request and keeps the informational version", () => {
    const raw = JSON.stringify({ version: "1.3.2", requestedAt: NOW - 1000 });
    expect(parseUpdateRequest(raw, { now: NOW })).toEqual({ requestedAt: NOW - 1000, version: "1.3.2" });
  });

  it("rejects broken JSON, non-objects and missing/invalid requestedAt", () => {
    expect(parseUpdateRequest("not json", { now: NOW })).toBeNull();
    expect(parseUpdateRequest("42", { now: NOW })).toBeNull();
    expect(parseUpdateRequest(JSON.stringify({ version: "1" }), { now: NOW })).toBeNull();
    expect(parseUpdateRequest(JSON.stringify({ requestedAt: "x" }), { now: NOW })).toBeNull();
    expect(parseUpdateRequest(JSON.stringify({ requestedAt: 0 }), { now: NOW })).toBeNull();
  });

  it("rejects requests older than the freshness window", () => {
    const raw = JSON.stringify({ requestedAt: NOW - MAX_AGE_MS - 1 });
    expect(parseUpdateRequest(raw, { now: NOW })).toBeNull();
  });

  it("tolerates a small clock skew into the future, rejects a large one", () => {
    const slightlyAhead = parseUpdateRequest(JSON.stringify({ requestedAt: NOW + 4 * 60 * 1000 }), { now: NOW });
    expect(slightlyAhead?.requestedAt).toBe(NOW + 4 * 60 * 1000);
    expect(parseUpdateRequest(JSON.stringify({ requestedAt: NOW + 10 * 60 * 1000 }), { now: NOW })).toBeNull();
  });

  it("coerces a non-string version to empty string", () => {
    const raw = JSON.stringify({ version: 7, requestedAt: NOW });
    expect(parseUpdateRequest(raw, { now: NOW })?.version).toBe("");
  });
});

describe("consumeUpdateRequest", () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "10r-update-req-")); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  const writeReq = (obj) =>
    fs.writeFileSync(requestPath(dir), typeof obj === "string" ? obj : JSON.stringify(obj), "utf8");

  it("returns the request and deletes the file (one-shot)", () => {
    writeReq({ version: "1.3.2", requestedAt: Date.now() });
    const req = consumeUpdateRequest(dir);
    expect(req?.version).toBe("1.3.2");
    expect(fs.existsSync(requestPath(dir))).toBe(false);
    expect(consumeUpdateRequest(dir)).toBeNull();
  });

  it("returns null and still deletes the file when it is corrupt", () => {
    writeReq("{broken");
    expect(consumeUpdateRequest(dir)).toBeNull();
    expect(fs.existsSync(requestPath(dir))).toBe(false);
  });

  it("returns null and still deletes the file when it is stale", () => {
    writeReq({ requestedAt: Date.now() - MAX_AGE_MS - 60_000 });
    expect(consumeUpdateRequest(dir)).toBeNull();
    expect(fs.existsSync(requestPath(dir))).toBe(false);
  });

  it("returns null without throwing when no file exists", () => {
    expect(consumeUpdateRequest(dir)).toBeNull();
  });
});
