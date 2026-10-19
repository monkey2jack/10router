// Issue #33 — "set the password empty, confirm, and from then on every password is 401".
//
// No empty hash was ever stored. What locked the reporter (fnOS, v1.2.0) out: the
// fpk generates a random INITIAL_PASSWORD at install time into a file the user
// never sees; with login off they switched "Require login" on (the password form
// only appears once it is on) — and from then on the only accepted password was
// that hidden one. Nothing let them back in short of reinstalling.
//
// Prevention: the settings PATCH rejects an empty password and refuses to turn the
// log-in check on without a credential of the operator's own (password or SSO —
// the bootstrap password does not count). Recovery: a `reset-password` file in the
// data dir (fnOS writes it from App Center → 应用设置) sets / clears the password on
// the next log-in attempt or start, then is deleted.
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import bcrypt from "bcryptjs";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "10router-issue33-"));
const saved = { DATA_DIR: process.env.DATA_DIR, INITIAL_PASSWORD: process.env.INITIAL_PASSWORD, JWT_SECRET: process.env.JWT_SECRET };
process.env.DATA_DIR = tempDir;
process.env.JWT_SECRET = "test-secret-for-issue-33-lockout";

const db = vi.hoisted(() => ({ settings: {} }));
const cookieJar = vi.hoisted(() => ({ setCalls: [] }));
vi.mock("@/lib/localDb", () => ({
  getSettings: async () => ({ ...db.settings }),
  updateSettings: async (u) => { db.settings = { ...db.settings, ...u }; return { ...db.settings }; },
}));
vi.mock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: vi.fn() }));
vi.mock("open-sse/services/combo.js", () => ({ resetComboRotation: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: (...args) => cookieJar.setCalls.push(args), delete: () => {} }),
}));

const { PATCH } = await import("../../src/app/api/settings/route.js");
const { POST: login } = await import("../../src/app/api/auth/login/route.js");
const { applyPasswordResetFile, PASSWORD_RESET_FILE } = await import("../../src/lib/auth/passwordReset.js");
const { hasOwnDashboardCredential, isDashboardAuthConfigured } = await import("../../src/lib/auth/dashboardSession.js");

const RESET = path.join(tempDir, PASSWORD_RESET_FILE);
const readSource = (rel) => fs.readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");
const json = (url, method, body, ip) => new Request(url, {
  method, headers: { "content-type": "application/json", ...(ip ? { "x-forwarded-for": ip } : {}) }, body: JSON.stringify(body),
});
const patch = (body) => PATCH(json("http://localhost/api/settings", "PATCH", body));
let ipCounter = 0;
const tryLogin = (password) => login(json("http://localhost/api/auth/login", "POST", { password }, `10.33.0.${++ipCounter}`));

beforeEach(() => {
  db.settings = {};
  cookieJar.setCalls.length = 0;
  process.env.INITIAL_PASSWORD = "Hidden-fpk-Generated-9x"; // the fnOS bootstrap nobody saw
  for (const f of fs.readdirSync(tempDir).filter((n) => n.startsWith("reset-password"))) {
    fs.rmSync(path.join(tempDir, f), { force: true });
  }
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("prevention: settings PATCH", () => {
  it("rejects an empty or whitespace-only new password", async () => {
    for (const newPassword of ["", "   ", "\t\n"]) {
      const res = await patch({ newPassword });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("PASSWORD_EMPTY");
    }
    expect(db.settings.password).toBeUndefined();
  });

  it("refuses to turn the log-in check on with only the hidden bootstrap password (the reported lockout)", async () => {
    db.settings = { requireLogin: false };
    const res = await patch({ requireLogin: true });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("PASSWORD_REQUIRED");
    expect(db.settings.requireLogin).toBe(false);
  });

  it("turns it on together with a password set in the same request", async () => {
    db.settings = { requireLogin: false };
    const res = await patch({ requireLogin: true, newPassword: "my-own-pass" });
    expect(res.status).toBe(200);
    expect(db.settings.requireLogin).toBe(true);
    expect(await bcrypt.compare("my-own-pass", db.settings.password)).toBe(true);
    expect((await tryLogin("my-own-pass")).status).toBe(200);
  });

  it("turns it on when a stored password or a complete SSO setup already exists", async () => {
    db.settings = { requireLogin: false, password: await bcrypt.hash("x", 4) };
    expect((await patch({ requireLogin: true })).status).toBe(200);
    db.settings = { requireLogin: false, oidcIssuerUrl: "https://idp", oidcClientId: "id", oidcClientSecret: "s" };
    expect((await patch({ requireLogin: true })).status).toBe(200);
  });

  it("turning the check off never needs a password", async () => {
    db.settings = { requireLogin: true };
    expect((await patch({ requireLogin: false })).status).toBe(200);
  });

  // 设置→安全 reported defect: establishing protection kicked the operator to
  // the login page — they were admitted by loopback trust / open access and
  // held no auth cookie the moment the guard started demanding one.
  it("hands the operator a session cookie when protection is established (no kick-out)", async () => {
    db.settings = { requireLogin: false };
    expect((await patch({ requireLogin: true, newPassword: "my-own-pass" })).status).toBe(200);
    expect(cookieJar.setCalls.some(([name]) => name === "auth_token")).toBe(true);

    cookieJar.setCalls.length = 0;
    db.settings = { requireLogin: false, password: await bcrypt.hash("x", 4) };
    expect((await patch({ requireLogin: true })).status).toBe(200);
    expect(cookieJar.setCalls.some(([name]) => name === "auth_token")).toBe(true);
  });

  it("mints no session for unrelated settings changes or refused requests", async () => {
    db.settings = { requireLogin: true, password: await bcrypt.hash("x", 4) };
    expect((await patch({ theme: "dark" })).status).toBe(200);
    expect(cookieJar.setCalls.length).toBe(0);

    db.settings = { requireLogin: false };
    expect((await patch({ requireLogin: true })).status).toBe(400); // PASSWORD_REQUIRED
    expect(cookieJar.setCalls.length).toBe(0);
  });

  it("the bootstrap password still opens the dashboard, it just is not the operator's own credential", () => {
    expect(isDashboardAuthConfigured({})).toBe(true);
    expect(hasOwnDashboardCredential({})).toBe(false);
  });
});

describe("recovery: the reset-password file", () => {
  it("locked out as reported, a reset file lets the operator straight back in — no restart", async () => {
    db.settings = { requireLogin: true };                     // on, nothing of their own
    expect((await tryLogin("123456")).status).toBe(401);       // the old default is gone
    expect((await tryLogin("anything")).status).toBe(401);

    fs.writeFileSync(RESET, "Recovered-Pass-1\n");
    expect((await tryLogin("Recovered-Pass-1")).status).toBe(200);
    expect(fs.existsSync(RESET)).toBe(false);                  // plaintext consumed
    expect((await tryLogin("Recovered-Pass-1")).status).toBe(200); // and it sticks
  });

  it("an empty file removes a forgotten password and the first-login password applies again", async () => {
    db.settings = { requireLogin: true, password: await bcrypt.hash("forgotten", 4) };
    fs.writeFileSync(RESET, "");
    expect(await applyPasswordResetFile()).toBe("cleared");
    expect(db.settings.password).toBeNull();
    expect((await tryLogin("Hidden-fpk-Generated-9x")).status).toBe(200);
  });

  it("does nothing without a file", async () => {
    expect(await applyPasswordResetFile()).toBeNull();
  });

  it("accepts reset-password.txt too (extensionless files are awkward on Windows)", async () => {
    db.settings = { requireLogin: true };
    const txt = path.join(tempDir, "reset-password.txt");
    fs.writeFileSync(txt, "Recovered-Txt-1\n");
    expect((await tryLogin("Recovered-Txt-1")).status).toBe(200);
    expect(fs.existsSync(txt)).toBe(false);
  });

  it("the extensionless name wins when both exist", async () => {
    db.settings = { requireLogin: true };
    const txt = path.join(tempDir, "reset-password.txt");
    fs.writeFileSync(RESET, "Plain-Wins-1\n");
    fs.writeFileSync(txt, "Txt-Loses-1\n");
    expect((await tryLogin("Plain-Wins-1")).status).toBe(200);
    expect(fs.existsSync(RESET)).toBe(false); // winner consumed first…
    expect(fs.existsSync(txt)).toBe(true);    // …runner-up untouched until next login
    expect((await tryLogin("Txt-Loses-1")).status).toBe(200);
    expect(fs.existsSync(txt)).toBe(false);
  });

  it("any trailing extension works (.md too), but reset-password-old is NOT a reset file", async () => {
    db.settings = { requireLogin: true };
    const md = path.join(tempDir, "reset-password.md");
    const lookalike = path.join(tempDir, "reset-password-old");
    fs.writeFileSync(md, "Md-Pass-1\n");
    fs.writeFileSync(lookalike, "Not-A-Reset-1\n");
    expect((await tryLogin("Md-Pass-1")).status).toBe(200);
    expect(fs.existsSync(md)).toBe(false);
    expect(fs.existsSync(lookalike)).toBe(true);       // never matched, never consumed
    expect((await tryLogin("Not-A-Reset-1")).status).toBe(401);
  });

  it("is applied at start, on log-in, and before the login page reads its status", () => {
    expect(readSource("src/shared/services/initializeApp.js")).toContain("await applyPasswordResetFile()");
    expect(readSource("src/app/api/auth/login/route.js")).toContain("await applyPasswordResetFile()");
    expect(readSource("src/app/api/auth/status/route.js")).toContain("await applyPasswordResetFile()");
  });
});

describe("the entries users actually reach", () => {
  it("settings: switching the check on asks for a password when the server says one is needed", () => {
    const profile = readSource("src/app/(dashboard)/dashboard/profile/page.js");
    expect(profile).toContain('if (data?.code === "PASSWORD_REQUIRED") setLoginOnPassword(');
    expect(profile).toContain("JSON.stringify({ newPassword: value, requireLogin: true })");
  });

  it("login page: a 'Forgot your password?' entry with the recovery steps incl. the file format", () => {
    const page = readSource("src/app/login/page.js");
    expect(page).toContain("Forgot your password?");
    expect(page).toContain("reset-password — any extension works too");
    expect(page).toContain("empty file removes the stored password");
    expect(page).toContain('status?.installChannel === "fpk"');
  });

  it("fnOS: App Center settings page has the reset field", () => {
    const wizard = JSON.parse(readSource("fnos-packaging/wizard/config"));
    const fields = wizard.flatMap((step) => step.items).map((i) => i.field).filter(Boolean);
    expect(fields).toContain("reset_dashboard_password");
  });

  it.skipIf(process.platform === "win32" && !fs.existsSync("C:/Program Files/Git/bin/bash.exe"))(
    "fnOS: config_callback writes the typed password into reset-password (and nothing when left empty)", () => {
      const cb = fileURLToPathSafe("../../fnos-packaging/cmd/config_callback");
      const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "10router-fpk-cfg-"));
      const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
      execFileSync(bash, [cb], { env: { ...process.env, TRIM_PKGVAR: dataDir, reset_dashboard_password: "" } });
      expect(fs.existsSync(path.join(dataDir, "reset-password"))).toBe(false);
      execFileSync(bash, [cb], { env: { ...process.env, TRIM_PKGVAR: dataDir, reset_dashboard_password: "From-AppCenter-7" } });
      expect(fs.readFileSync(path.join(dataDir, "reset-password"), "utf8").trim()).toBe("From-AppCenter-7");
      expect(fs.readFileSync(path.join(dataDir, "install.log"), "utf8")).not.toContain("From-AppCenter-7");
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  );

  it("every new string has zh-CN and zh-TW text", () => {
    const literals = [
      "Forgot your password?",
      "Any install: create a file named reset-password in the 10Router data folder with the new password inside, then sign in with it. The file is read once and deleted.",
      "Leave that file empty to remove the password and go back to the first-login password.",
      "Data folder — Windows: %APPDATA%\\10router · macOS / Linux: ~/.10router · Docker: the mounted DATA_DIR · fnOS: @appdata/10router on the app's volume.",
      "fnOS: open App Center → 10Router → Settings, enter a new dashboard password and save. Sign in with it right away.",
      "First sign-in on fnOS: the generated password is in the initial-password file in that folder.",
      "Set a password to turn on the log-in check",
      "Set password and turn on",
      "You have not set a dashboard password of your own yet. Choose one now — you will need it to sign in from then on.",
      "Password cannot be empty",
    ];
    for (const locale of ["zh-CN", "zh-TW"]) {
      const table = JSON.parse(readSource(`public/i18n/literals/${locale}.json`));
      expect(literals.filter((k) => !table[k]), locale).toEqual([]);
    }
  });
});

function fileURLToPathSafe(rel) {
  return decodeURIComponent(new URL(rel, import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1");
}
