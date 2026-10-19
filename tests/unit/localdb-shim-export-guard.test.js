/**
 * localDb shim export guard.
 *
 * src/lib/localDb.js is a re-export shim over src/lib/db/index.js. A missing
 * name there does not fail any unit test that mocks "@/lib/localDb" wholesale
 * (that is exactly how the 11128 channel-block helpers shipped unexported while
 * the whole suite stayed green — every chat request then died at runtime with
 * `TypeError: getChannelBlock is not a function`).
 *
 * This guard parses every `import { … } from "@/lib/localDb"` in src/ and
 * asserts each named import is really exported by the shim, so a forgotten
 * re-export fails CI instead of production.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";

const SRC = resolve(fileURLToPath(new URL("../../src", import.meta.url)));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".js")) out.push(p);
  }
  return out;
}

// `import { a, b as c } from "@/lib/localDb"` → ["a", "b"]
function namedImportsOf(source, moduleSpecifier) {
  const names = [];
  const re = new RegExp(
    `import\\s*\\{([^}]+)\\}\\s*from\\s*["']${moduleSpecifier}["']`,
    "g",
  );
  let m;
  while ((m = re.exec(source))) {
    for (const part of m[1].split(",")) {
      const token = part.trim();
      if (!token) continue;
      // "x as y" → original exported name is x; plain "x" → x
      names.push(token.split(/\s+as\s+/)[0].trim());
    }
  }
  return names;
}

describe("localDb shim — every named import resolves to a real export", () => {
  const shim = readFileSync(join(SRC, "lib", "localDb.js"), "utf8");
  const exported = new Set();
  // The shim is a single `export { … } from "@/lib/db/index.js"` block;
  // capture both "a" and "a as b" forms.
  const exportBlock = shim.match(/export\s*\{([^}]+)\}/g) || [];
  for (const block of exportBlock) {
    const inner = block.replace(/export\s*\{/, "").replace(/\}$/, "");
    for (const part of inner.split(",")) {
      const token = part.trim();
      if (!token) continue;
      exported.add(token.split(/\s+as\s+/).pop().trim());
    }
  }

  it("shim is non-trivial (sanity check on the parser itself)", () => {
    expect(exported.size).toBeGreaterThan(30);
  });

  it("no source file imports a name the shim lacks", () => {
    const offenders = [];
    for (const file of walk(SRC)) {
      if (file.endsWith("lib/localDb.js")) continue;
      const source = readFileSync(file, "utf8");
      for (const name of namedImportsOf(source, "@/lib/localDb")) {
        if (!exported.has(name)) {
          offenders.push(`${file.slice(SRC.length + 1)}: ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
