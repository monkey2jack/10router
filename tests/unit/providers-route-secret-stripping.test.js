// GET /api/providers AND GET/PUT /api/providers/[id] strip credential VALUES
// from the payload but keep capability BOOLEANS so connection badges can
// reflect what a row holds.
// Regression guard: the Xiaomi desktop session cookie (mimoPassToken) lived
// inside providerSpecificData, which rode along wholesale — any dashboard
// consumer could read it in plaintext from the list response. The single-
// connection route had the same hole (fixed alongside this test). Edit safety
// is preserved because the PUT route ([id]/route.js) merges into existing
// providerSpecificData instead of replacing it, so a roundtrip that no
// longer carries the value cannot wipe the stored token.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let connectionsRepo;
let get;
let getById;
let putById;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "10router-providers-route-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  const db = await import("@/lib/db/index.js");
  await db.initDb();
  connectionsRepo = await import("@/lib/db/repos/connectionsRepo.js");
  ({ GET: get } = await import("@/app/api/providers/route.js"));
  ({ GET: getById, PUT: putById } = await import("@/app/api/providers/[id]/route.js"));
});

afterAll(() => {
  if (tempDir) { try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {} }
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

const PASS_TOKEN = "session-cookie-secret-abc123";
const REAL_KEY = "sk-real-key-xyz789";

async function listConnections() {
  const res = await get();
  expect(res.status).toBe(200);
  const body = await res.json();
  return body.connections;
}

describe("GET /api/providers credential stripping", () => {
  it("hides mimoPassToken value but exposes hasDesktopSession", async () => {
    await connectionsRepo.createProviderConnection({
      provider: "xiaomi-mimo",
      name: "MiMo session",
      accessToken: "mimo-desktop-session-123456",
      providerSpecificData: {
        authMethod: "desktop-session",
        mimoPassToken: PASS_TOKEN,
        mimoUserId: "123456",
      },
    });

    const conns = await listConnections();
    const conn = conns.find((c) => c.provider === "xiaomi-mimo");
    expect(conn).toBeTruthy();
    expect(conn.hasDesktopSession).toBe(true);
    expect(conn.hasAccessToken).toBe(false); // placeholder is not a key
    expect(conn.accessToken).toBeUndefined();
    // The secret itself must never travel in the response.
    expect(conn.providerSpecificData?.mimoPassToken).toBeUndefined();
    expect(JSON.stringify(conn)).not.toContain(PASS_TOKEN);
    // Non-sensitive specific data still reaches the UI.
    expect(conn.providerSpecificData?.mimoUserId).toBe("123456");
  });

  it("dual-credential row reports both booleans without leaking either secret", async () => {
    await connectionsRepo.createProviderConnection({
      provider: "xiaomi-mimo",
      name: "MiMo dual",
      accessToken: REAL_KEY,
      apiKey: "api-key-secret-000",
      providerSpecificData: {
        authMethod: "oauth",
        mimoPassToken: PASS_TOKEN,
      },
    });

    const conns = await listConnections();
    const conn = conns.find((c) => c.name === "MiMo dual");
    expect(conn.hasAccessToken).toBe(true);
    expect(conn.hasDesktopSession).toBe(true);
    expect(conn.providerSpecificData?.mimoPassToken).toBeUndefined();
    const dump = JSON.stringify(conn);
    expect(dump).not.toContain(REAL_KEY);
    expect(dump).not.toContain("api-key-secret-000");
    expect(dump).not.toContain(PASS_TOKEN);
  });
});

describe("GET/PUT /api/providers/[id] credential stripping", () => {
  const routeParams = (id) => ({ params: Promise.resolve({ id }) });

  async function idByName(name) {
    const rows = await connectionsRepo.getProviderConnections();
    const row = rows.find((c) => c.name === name);
    expect(row).toBeTruthy();
    return row.id;
  }

  it("single GET hides mimoPassToken but reports capability booleans", async () => {
    await connectionsRepo.createProviderConnection({
      provider: "xiaomi-mimo",
      name: "MiMo single-get",
      accessToken: "mimo-desktop-session-654321",
      providerSpecificData: {
        authMethod: "desktop-session",
        mimoPassToken: PASS_TOKEN,
        mimoUserId: "654321",
      },
    });
    const id = await idByName("MiMo single-get");

    const res = await getById(null, routeParams(id));
    expect(res.status).toBe(200);
    const { connection } = await res.json();
    expect(connection.hasDesktopSession).toBe(true);
    expect(connection.hasAccessToken).toBe(false); // placeholder is not a key
    expect(connection.providerSpecificData?.mimoPassToken).toBeUndefined();
    expect(JSON.stringify(connection)).not.toContain(PASS_TOKEN);
    // Non-sensitive specific data still reaches the UI.
    expect(connection.providerSpecificData?.mimoUserId).toBe("654321");
  });

  it("PUT response is redacted and a partial edit cannot wipe the stored token", async () => {
    await connectionsRepo.createProviderConnection({
      provider: "xiaomi-mimo",
      name: "MiMo single-put",
      accessToken: REAL_KEY,
      providerSpecificData: {
        authMethod: "oauth",
        mimoPassToken: PASS_TOKEN,
        mimoUserId: "111222",
      },
    });
    const id = await idByName("MiMo single-put");

    // Simulate the real edit roundtrip: the client only saw the redacted row,
    // so its PUT carries partial specific data WITHOUT the token key.
    const req = new Request("http://localhost/api/providers/x", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "MiMo single-put renamed",
        providerSpecificData: { mimoUserId: "333444" },
      }),
    });
    const res = await putById(req, routeParams(id));
    expect(res.status).toBe(200);
    const { connection } = await res.json();
    // Response carries no secret values.
    expect(connection.providerSpecificData?.mimoPassToken).toBeUndefined();
    expect(JSON.stringify(connection)).not.toContain(PASS_TOKEN);
    expect(JSON.stringify(connection)).not.toContain(REAL_KEY);
    expect(connection.hasDesktopSession).toBe(true);
    expect(connection.hasAccessToken).toBe(true);

    // Merge semantics: the stored session token must SURVIVE the partial edit.
    const stored = await connectionsRepo.getProviderConnectionById(id);
    expect(stored.providerSpecificData?.mimoPassToken).toBe(PASS_TOKEN);
    expect(stored.providerSpecificData?.mimoUserId).toBe("333444");
    expect(stored.name).toBe("MiMo single-put renamed");
  });

  it("PUT with no providerSpecificData at all leaves stored token intact", async () => {
    await connectionsRepo.createProviderConnection({
      provider: "xiaomi-mimo",
      name: "MiMo single-put-plain",
      accessToken: "mimo-desktop-session-999888",
      providerSpecificData: { authMethod: "desktop-session", mimoPassToken: PASS_TOKEN },
    });
    const id = await idByName("MiMo single-put-plain");

    const req = new Request("http://localhost/api/providers/x", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: false }),
    });
    const res = await putById(req, routeParams(id));
    expect(res.status).toBe(200);
    const { connection } = await res.json();
    expect(JSON.stringify(connection)).not.toContain(PASS_TOKEN);

    const stored = await connectionsRepo.getProviderConnectionById(id);
    expect(stored.providerSpecificData?.mimoPassToken).toBe(PASS_TOKEN);
    expect(stored.isActive).toBe(false);
  });
});
