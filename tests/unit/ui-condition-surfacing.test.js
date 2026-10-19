/**
 * Two "the UI was hiding a real condition" guards.
 *
 * 1. A backup taken while some credentials could not be decrypted still
 *    downloads — the backend deliberately carries the ciphertext through instead
 *    of dropping it, and reports the affected ids in `credentialErrors`. The
 *    page used to report a flat success regardless, so the operator had no way
 *    to know their backup was only restorable on a machine holding the original
 *    key. The payload field was already there; only the surfacing was missing.
 *
 * 2. The bootstrap hint told the operator to open the dashboard at a hardcoded
 *    http://127.0.0.1:20128. That is simply the wrong address for anyone whose
 *    gateway runs on another port (the launcher's is configurable) or who moved
 *    it themselves, and the address they need is already in the URL bar.
 *
 * These are source guards because the failure mode is invisible in a browser:
 * the page renders, the button works, and nothing says the message is wrong or
 * absent.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const abs = (rel) => fileURLToPath(new URL(`../../${rel}`, import.meta.url));
const read = (rel) => readFileSync(abs(rel), "utf8");
const literal = (lang) => JSON.parse(read(`public/i18n/literals/${lang}.json`));

const PROFILE = "src/app/(dashboard)/dashboard/profile/page.js";
const LOGIN = "src/app/login/page.js";
const BACKUP_WARNING =
  "Backup downloaded, but {count} connection(s) could not be decrypted — their credentials are stored as ciphertext and can only be restored with the original key.";

describe("backup download warns about undecryptable credentials", () => {
  it("reads credentialErrors from the export payload and warns when non-empty", () => {
    const src = read(PROFILE);
    expect(src).toContain("payload?.credentialErrors");
    // Must branch, not just mention it: an empty list is a clean success.
    expect(src).toMatch(/credentialErrors\.length > 0/);
    expect(src).toContain(`translate(`);
    expect(src).toContain("Backup downloaded, but {count} connection(s) could not be decrypted");
    // The count is interpolated, not printed as a literal placeholder.
    expect(src).toMatch(/\.replace\("\{count\}"/);
    // A clean export still says so — the warning must not replace the success path.
    expect(src).toContain('"Database backup downloaded"');
  });

  it("marks the warning as an error, not a success", () => {
    const src = read(PROFILE);
    // Find the block that sets the credentialErrors warning and check its type.
    const at = src.indexOf("credentialErrors.length > 0");
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(at, at + 400);
    expect(block).toMatch(/type:\s*"error"/);
  });

  it("has both Chinese dictionaries for the warning", () => {
    for (const lang of ["zh-CN", "zh-TW"]) {
      expect(literal(lang)[BACKUP_WARNING], `${lang} missing backup warning`).toBeTruthy();
    }
  });
});

describe("bootstrap hint uses the real local origin", () => {
  it("derives the origin instead of hardcoding the default port", () => {
    const src = read(LOGIN);
    // The literal in the hint text must be gone.
    expect(src).not.toContain("open http://127.0.0.1:20128 there");
    // Derived from the address bar, with the documented default only as the
    // pre-hydration fallback.
    expect(src).toContain("window.location");
    expect(src).toMatch(/const p = port \|\| \(protocol === "https:" \? "443" : "80"\)/);
    // One-shot external read: a setState-in-effect would cascade a render, and
    // this page already has enough of those (react-compiler flags them).
    expect(src).not.toMatch(/setLocalOrigin/);
    expect(src).toContain("const [localOrigin] = useState(() =>");
    // And the derived value is actually rendered.
    expect(src).toContain("{localOrigin}");
  });
});
