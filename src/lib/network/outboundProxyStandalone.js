// Standalone-safe outbound proxy initializer for custom-server.js.
//
// `src/app/layout.js` normally imports `@/lib/network/initOutboundProxy`, which
// calls applyOutboundProxyEnv() at boot so the runtime process.env.HTTP(S)_PROXY
// reflects the DB settings. But Next.js tree-shakes that side-effect import out
// of the standalone build, so the proxy never gets restored on restart — it only
// comes back after the user saves the proxy settings once in the UI.
//
// This module is the Node-side equivalent: it reads the settings table directly
// from the SQLite DB (resolved via DATA_DIR, same as the app) and applies the
// proxy env at startup. It intentionally uses NO `@/` aliases and NO app-module
// imports so it stays importable from custom-server.js in the standalone build.
//
// It is idempotent (guarded by a module-level flag), matching initOutboundProxy.

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const ALLOWED_PROXY_SCHEMES = ["http:", "https:", "socks5:", "socks4:", "socks5h:", "socks4a:"];

function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function validateProxyUrl(url) {
  if (!url) return null;
  if (/[\n\r`$]/.test(url)) return null;
  try {
    const parsed = new URL(url);
    if (!ALLOWED_PROXY_SCHEMES.includes(parsed.protocol)) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function applyProxyEnv(settings) {
  if (typeof process === "undefined" || !process.env) return;
  const enabled = Boolean(settings?.outboundProxyEnabled);
  const proxyUrl = normalizeString(settings?.outboundProxyUrl);
  const noProxy = normalizeString(settings?.outboundNoProxy);

  if (!enabled) {
    if (process.env.NINE_ROUTER_PROXY_MANAGED === "1") {
      delete process.env.HTTP_PROXY;
      delete process.env.HTTPS_PROXY;
      delete process.env.ALL_PROXY;
      delete process.env.NO_PROXY;
      delete process.env.NINE_ROUTER_PROXY_MANAGED;
      delete process.env.NINE_ROUTER_PROXY_URL;
      delete process.env.NINE_ROUTER_NO_PROXY;
    }
    return;
  }

  const wasManaged = process.env.NINE_ROUTER_PROXY_MANAGED === "1";
  let managed = false;

  if (wasManaged) {
    if (!proxyUrl) {
      delete process.env.HTTP_PROXY;
      delete process.env.HTTPS_PROXY;
      delete process.env.ALL_PROXY;
      delete process.env.NINE_ROUTER_PROXY_URL;
    }
    if (!noProxy) {
      delete process.env.NO_PROXY;
      delete process.env.NINE_ROUTER_NO_PROXY;
    }
  }

  if (proxyUrl) {
    const validated = validateProxyUrl(proxyUrl);
    if (validated) {
      process.env.HTTP_PROXY = validated;
      process.env.HTTPS_PROXY = validated;
      process.env.ALL_PROXY = validated;
      process.env.NINE_ROUTER_PROXY_URL = validated;
      managed = true;
      // Loopback must NEVER ride the outbound proxy — the proxy resolves
      // 127.0.0.1 on ITS OWN host, so server-internal self-calls (the model-
      // test ping) would hit whatever listens on the proxy machine and come
      // back as a foreign instance's "401 Invalid API key". Always merge
      // loopback into NO_PROXY; the user's entries ride along additively.
      // Mirror of src/lib/network/outboundProxy.js — keep both in sync.
      const merged = [
        ...new Set([
          ...noProxy.split(",").map((s) => s.trim()).filter(Boolean),
          "127.0.0.1", "localhost", "::1",
        ]),
      ].join(",");
      process.env.NO_PROXY = merged;
      process.env.NINE_ROUTER_NO_PROXY = merged;
    }
  }

  if (noProxy && !process.env.NO_PROXY) {
    process.env.NO_PROXY = noProxy;
    process.env.NINE_ROUTER_NO_PROXY = noProxy;
    managed = true;
  }

  if (managed) {
    process.env.NINE_ROUTER_PROXY_MANAGED = "1";
  } else if (wasManaged) {
    delete process.env.NINE_ROUTER_PROXY_MANAGED;
  }
}

function resolveDbPath() {
  // Same resolution as src/lib/dataDir.js: DATA_DIR first, then ~/.10router.
  let dir = process.env.DATA_DIR;
  if (dir) {
    if (process.platform === "win32" && /^\//.test(dir)) dir = "";
    else dir = normalizeString(dir);
  }
  if (!dir) dir = path.join(os.homedir(), ".10router");
  const dbPath = path.join(dir, "db", "data.sqlite");
  return fs.existsSync(dbPath) ? dbPath : null;
}

function readOutboundProxySettings() {
  const dbPath = resolveDbPath();
  if (!dbPath) return null;

  // Prefer node:sqlite (Node 22+) or better-sqlite3; fall back to sql.js.
  try {
    const sqlite = require("node:sqlite");
    const db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
    try {
      const row = db.prepare("SELECT data FROM settings WHERE id = 1").get();
      if (!row?.data) return null;
      const parsed = JSON.parse(row.data);
      return {
        outboundProxyEnabled: parsed.outboundProxyEnabled === true,
        outboundProxyUrl: parsed.outboundProxyUrl || "",
        outboundNoProxy: parsed.outboundNoProxy || "",
      };
    } finally {
      db.close();
    }
  } catch (e) {
    try {
      const Database = require("better-sqlite3");
      const db = new Database(dbPath, { readonly: true });
      try {
        const row = db.prepare("SELECT data FROM settings WHERE id = 1").get();
        if (!row?.data) return null;
        const parsed = JSON.parse(row.data);
        return {
          outboundProxyEnabled: parsed.outboundProxyEnabled === true,
          outboundProxyUrl: parsed.outboundProxyUrl || "",
          outboundNoProxy: parsed.outboundNoProxy || "",
        };
      } finally {
        db.close();
      }
    } catch (e2) {
      console.error("[OutboundProxyInit] failed to read settings:", e2?.message || e2);
      return null;
    }
  }
}

let initialized = false;

function ensureOutboundProxyInitialized() {
  if (initialized) return true;
  try {
    const settings = readOutboundProxySettings();
    if (settings) {
      applyProxyEnv(settings);
      initialized = true;
      console.log(`[OutboundProxyInit] applied: enabled=${settings.outboundProxyEnabled} url=${settings.outboundProxyUrl || "(none)"}`);
    }
  } catch (e) {
    console.error("[OutboundProxyInit] init failed:", e?.message || e);
  }
  return initialized;
}

module.exports = { ensureOutboundProxyInitialized };
