// Stale-error consumption on credential (re)provisioning.
//
// Dashboard red text (connection.lastError / testStatus) belongs to the OLD
// credentials once the user re-adds a key or re-authorizes — it must be
// consumed by the re-provisioning itself, not only by the next successful
// request (otherwise the row keeps screaming "Desktop session unavailable"
// until a page reload happens to refetch a DB that was never cleaned).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let db;

beforeAll(async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "10router-err-reset-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterAll(() => {
  try {
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  } catch { /* noop */ }
});

async function makeConnection(overrides = {}) {
  return db.createProviderConnection({
    provider: "xiaomi-mimo",
    authType: "api_key",
    name: `conn-${Math.random().toString(36).slice(2)}`,
    accessToken: "sk-old",
    ...overrides,
  });
}

describe("updateProviderConnection — resetErrorState", () => {
  it("clears stored failure fields", async () => {
    const conn = await makeConnection();
    await db.updateProviderConnection(conn.id, {
      lastError: "Desktop session unavailable — sign in to MiMo Desktop once, then re-import",
      lastErrorAt: new Date().toISOString(),
      errorCode: 502,
      testStatus: "unavailable",
    });
    let row = await db.getProviderConnectionById(conn.id);
    expect(row.lastError).toBeTruthy();

    row = await db.updateProviderConnection(conn.id, {
      accessToken: "sk-new",
      resetErrorState: true,
    });
    expect(row.lastError).toBeNull();
    expect(row.lastErrorAt).toBeNull();
    expect(row.errorCode).toBeNull();
    expect(row.testStatus).toBeNull();
    expect(row.accessToken).toBe("sk-new");
    // The flag itself must never leak into the persisted row / data JSON.
    expect(row.resetErrorState).toBeUndefined();
    const raw = JSON.stringify(row);
    expect(raw).not.toContain("resetErrorState");
  });

  it("explicit error fields in data win over the reset", async () => {
    const conn = await makeConnection();
    await db.updateProviderConnection(conn.id, { lastError: "boom", errorCode: 429 });
    const row = await db.updateProviderConnection(conn.id, {
      lastError: null,
      testStatus: "active",
      resetErrorState: true,
    });
    expect(row.testStatus).toBe("active");
    expect(row.lastError).toBeNull();
  });

  it("without the flag, stored errors survive unrelated updates", async () => {
    const conn = await makeConnection();
    await db.updateProviderConnection(conn.id, { lastError: "boom", testStatus: "unavailable" });
    const row = await db.updateProviderConnection(conn.id, { displayName: "renamed" });
    expect(row.lastError).toBe("boom");
    expect(row.testStatus).toBe("unavailable");
  });
});

describe("createProviderConnection — dedup merge consumes stale failure", () => {
  it("re-provisioning an oauth row by email clears lastError and un-sticks testStatus", async () => {
    const conn = await db.createProviderConnection({
      provider: "github",
      authType: "oauth",
      email: "dup@example.com",
      accessToken: "old-token",
      testStatus: "active",
    });
    await db.updateProviderConnection(conn.id, {
      lastError: "HTTP 401: token expired",
      lastErrorAt: new Date().toISOString(),
      errorCode: 401,
      testStatus: "unavailable",
    });

    const merged = await db.createProviderConnection({
      provider: "github",
      authType: "oauth",
      email: "dup@example.com",
      accessToken: "fresh-token",
    });
    expect(merged.id).toBe(conn.id);
    expect(merged.accessToken).toBe("fresh-token");
    expect(merged.lastError).toBeNull();
    expect(merged.lastErrorAt).toBeNull();
    expect(merged.errorCode).toBeNull();
    // Stale "unavailable" badge → active; never null (would render "Unknown").
    expect(merged.testStatus).toBe("active");
  });

  it("keeps an explicit testStatus from the caller", async () => {
    const conn = await db.createProviderConnection({
      provider: "github",
      authType: "oauth",
      email: "explicit@example.com",
      accessToken: "old",
    });
    await db.updateProviderConnection(conn.id, { lastError: "boom" });
    const merged = await db.createProviderConnection({
      provider: "github",
      authType: "oauth",
      email: "explicit@example.com",
      accessToken: "new",
      testStatus: "active",
    });
    expect(merged.lastError).toBeNull();
    expect(merged.testStatus).toBe("active");
  });
});
