/**
 * Regression: the MiMo Desktop card's "Test connection" button.
 *
 * The Desktop card (provider `mimo-desktop`) stores a session-only connection —
 * authType "api_key" with a `mimo-desktop-session-*` placeholder key and no sk-.
 * testUtils' provider switch only listed `xiaomi-mimo` / `xiaomi-tokenplan`, and
 * `isSessionConnection` was hardcoded to `xiaomi-mimo`, so a Desktop connection
 * fell through to the default arm and every test returned "Provider test not
 * supported" — the card's core button was dead.
 *
 * This exercises the real routing (mocking only the DB and forcing no local
 * desktop login) and asserts the Desktop connection reaches the session probe:
 * with no cookie available it must report "Desktop session unavailable", NOT
 * "Provider test not supported".
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";

// The Desktop session cookie lookup falls back to the desktop app's profile dir
// (APPDATA on Windows). Point it at an empty temp dir so a dev machine that is
// actually signed into MiMo Desktop can't turn this into a live-network test.
const savedAppData = process.env.APPDATA;
process.env.APPDATA = join(tmpdir(), `mimo-desktop-conntest-empty-${process.pid}`);
afterAll(() => {
  if (savedAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = savedAppData;
});

const connections = new Map();
vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: async (id) => connections.get(id) || null,
  updateProviderConnection: async () => {},
}));

const { testSingleConnection } = await import("../../src/app/api/providers/[id]/test/testUtils.js");

const desktopConnection = (over = {}) => ({
  id: "conn-desktop",
  provider: "mimo-desktop",
  authType: "api_key",
  apiKey: "mimo-desktop-session-abc123",
  providerSpecificData: { authMethod: "desktop-session" },
  ...over,
});

beforeEach(() => connections.clear());

describe("mimo-desktop connection test", () => {
  it("reaches the session probe, not the 'not supported' default arm", async () => {
    connections.set("conn-desktop", desktopConnection());
    const res = await testSingleConnection("conn-desktop");
    expect(res.valid).toBe(false);
    expect(res.error).not.toMatch(/not supported/i);
    // No cookie derivable (empty APPDATA, no live session) → the session branch's
    // own message, which is only reachable once the switch routes mimo-desktop in.
    expect(res.error).toMatch(/Desktop session unavailable/i);
  });

  it("still routes even when a transfer import left authType 'oauth'", async () => {
    connections.set("conn-desktop", desktopConnection({ authType: "oauth" }));
    const res = await testSingleConnection("conn-desktop");
    expect(res.valid).toBe(false);
    expect(res.error).not.toMatch(/not supported/i);
    expect(res.error).toMatch(/Desktop session unavailable/i);
  });

  it("source: the provider switch and dispatcher both list mimo-desktop", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../../src/app/api/providers/[id]/test/testUtils.js", import.meta.url)),
      "utf8",
    );
    expect(src).toMatch(/case "mimo-desktop":/);
    expect(src).toMatch(/provider === "xiaomi-mimo" \|\| connection\.provider === "mimo-desktop"/);
  });

  it("source: the selected model reaches the session probe", async () => {
    // The dashboard picker sends { model }; it must survive testSingleConnection
    // (the `options` argument used to be silently dropped at the dispatcher) and
    // name the probe request instead of the hardcoded flash default.
    const src = readFileSync(
      fileURLToPath(new URL("../../src/app/api/providers/[id]/test/testUtils.js", import.meta.url)),
      "utf8",
    );
    expect(src).toMatch(/export async function testSingleConnection\(id, options = \{\}\)/);
    expect(src).toMatch(/testApiKeyConnection\(connection, effectiveProxy, options\)/);
    expect(src).toMatch(/model: model \|\| "mimo-v2\.6-flash"/);
  });
});

describe("mimo-desktop test route", () => {
  const routeSrc = () => readFileSync(
    fileURLToPath(new URL("../../src/app/api/providers/[id]/test/route.js", import.meta.url)),
    "utf8",
  );

  it("accepts a bodyless POST", () => {
    // The one-by-one loop and the edit modal send no body. An unguarded
    // request.json() threw and turned every such test into a 500 "Test failed".
    expect(routeSrc()).toMatch(/request\.json\(\)\.catch\(\(\) => \(\{\}\)\)/);
  });

  it("forwards the optional model to testSingleConnection", () => {
    expect(routeSrc()).toMatch(/testSingleConnection\(id, \{ model: body\.model \|\| null \}\)/);
  });
});

describe("mimo-desktop card counts its own session rows", () => {
  const pageSrc = () => readFileSync(
    fileURLToPath(new URL("../../src/app/(dashboard)/dashboard/providers/page.js", import.meta.url)),
    "utf8",
  );

  it("dualAuthTypes special-cases mimo-desktop", () => {
    // The card's authModes is ["oauth"], yet its only connect path (the MiMo
    // modal → /api/oauth/xiaomi-mimo/api-key) writes authType "api_key". Without
    // this the grid card reads "No connections" over a live, tested connection.
    const src = pageSrc();
    expect(src).toMatch(/if \(key === "mimo-desktop"\) return \["oauth", "apikey", "api_key"\];/);
    // The storage side must stay "api_key" — the reader is what adapts, because
    // flipping the writer would strand every existing Desktop row.
    const route = readFileSync(
      fileURLToPath(new URL("../../src/app/api/oauth/xiaomi-mimo/api-key/route.js", import.meta.url)),
      "utf8",
    );
    expect(route).toMatch(/authType: "api_key",/);
  });
});
