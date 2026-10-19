/**
 * Re-export local-binding guard.
 *
 * `export { foo } from "./mod"` is a *re-export*: it publishes `foo` to
 * consumers but creates NO local binding. A module that re-exports a name and
 * then calls it locally therefore compiles its own call site to a bare free
 * identifier and throws `ReferenceError: foo is not defined` at runtime.
 *
 * This is not theoretical. QuotaTable.js kept
 * `export { translateQuotaName } from "@/shared/utils/quotaName"` next to its
 * own `translateQuotaName(quota.name)` call; every consumer that *imported* the
 * name worked fine, so nothing failed until a per-pack row actually rendered —
 * i.e. only after the user expanded "逐包明细" on the quota tracker, which took
 * the whole page down to Next's "This page couldn't load" error boundary. The
 * entire unit suite stayed green because no test rendered that component.
 *
 * Same failure family as the missing `proxyPoolUrlError` export and the localDb
 * shim: a module-level binding problem that neither unit tests nor a successful
 * `next build` will catch.
 *
 * Detection is done on a real AST (acorn) rather than with regexes: the first
 * regex attempt matched `import ... from` lazily across line boundaries and
 * deleted whole function bodies, and could not handle the multi-line
 * `export {\n a,\n b,\n} from "..."` form that this tree uses everywhere. The
 * AST distinguishes the two structurally:
 *
 *   - `ExportNamedDeclaration` WITH a `source`  → re-export, binds nothing
 *   - any `ImportDeclaration` / dynamic `import()` destructuring → real binding
 *
 * A name that is re-exported-but-never-bound, yet has an identifier reference
 * in the module body, is the bug.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";
import * as acorn from "acorn";
import jsx from "acorn-jsx";

const SRC = resolve(fileURLToPath(new URL("../../src", import.meta.url)));

// Plain acorn cannot parse JSX, and this tree's components are .js files full of
// it. Without the JSX plugin every component threw a SyntaxError, was swallowed
// by the parse guard below, and the test passed vacuously — a false negative on
// exactly the file it was written to protect. Verified by reintroducing the
// QuotaTable bug and watching the suite stay green.
const Parser = acorn.Parser.extend(jsx());

function parseSource(source) {
  return Parser.parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
    allowHashBang: true,
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
  });
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|jsx|mjs)$/.test(p)) out.push(p);
  }
  return out;
}


function collectBoundNames(node, bound) {
  const addPattern = (target) => {
    if (!target) return;
    if (target.type === "Identifier") bound.add(target.name);
    else if (target.type === "ObjectPattern") {
      for (const prop of target.properties) {
        if (prop.type === "RestElement") addPattern(prop.argument);
        else addPattern(prop.value);
      }
    } else if (target.type === "ArrayPattern") {
      for (const el of target.elements) addPattern(el);
    } else if (target.type === "AssignmentPattern") {
      addPattern(target.left);
    }
  };

  // import { a as b } from "x"  /  import d from "x"  /  import * as ns
  if (node.type === "ImportDeclaration") {
    for (const spec of node.specifiers) addPattern(spec.local);
    return;
  }

  // const { a, b } = await import("x")  /  const { a } = require("x")
  if (node.type === "VariableDeclarator" && node.init) {
    const init = node.init;
    const isDynamicImport =
      init.type === "ImportExpression" ||
      (init.type === "AwaitExpression" && init.argument?.type === "ImportExpression") ||
      (init.type === "CallExpression" &&
        init.callee?.type === "Identifier" &&
        init.callee.name === "require");
    if (isDynamicImport) addPattern(node.id);
  }
}

/**
 * Walk the AST, skipping nested-function scopes for the "is it referenced"
 * question when the name is genuinely bound there — but we only need
 * *references*, and any reference to a name that has no module-level binding is
 * a free-identifier read regardless of function depth (unless shadowed by a
 * parameter or local declaration, which is rare for these names and would make
 * the code intentional).
 */
function analyze(source) {
  const ast = parseSource(source);

  const reexported = new Set(); // published via `export { a } from "src"`, no local binding
  const bound = new Set(); // has a real local binding
  const referenced = new Set(); // read somewhere in the body

  // Pass 1: declarations
  for (const node of ast.body) {
    if (node.type === "ExportNamedDeclaration" && node.source) {
      for (const spec of node.specifiers) {
        if (spec.exported?.name) reexported.add(spec.exported.name);
      }
      continue;
    }
    if (node.type === "ExportNamedDeclaration" && node.declaration) {
      collectDeclaredNames(node.declaration, bound);
      continue;
    }
    if (node.type === "ExportDefaultDeclaration" && node.declaration) {
      collectDeclaredNames(node.declaration, bound);
      continue;
    }
    if (node.type === "ImportDeclaration") {
      collectBoundNames(node, bound);
      continue;
    }
    collectDeclaredNames(node, bound);
  }

  // Pass 2: references, including nested dynamic imports.
  //
  // The `exported` / `imported` halves of import & export specifiers are NOT
  // references to a local variable — `export { default as useThemeStore } from
  // "./x"` is a pure barrel with no local read at all. Walking those nodes makes
  // every re-export barrel look like an offender, so they are pruned here.
  const NOT_A_REFERENCE = new Set([
    "ExportNamedDeclaration",
    "ExportAllDeclaration",
    "ExportDefaultDeclaration",
    "ImportDeclaration",
    "ImportSpecifier",
    "ImportDefaultSpecifier",
    "ImportNamespaceSpecifier",
    "ExportSpecifier",
    // `{ a: 1 }` key position and `obj.a` member access are not variable reads.
    "Property",
    "MemberExpression",
  ]);

  const visit = (node) => {
    if (!node || typeof node.type !== "string") return;
    if (node.type === "VariableDeclarator") collectBoundNames(node, bound);
    if (node.type === "ImportDeclaration") collectBoundNames(node, bound);

    if (node.type === "Identifier") {
      referenced.add(node.name);
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === "type" || key === "start" || key === "end" || key === "loc") continue;
      // Skip the non-reference halves of specifiers / property keys.
      if (NOT_A_REFERENCE.has(node.type) && key !== "value" && key !== "declaration") continue;
      if (node.type === "Property" && key === "key" && !node.computed) continue;
      if (node.type === "MemberExpression" && key === "property" && !node.computed) continue;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value.type === "string") visit(value);
    }
  };
  visit(ast);

  const offenders = [];
  for (const name of reexported) {
    if (bound.has(name)) continue; // correctly imported as well
    if (referenced.has(name)) offenders.push(name);
  }
  return { offenders, reexported: [...reexported], bound: [...bound] };
}

function collectDeclaredNames(node, bound) {
  if (!node) return;
  if (node.type === "FunctionDeclaration" && node.id) bound.add(node.id.name);
  else if (node.type === "ClassDeclaration" && node.id) bound.add(node.id.name);
  else if (node.type === "VariableDeclaration") {
    for (const d of node.declarations) collectBoundNames(d, bound);
  }
}

describe("no module uses a name it only re-exports", () => {
  const files = walk(SRC);

  it("scans the source tree", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  for (const file of files) {
    const rel = file.slice(SRC.length + 1).replace(/\\/g, "/");
    it(`${rel} has no re-export shadowed by a local read`, () => {
      const source = readFileSync(file, "utf8");
      // NOTE: no parse-failure escape hatch. A file that cannot be parsed must
      // fail loudly — swallowing it is exactly how this guard went vacuously
      // green (plain acorn + JSX components).
      const result = analyze(source);
      expect(
        result.offenders,
        `${rel} re-exports ${result.offenders.join(", ")} but also reads it ` +
          `locally — a re-export creates no local binding, so that read is a ` +
          `free identifier and throws ReferenceError at render time. Import ` +
          `the name normally and re-export it with a separate ` +
          `\`export { name };\`.`,
      ).toEqual([]);
    });
  }
});
