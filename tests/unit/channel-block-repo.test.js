// Channel-block persistence (settings.channelBlocks) against the REAL store.
//
// The unit file tests/unit/codebuddy-channel-block.test.js mocks @/lib/localDb
// wholesale, so it can never catch (a) the helpers missing from the localDb
// re-export shim (shipped once — every chat request 500ed at runtime), or
// (b) a lost-update race in the read-merge-write of the block map. This file
// runs the actual repo layer on a temp DATA_DIR.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "10router-channel-block-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterAll(() => {
  // Windows: SQLite handles release lazily after the pool closes, so rmSync
  // here can throw EPERM and fail the suite AFTER every test passed
  // (release-review v1.1.2 §六.2). Cleanup is best-effort.
  if (tempDir) { try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {} }
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("channel block repo (real store)", () => {
  it("helpers are exported through the localDb shim (regression: chat.js imports them from there)", async () => {
    const shim = await import("@/lib/localDb");
    expect(typeof shim.getChannelBlock).toBe("function");
    expect(typeof shim.setChannelBlock).toBe("function");
    expect(typeof shim.clearChannelBlock).toBe("function");
  });

  it("set → get → clear roundtrip", async () => {
    const block = { until: new Date(Date.now() + 60_000).toISOString(), lastAt: new Date().toISOString(), strikes: 1 };
    await db.setChannelBlock("prov-roundtrip", block);
    const got = await db.getChannelBlock("prov-roundtrip");
    expect(got).toMatchObject({ strikes: 1 });

    await db.clearChannelBlock("prov-roundtrip");
    expect(await db.getChannelBlock("prov-roundtrip")).toBeNull();
  });

  it("clearChannelBlock on a provider without a block is a no-op (does not clobber others)", async () => {
    const block = { until: new Date(Date.now() + 60_000).toISOString(), lastAt: new Date().toISOString(), strikes: 1 };
    await db.setChannelBlock("prov-keep", block);
    await db.clearChannelBlock("prov-absent");
    expect(await db.getChannelBlock("prov-keep")).not.toBeNull();
    await db.clearChannelBlock("prov-keep");
  });

  it("concurrent setChannelBlock for different providers — no lost update", async () => {
    const mk = (strikes) => ({ until: new Date(Date.now() + 60_000).toISOString(), lastAt: new Date().toISOString(), strikes });
    // The pre-fix implementation read settings OUTSIDE the transaction and
    // wrote the whole map back — one of these concurrent writers would vanish.
    await Promise.all([
      db.setChannelBlock("prov-a", mk(1)),
      db.setChannelBlock("prov-b", mk(2)),
      db.setChannelBlock("prov-c", mk(3)),
    ]);
    expect(await db.getChannelBlock("prov-a")).toMatchObject({ strikes: 1 });
    expect(await db.getChannelBlock("prov-b")).toMatchObject({ strikes: 2 });
    expect(await db.getChannelBlock("prov-c")).toMatchObject({ strikes: 3 });
    await Promise.all([db.clearChannelBlock("prov-a"), db.clearChannelBlock("prov-b"), db.clearChannelBlock("prov-c")]);
  });

  it("concurrent set + clear on the same provider ends in a consistent state", async () => {
    const mk = (strikes) => ({ until: new Date(Date.now() + 60_000).toISOString(), lastAt: new Date().toISOString(), strikes });
    await db.setChannelBlock("prov-race", mk(1));
    await Promise.all([
      db.setChannelBlock("prov-race", mk(2)),
      db.clearChannelBlock("prov-race"),
    ]);
    // Whatever the interleaving, a subsequent write must not be lost and the
    // map must stay parseable:
    await db.setChannelBlock("prov-race", mk(3));
    expect(await db.getChannelBlock("prov-race")).toMatchObject({ strikes: 3 });
    await db.clearChannelBlock("prov-race");
    expect(await db.getChannelBlock("prov-race")).toBeNull();
  });
});
