// POST /api/providers used to be O(pool) per insert. Inside one transaction it
// read the whole pool AND renumbered every row's priority, so a 5k-key import
// was O(n*m) — ~25M statements at a 5k pool — and every parallel writer
// serialized on the same transaction. On top of that, an apikey name collision
// silently overwrote the stored key with no 409.
//
// Each case runs against its own temp DATA_DIR (the DB adapter caches per
// module instance), so provider aliases can be reused across cases.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;

let cleanup;

beforeEach(async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "10router-priority-insert-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  cleanup = () => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    } catch { /* leave it to the OS temp reaper */ }
  };
});

afterEach(() => {
  cleanup?.();
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

async function importRepo() {
  return await import("@/lib/db/index.js");
}

async function seed(repo, provider, n) {
  for (let i = 0; i < n; i++) {
    await repo.createProviderConnection({
      provider,
      authType: "apikey",
      name: `seed-${i}`,
      apiKey: `k${i}`,
    });
  }
}

describe("provider insert is O(1) in pool size (#4311)", () => {
  it("assigns sequential priorities without a renumber pass", async () => {
    const repo = await importRepo();
    const P = `openai-compatible-seq-${Date.now()}`;
    await seed(repo, P, 3);
    const list = await repo.getProviderConnections({ provider: P });
    expect(list.map((c) => c.name)).toEqual(["seed-0", "seed-1", "seed-2"]);
    expect(list.map((c) => c.priority)).toEqual([1, 2, 3]);
  });

  it("keeps a large pool in insertion order", async () => {
    const repo = await importRepo();
    const P = `openai-compatible-ord-${Date.now()}`;
    await seed(repo, P, 60);
    const list = await repo.getProviderConnections({ provider: P });
    expect(list).toHaveLength(60);
    // The bug showed up as reordering once the pool grew past a few rows.
    expect(list[0].name).toBe("seed-0");
    expect(list[59].name).toBe("seed-59");
    for (let i = 1; i < list.length; i++) {
      expect(list[i].priority).toBeGreaterThan(list[i - 1].priority);
    }
  });

  it("still renumbers on delete, so gaps do not accumulate", async () => {
    const repo = await importRepo();
    const P = `openai-compatible-del-${Date.now()}`;
    await seed(repo, P, 4);
    const before = await repo.getProviderConnections({ provider: P });
    await repo.deleteProviderConnection(before[0].id);
    const after = await repo.getProviderConnections({ provider: P });
    expect(after.map((c) => c.priority)).toEqual([1, 2, 3]);
  });

  it("still renumbers on an explicit priority update", async () => {
    const repo = await importRepo();
    const P = `openai-compatible-upd-${Date.now()}`;
    await seed(repo, P, 4);
    await new Promise((r) => setTimeout(r, 10));
    const list = await repo.getProviderConnections({ provider: P });
    // Move the last one to the front.
    await repo.updateProviderConnection(list[3].id, { priority: 1 });
    const after = await repo.getProviderConnections({ provider: P });
    expect(after[0].name).toBe("seed-3");
  });
});

describe("name collision no longer destroys a key silently (#4311)", () => {
  it("refuses by default in one flow: typed conflict, opt-in overwrite, legacy default", async () => {
    const repo = await importRepo();
    const P = `openai-compatible-clash-${Date.now()}`;
    await seed(repo, P, 1);
    const orig = (await repo.getProviderConnections({ provider: P }))[0];

    // 1. allowOverwrite: false → typed conflict instead of overwriting.
    await expect(
      repo.createProviderConnection({
        provider: P,
        authType: "apikey",
        name: orig.name,
        apiKey: "REPLACEMENT-KEY",
        allowOverwrite: false,
      })
    ).rejects.toMatchObject({ code: "PROVIDER_NAME_CONFLICT", existingId: orig.id });
    // The stored key must be untouched.
    const afterRefusal = (await repo.getProviderConnections({ provider: P }))[0];
    expect(afterRefusal.apiKey).toBe(orig.apiKey);

    // 2. allowOverwrite: true → the caller opts in, same row is updated.
    const updated = await repo.createProviderConnection({
      provider: P,
      authType: "apikey",
      name: orig.name,
      apiKey: "REPLACEMENT-KEY",
      allowOverwrite: true,
    });
    expect(updated.id).toBe(orig.id);
    const afterOptIn = (await repo.getProviderConnections({ provider: P }))[0];
    expect(afterOptIn.apiKey).toBe("REPLACEMENT-KEY");

    // 3. Flag omitted → previous overwrite behaviour for existing callers
    // (oauth routes, bulk import all omit it).
    const legacy = await repo.createProviderConnection({
      provider: P,
      authType: "apikey",
      name: orig.name,
      apiKey: "LEGACY-PATH-KEY",
    });
    expect(legacy.id).toBe(orig.id);

    // 4. Same name on a different provider does not collide.
    const other = await repo.createProviderConnection({
      provider: `openai-compatible-other-${P}`,
      authType: "apikey",
      name: orig.name,
      apiKey: "other-key",
    });
    expect(other.id).not.toBe(orig.id);
  });
});
