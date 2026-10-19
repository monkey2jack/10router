// 桌面壳密码库 desktop/passwordStore.js 的单测(注入假 cipher,纯 Node 可跑)。
// 契约:只落密文、同 origin+username 幂等、origin 归一化去重、neverAsk 持久化、
// 坏文件自愈、cipher 不可用时拒绝写入。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

const require = createRequire(import.meta.url);
const { createPasswordStore, normalizeOrigin } = require("../../desktop/passwordStore.js");

// 假 cipher:base64 前缀标记,遇到非本格式 blob 直接抛(模拟 safeStorage 解密失败)
function fakeCipher({ available = true } = {}) {
  return {
    available: () => available,
    encrypt: (plain) => "x1:" + Buffer.from(plain, "utf8").toString("base64"),
    decrypt: (blob) => {
      const s = String(blob);
      if (!s.startsWith("x1:")) throw new Error("decrypt failed: bad blob");
      return Buffer.from(s.slice(3), "base64").toString("utf8");
    },
  };
}

let tempDir;
let file;
let tick;
const now = () => ++tick * 1000;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pwstore-"));
  file = path.join(tempDir, "passwords.json");
  tick = 0;
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("passwordStore: origin normalization", () => {
  it("defaults bare domains to https and collapses host case / default ports", () => {
    const store = createPasswordStore({ file, cipher: fakeCipher(), now });
    store.upsert({ origin: "Example.com", username: "u", password: "p1" });
    // 默认端口剥离后与上面同 origin:同用户名 → 走更新,不产生第二条
    store.upsert({ origin: "https://example.com:443", username: "u", password: "p2" });
    const list = store.list();
    expect(list).toHaveLength(1);
    expect(list[0].origin).toBe("https://example.com");
    expect(store.reveal(list[0].id)).toBe("p2");
  });

  it("keeps non-default ports, accepts bare LAN hostnames, rejects non-http(s) schemes", () => {
    expect(normalizeOrigin("http://x.com:8080")).toBe("http://x.com:8080");
    expect(normalizeOrigin("router.lan")).toBe("https://router.lan");
    expect(normalizeOrigin("ftp://x.com")).toBe(null);
    expect(normalizeOrigin("javascript:alert(1)")).toBe(null);
    expect(normalizeOrigin("file:///etc/passwd")).toBe(null);
    expect(normalizeOrigin("")).toBe(null);
    expect(normalizeOrigin("https://bad host")).toBe(null);
  });
});

describe("passwordStore: upsert semantics", () => {
  it("adds an entry and never exposes plaintext or ciphertext in list output", () => {
    const store = createPasswordStore({ file, cipher: fakeCipher(), now });
    const { entry, updated } = store.upsert({ origin: "https://example.com", username: "bob", password: "s3cret" });
    expect(updated).toBe(true);
    expect(entry.origin).toBe("https://example.com");
    expect(entry.username).toBe("bob");
    expect(entry).not.toHaveProperty("passwordEnc");
    expect(entry).not.toHaveProperty("password");
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(raw.entries[0].passwordEnc).toMatch(/^x1:/);
    expect(JSON.stringify(raw)).not.toContain("s3cret");
  });

  it("updates in place when the same origin+username saves a different password", () => {
    const store = createPasswordStore({ file, cipher: fakeCipher(), now });
    store.upsert({ origin: "https://example.com", username: "bob", password: "one" });
    const firstUpdatedAt = JSON.parse(fs.readFileSync(file, "utf8")).entries[0].updatedAt;
    const { updated } = store.upsert({ origin: "https://example.com", username: "bob", password: "two" });
    expect(updated).toBe(true);
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(raw.entries).toHaveLength(1);
    expect(raw.entries[0].updatedAt).not.toBe(firstUpdatedAt);
    expect(store.reveal(raw.entries[0].id)).toBe("two");
  });

  it("is a no-op when the identical password is saved again", () => {
    const store = createPasswordStore({ file, cipher: fakeCipher(), now });
    const first = store.upsert({ origin: "https://example.com", username: "bob", password: "one" });
    const again = store.upsert({ origin: "https://example.com", username: "bob", password: "one" });
    expect(again.updated).toBe(false);
    expect(again.entry.id).toBe(first.entry.id);
    expect(store.list()).toHaveLength(1);
  });

  it("keeps multiple usernames per origin and isolates origins (path ignored)", () => {
    const store = createPasswordStore({ file, cipher: fakeCipher(), now });
    store.upsert({ origin: "https://a.com", username: "u1", password: "p1" });
    store.upsert({ origin: "https://a.com", username: "u2", password: "p2" });
    store.upsert({ origin: "https://b.com", username: "u1", password: "p3" });
    expect(store.list()).toHaveLength(3);
    expect(store.listForOrigin("https://a.com/login")).toHaveLength(2);
    expect(store.listForOrigin("https://b.com")).toHaveLength(1);
    expect(store.listForOrigin("https://c.com")).toHaveLength(0);
  });

  it("rejects invalid origins and empty passwords without writing anything", () => {
    const store = createPasswordStore({ file, cipher: fakeCipher(), now });
    expect(() => store.upsert({ origin: "https://bad host", username: "u", password: "p" })).toThrow(/invalid origin/i);
    expect(() => store.upsert({ origin: "ftp://x.com", username: "u", password: "p" })).toThrow(/invalid origin/i);
    expect(() => store.upsert({ origin: "https://ok.com", username: "u", password: "" })).toThrow(/empty password/i);
    expect(store.list()).toHaveLength(0);
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe("passwordStore: manager operations", () => {
  it("updates username while keeping the stored password (empty password = keep)", () => {
    const store = createPasswordStore({ file, cipher: fakeCipher(), now });
    const { entry } = store.upsert({ origin: "https://example.com", username: "a", password: "keep" });
    store.update(entry.id, { username: "b", password: "" });
    const row = store.list()[0];
    expect(row.username).toBe("b");
    expect(store.reveal(row.id)).toBe("keep");
  });

  it("re-encrypts when a new password is supplied via update", () => {
    const store = createPasswordStore({ file, cipher: fakeCipher(), now });
    const { entry } = store.upsert({ origin: "https://example.com", username: "a", password: "old" });
    store.update(entry.id, { password: "new" });
    expect(store.reveal(entry.id)).toBe("new");
  });

  it("removes entries; removing twice reports false", () => {
    const store = createPasswordStore({ file, cipher: fakeCipher(), now });
    const { entry } = store.upsert({ origin: "https://example.com", username: "u", password: "p" });
    expect(store.remove(entry.id)).toBe(true);
    expect(store.list()).toHaveLength(0);
    expect(store.remove(entry.id)).toBe(false);
  });

  it("caps the vault at 200 entries", () => {
    const store = createPasswordStore({ file, cipher: fakeCipher(), now });
    for (let i = 0; i < 205; i++) {
      store.upsert({ origin: `https://h${i}.example`, username: "u", password: "p" });
    }
    expect(store.list()).toHaveLength(200);
  });
});

describe("passwordStore: durability", () => {
  it("persists entries across store instances (shell restart)", () => {
    const a = createPasswordStore({ file, cipher: fakeCipher(), now });
    a.upsert({ origin: "https://example.com", username: "bob", password: "pw" });
    const b = createPasswordStore({ file, cipher: fakeCipher(), now });
    const list = b.list();
    expect(list).toHaveLength(1);
    expect(b.reveal(list[0].id)).toBe("pw");
  });

  it("persists neverAsk origins and matches them case-insensitively", () => {
    const a = createPasswordStore({ file, cipher: fakeCipher(), now });
    a.setNeverAsk("https://Spam.example");
    const b = createPasswordStore({ file, cipher: fakeCipher(), now });
    expect(b.isNeverAsk("https://SPAM.example")).toBe(true);
    expect(b.isNeverAsk("https://other.example")).toBe(false);
  });

  it("starts fresh on a corrupt file and keeps working", () => {
    fs.writeFileSync(file, "{not json");
    const store = createPasswordStore({ file, cipher: fakeCipher(), now });
    expect(store.list()).toHaveLength(0);
    store.upsert({ origin: "https://example.com", username: "u", password: "p" });
    expect(store.list()).toHaveLength(1);
  });

  it("drops entries with invalid shapes when loading (self-heal), keeps valid ones", () => {
    fs.writeFileSync(file, JSON.stringify({
      version: 1,
      entries: [
        { id: "ok-1", origin: "https://good.example", username: "u", passwordEnc: "x1:cA==", createdAt: 1, updatedAt: 1 },
        { id: "bad-1", origin: "javascript:alert(1)", username: "u", passwordEnc: "x1:cA==" },
        { id: "bad-2", origin: "https://x.example", username: "u" }, // 缺 passwordEnc
        "garbage",
      ],
      neverAsk: ["https://quiet.example", 42],
    }));
    const store = createPasswordStore({ file, cipher: fakeCipher(), now });
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].id).toBe("ok-1");
    expect(store.isNeverAsk("https://quiet.example")).toBe(true);
  });

  it("fails closed when a stored blob cannot be decrypted (wrong key / tamper)", () => {
    const store = createPasswordStore({ file, cipher: fakeCipher(), now });
    store.upsert({ origin: "https://example.com", username: "u", password: "p" });
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    raw.entries[0].passwordEnc = "garbage";
    fs.writeFileSync(file, JSON.stringify(raw));
    const reopened = createPasswordStore({ file, cipher: fakeCipher(), now });
    expect(() => reopened.reveal(raw.entries[0].id)).toThrow(/bad blob/);
  });

  it("refuses to store anything when the cipher is unavailable — no plaintext ever hits disk", () => {
    const store = createPasswordStore({ file, cipher: fakeCipher({ available: false }), now });
    expect(store.isAvailable()).toBe(false);
    expect(() => store.upsert({ origin: "https://example.com", username: "u", password: "p" })).toThrow(/unavailable/i);
    expect(() => store.reveal("whatever")).toThrow(/unavailable/i);
    expect(fs.existsSync(file)).toBe(false);
  });
});
