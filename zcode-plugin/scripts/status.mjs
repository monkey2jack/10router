#!/usr/bin/env node
/**
 * 10Router status — read-only monitor for the 10Router instance the user watches.
 *
 * Reports:
 *   1. Channel breakers   (settings.channelBlocks — provider-wide cooldowns)
 *   2. Account health     (/api/providers — active/locked accounts per provider)
 *   3. Usage              (/api/usage/dashboard — today + lifetime totals)
 *
 * AUTH — the dashboard endpoints (/api/settings, /api/providers,
 * /api/usage/dashboard) sit behind dashboardGuard, which accepts ONLY a JWT
 * cookie or the local CLI token. A virtual sk- key does NOT work here (it only
 * opens the LLM API and the import-usage route), so this script resolves
 * credentials differently from export-usage.mjs:
 *
 *   1. --cli-token <t>   explicit CLI token
 *   2. --password <p>    dashboard password → exchanged for a JWT cookie via
 *                        POST /api/auth/login (same password the dashboard uses)
 *   3. auto              when --endpoint is loopback, derive the CLI token from
 *                        the local data dir (machine-id + auth/cli-secret) —
 *                        zero configuration on the machine running 10Router
 *
 * Config: --endpoint http://host:port (default http://127.0.0.1:20127)
 *
 * Usage:
 *   node status.mjs                                   # local, zero config
 *   node status.mjs --endpoint http://nas:20127 --password ******
 *   node status.mjs --json                            # machine-readable
 *
 * Exit codes: 0 = ok, 1 = unreachable/auth failed, 2 = bad arguments.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const DEFAULTS = { endpoint: "http://127.0.0.1:20127" };
const CLI_TOKEN_SALT = "9r-cli-auth";

function parseArgs(argv) {
  const args = { endpoint: DEFAULTS.endpoint, cliToken: null, password: null, json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--endpoint") args.endpoint = argv[++i];
    else if (a === "--cli-token") args.cliToken = argv[++i];
    else if (a === "--password") args.password = argv[++i];
    else if (a === "--json") args.json = true;
    else if (a === "--help" || a === "-h") {
      console.log(`Usage: node status.mjs [options]

Read-only status monitor for a 10Router instance.

Options:
  --endpoint URL       10Router base URL (default ${DEFAULTS.endpoint})
  --password PASS      dashboard password (exchanged for a session cookie)
  --cli-token TOKEN    local CLI token (auto-derived when --endpoint is loopback)
  --json               emit machine-readable JSON instead of a report

Auth: dashboard endpoints accept only a JWT cookie or the local CLI token.
A virtual sk- key does NOT work here.

Exit codes: 0 ok · 1 unreachable or auth failed · 2 bad arguments`);
      process.exit(0);
    } else {
      console.error(`error: unknown option "${a}" (try --help)`);
      process.exit(2);
    }
  }
  return args;
}

function isLoopbackEndpoint(endpoint) {
  try {
    const h = new URL(endpoint).hostname.toLowerCase();
    return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]";
  } catch {
    return false;
  }
}

// Candidate 10Router/9Router data dirs for this machine.
function dataDirCandidates() {
  const list = [];
  const appData = process.env.APPDATA;
  const home = os.homedir();
  if (appData) {
    list.push(path.join(appData, "10router"), path.join(appData, "9router"));
  }
  list.push(path.join(home, ".10router"), path.join(home, ".9router"));
  return list;
}

/**
 * Derive the local CLI token — mirrors getConsistentMachineId('9r-cli-auth'):
 *   sha256(machineId + "9r-cli-auth" + cliSecret).slice(0, 16)
 * Returns null when the files are missing (instance not on this machine).
 */
function deriveLocalCliToken() {
  for (const dir of dataDirCandidates()) {
    try {
      const raw = fs.readFileSync(path.join(dir, "machine-id"), "utf8").trim();
      const secret = fs.readFileSync(path.join(dir, "auth", "cli-secret"), "utf8").trim();
      if (!raw || !secret) continue;
      return crypto.createHash("sha256").update(raw + CLI_TOKEN_SALT + secret).digest("hex").substring(0, 16);
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

/**
 * Exchange the dashboard password for a session cookie.
 * Returns the Cookie header value, or null when the password is rejected.
 */
async function loginForCookie(endpoint, password) {
  const res = await fetch(`${endpoint.replace(/\/$/, "")}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) return null;
  const setCookie = res.headers.getSetCookie?.() || [];
  const pair = setCookie.map((c) => c.split(";")[0]).find((c) => c.startsWith("auth_token="));
  return pair || null;
}

// Server renamed x-9r-cli-token → x-10r-cli-token and accepts both; send both so
// the command also works against an instance older than the rename.
const cliTokenHeaders = (token) => ({ "x-10r-cli-token": token, "x-9r-cli-token": token });

async function resolveAuth(args) {
  // 1. Explicit CLI token wins.
  if (args.cliToken) return { headers: cliTokenHeaders(args.cliToken), mode: "cli-token" };

  // 2. Password → JWT cookie.
  if (args.password) {
    const cookie = await loginForCookie(args.endpoint, args.password);
    if (!cookie) throw new Error("dashboard 密码校验失败（--password）");
    return { headers: { Cookie: cookie }, mode: "password" };
  }

  // 3. Loopback endpoint: derive the local CLI token, zero config.
  if (isLoopbackEndpoint(args.endpoint)) {
    const token = deriveLocalCliToken();
    if (token) return { headers: cliTokenHeaders(token), mode: "cli-token (auto)" };
    throw new Error("未能自动推导本地 CLI token（找不到 machine-id / auth/cli-secret）——请用 --password 或 --cli-token 指定");
  }

  throw new Error("远程实例需要鉴权：请提供 --password <面板密码> 或 --cli-token <token>");
}

async function getJson(endpoint, pathname, headers) {
  const res = await fetch(`${endpoint.replace(/\/$/, "")}${pathname}`, { headers });
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch { /* non-JSON (HTML error page / proxy) */ }
  if (!res.ok) {
    const detail = data.error || text.slice(0, 160) || res.statusText;
    throw new Error(`HTTP ${res.status} on ${pathname}: ${detail}`);
  }
  return data;
}

// ── formatting helpers ────────────────────────────────────────────────────

function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem ? `${m}m${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
}

function fmtTokens(n) {
  if (!Number.isFinite(n)) return "0";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

// A connection is "locked" when any per-model lock is still in the future.
// Model locks are stored as modelLock_<model> = ISO timestamp on the row.
function lockedModels(conn, now) {
  const locked = [];
  for (const [k, v] of Object.entries(conn || {})) {
    if (!k.startsWith("modelLock_")) continue;
    const until = new Date(v).getTime();
    if (Number.isFinite(until) && until > now) {
      locked.push({ model: k.slice("modelLock_".length), untilMs: until - now });
    }
  }
  return locked;
}

function fmtCost(cost) {
  if (!Number.isFinite(cost) || cost <= 0) return null;
  return `$${cost.toFixed(4)}`;
}

// ── report assembly ───────────────────────────────────────────────────────

async function collect(args, auth) {
  const headers = auth.headers;
  const endpoint = args.endpoint.replace(/\/$/, "");

  // Health first: gives a crisp error when the instance is down, before the
  // authenticated calls produce a confusing 401.
  let health = null;
  try {
    health = await getJson(endpoint, "/api/health", {});
  } catch (e) {
    throw new Error(`10Router 无法访问 ${endpoint} — ${e.message}`);
  }

  const [settings, providers, usage] = await Promise.all([
    getJson(endpoint, "/api/settings", headers).catch((e) => ({ __error: e.message })),
    getJson(endpoint, "/api/providers", headers).catch((e) => ({ __error: e.message })),
    getJson(endpoint, "/api/usage/dashboard", headers).catch((e) => ({ __error: e.message })),
  ]);

  const now = Date.now();

  // Channel breakers (only those still active).
  const breakers = [];
  for (const [provider, block] of Object.entries(settings.channelBlocks || {})) {
    if (!block?.until) continue;
    const left = new Date(block.until).getTime() - now;
    if (left > 0) {
      breakers.push({ provider, remainingMs: left, strikes: block.strikes || 0, escalated: !!block.escalated });
    }
  }

  // Account health grouped by provider.
  const byProvider = new Map();
  for (const conn of providers.connections || []) {
    const p = conn.provider || "unknown";
    if (!byProvider.has(p)) byProvider.set(p, []);
    const locked = lockedModels(conn, now);
    byProvider.get(p).push({
      name: conn.name || conn.id?.slice(0, 8) || "?",
      active: conn.isActive !== false,
      testStatus: conn.testStatus || null,
      locked,
      lastError: conn.lastError ? String(conn.lastError).slice(0, 100) : null,
    });
  }

  return { endpoint, health, breakers, providers: byProvider, usage, errors: {
    settings: settings.__error || null,
    providers: providers.__error || null,
    usage: usage.__error || null,
  } };
}

function render(data, authMode) {
  const out = [];
  const now = new Date();

  out.push(`10Router 状态 · ${data.endpoint}`);
  out.push(`查询时间 ${now.toLocaleString("zh-CN", { hour12: false })}`);
  out.push("");

  // ── 渠道熔断 ──
  out.push("【渠道熔断】");
  if (data.errors.settings) {
    out.push(`  ⚠️ 无法读取（${data.errors.settings}）`);
  } else if (data.breakers.length === 0) {
    out.push("  ✅ 无熔断，所有渠道正常");
  } else {
    for (const b of data.breakers) {
      const flag = b.escalated ? "（已升级）" : "";
      out.push(`  🔴 ${b.provider} — 冷却中，剩余 ${fmtDuration(b.remainingMs)}${flag} strike=${b.strikes}`);
    }
  }
  out.push("");

  // ── 账号健康 ──
  out.push("【账号健康】");
  if (data.errors.providers) {
    out.push(`  ⚠️ 无法读取（${data.errors.providers}）`);
  } else if (data.providers.size === 0) {
    out.push("  （无已配置连接）");
  } else {
    const entries = [...data.providers.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [provider, conns] of entries) {
      const active = conns.filter((c) => c.active).length;
      const lockedCount = conns.filter((c) => c.locked.length > 0).length;
      const head = lockedCount > 0
        ? `  ⚠️ ${provider} — ${active}/${conns.length} 启用，${lockedCount} 个有模型锁`
        : `  ✅ ${provider} — ${active}/${conns.length} 启用`;
      out.push(head);
      for (const c of conns) {
        if (!c.active) {
          out.push(`       · ${c.name}（已停用）`);
          continue;
        }
        if (c.locked.length > 0) {
          const locks = c.locked.map((l) => `${l.model} ${fmtDuration(l.untilMs)}`).join(", ");
          out.push(`       · ${c.name} — 锁定: ${locks}`);
        }
      }
    }
  }
  out.push("");

  // ── 今日用量 ──
  out.push("【用量】");
  if (data.errors.usage) {
    out.push(`  ⚠️ 无法读取（${data.errors.usage}）`);
  } else {
    const u = data.usage;
    const lifetime = u.lifetime || {};
    // Today comes from the daily series (last bucket = today).
    const daily = Array.isArray(u.daily) ? u.daily : [];
    const today = daily.length > 0 ? daily[daily.length - 1] : null;

    if (today) {
      const cost = fmtCost(today.cost);
      out.push(`  今日 ${today.date || ""} — ${today.requests ?? 0} 次请求 · ${fmtTokens(today.tokens ?? 0)} tokens${cost ? ` · ${cost}` : ""}`);
    } else {
      out.push("  今日 — 无数据");
    }
    out.push(`  累计 ${lifetime.totalRequests ?? 0} 次请求 · ${fmtTokens(lifetime.totalTokens ?? 0)} tokens`);
    if (lifetime.topModel?.model) {
      out.push(`  最常用模型 ${lifetime.topModel.model}（${lifetime.topModel.provider || "-"}）· ${fmtTokens(lifetime.topModel.tokens ?? 0)} tokens`);
    }
    if (Number.isFinite(lifetime.cacheHitRate)) {
      out.push(`  缓存命中率 ${lifetime.cacheHitRate}%`);
    }
    if (Number.isFinite(lifetime.currentStreak)) {
      out.push(`  连续活跃 ${lifetime.currentStreak} 天`);
    }
  }

  return out.join("\n");
}

// ── main ──────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);

  let auth;
  try {
    auth = await resolveAuth(args);
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(2);
  }

  let data;
  try {
    data = await collect(args, auth);
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }

  if (args.json) {
    console.log(JSON.stringify({
      endpoint: data.endpoint,
      authMode: auth.mode,
      health: data.health,
      breakers: data.breakers,
      providers: Object.fromEntries(data.providers),
      usage: data.usage,
      errors: data.errors,
    }, null, 2));
    return;
  }

  console.log(render(data, auth.mode));

  // Surface partial failures in the exit code so callers can detect them.
  if (data.errors.settings || data.errors.providers || data.errors.usage) process.exit(1);
}

main().catch((e) => {
  console.error(`error: ${e.message}`);
  process.exit(1);
});
