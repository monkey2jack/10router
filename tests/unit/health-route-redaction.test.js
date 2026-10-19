/**
 * GET /api/health is public and CORS-* by design — it is the one endpoint an
 * outside monitor can poll — so it must not echo local paths back.
 *
 * The driver layer records the raw `Error.message` of a failed load, and for a
 * native module that is routinely a fully-qualified path ("Cannot find module
 * 'C:\\Users\\someone\\AppData\\...\\better-sqlite3'"). That leaked the local
 * username and directory layout to any caller. The field still has to work:
 * `10router doctor` classifies on whether it is set and on the driver name, so
 * the redaction must keep both while dropping the location.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GET } from "../../src/app/api/health/route.js";

const setAdapter = (state) => {
  global._dbAdapter = state;
};

describe("/api/health driver error redaction", () => {
  const original = global._dbAdapter;
  afterEach(() => {
    global._dbAdapter = original;
  });

  it("drops a Windows path but keeps the driver name and the reason", async () => {
    setAdapter({
      instance: { driver: "node:sqlite" },
      lastDriverError:
        "bun:sqlite: Cannot find module 'C:\\Users\\YangYu\\AppData\\Local\\npm\\node_modules\\better-sqlite3'",
    });
    const body = await (await GET()).json();
    expect(body.driver).toBe("node:sqlite");
    expect(body.lastDriverError).not.toMatch(/[A-Za-z]:\\/);
    expect(body.lastDriverError).not.toContain("YangYu");
    expect(body.lastDriverError).toContain("bun:sqlite:");
    expect(body.lastDriverError).toContain("Cannot find module");
  });

  it("drops a POSIX path", async () => {
    setAdapter({
      instance: { driver: "sql.js" },
      lastDriverError:
        "better-sqlite3: /home/yangyu/projects/10router/node_modules/better-sqlite3/x.node: invalid ELF header",
    });
    const body = await (await GET()).json();
    expect(body.lastDriverError).not.toMatch(/\/(?:home|Users|tmp|usr)\//);
    expect(body.lastDriverError).not.toContain("yangyu");
    expect(body.lastDriverError).toContain("invalid ELF header");
  });

  it("leaves a path-free message alone (doctor's fallback branch reads it)", async () => {
    const msg = "better-sqlite3: NODE_MODULE_VERSION 127 vs 131";
    setAdapter({ instance: { driver: "node:sqlite" }, lastDriverError: msg });
    const body = await (await GET()).json();
    expect(body.lastDriverError).toBe(msg);
  });

  it("stays null when there is no error, and reports a null driver before init", async () => {
    setAdapter({ instance: null, lastDriverError: null });
    const body = await (await GET()).json();
    expect(body.ok).toBe(true);
    expect(body.driver).toBeNull();
    expect(body.lastDriverError).toBeNull();
  });

  it("never initialises the DB and stays CORS-open for a monitor", async () => {
    // Read-only on purpose: a health probe that opens SQLite is its own outage.
    setAdapter({ instance: null, initPromise: null, lastDriverError: null });
    const res = await GET();
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(global._dbAdapter.initPromise).toBeNull();
  });
});
