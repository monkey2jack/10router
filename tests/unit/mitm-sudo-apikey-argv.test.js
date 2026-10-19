// #31: the MITM sudo spawn must never put ROUTER_API_KEY on a command line.
//
// `sudo -S -E sh -c <cmd>` exposes the whole inline command in
// /proc/<pid>/cmdline for the server's entire lifetime — readable by any local
// user, unlike an env var. The key now rides stdin (second line, after the
// sudo password) and is exported inside the shell before exec.
//
// Source-level guard, same pattern as outbound-proxy-loopback.test.js: the
// spawn is platform-conditional and needs a live sudo to exercise, so the
// test pins the SHAPE of the sudo branch instead.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolve from THIS file, not process.cwd(): the suite runs from tests/ and
// from the repo root alike (CI uses working-directory: tests), and a cwd-based
// path breaks in one of the two (the trap outbound-proxy-loopback.test.js
// still sits in).
const src = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "mitm", "manager.js"),
  "utf8"
);

// The sudo branch: from the `isSudoAvailable()` check to the spawn call.
const sudoBranch = src.slice(src.indexOf("} else if (isSudoAvailable()) {"), src.indexOf("serverProcess.stdin.write(`${sudoPassword}\\n`);"));

describe("MITM sudo spawn keeps ROUTER_API_KEY off argv (#31)", () => {
  it("the inline command never assigns ROUTER_API_KEY (no argv leak)", () => {
    expect(sudoBranch).not.toContain("ROUTER_API_KEY=${shellQuoteSingle(apiKey)}");
    expect(sudoBranch).not.toMatch(/ROUTER_API_KEY=[^$]/);
  });

  it("the key is read from stdin and exported inside the shell before exec", () => {
    expect(sudoBranch).toContain("IFS= read -r ROUTER_API_KEY");
    expect(sudoBranch).toContain("export ROUTER_API_KEY");
    expect(sudoBranch).toContain("exec ");
    // read must come BEFORE the exec it feeds, and exports before exec too
    expect(sudoBranch.indexOf("read -r ROUTER_API_KEY")).toBeLessThan(sudoBranch.indexOf("exec "));
    expect(sudoBranch.indexOf("export ROUTER_API_KEY")).toBeLessThan(sudoBranch.indexOf("exec "));
  });

  it("the non-sudo env assignments stay (they are env, not argv)", () => {
    // Windows / no-sudo branches pass the key through spawn env — that is the
    // safe channel; only the sudo argv was the leak.
    expect(src).toContain("ROUTER_API_KEY: apiKey");
  });

  it("the password and the key are written to stdin in that order", () => {
    const pwAt = src.indexOf("serverProcess.stdin.write(`${sudoPassword}\\n`);");
    const keyAt = src.indexOf("serverProcess.stdin.write(`${apiKey}\\n`);");
    expect(pwAt).toBeGreaterThan(-1);
    expect(keyAt).toBeGreaterThan(pwAt);
  });
});
