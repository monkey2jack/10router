// #49 兑现：免费线卡片的网关连通性检测 UI 字串在 zh-CN / zh-TW 齐全。
// 其余语言回落英文键名（与 RESET_TEMPLATE_KEY 等既有键的覆盖范围一致）。
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rootDir = resolve(__dirname, "../..");

const KEYS = [
  "Probing gateway...",
  "Gateway reachable",
  "Gateway unreachable",
  "Re-probe",
  "Gateway unreachable — install/launch CreditDaddy and enable the gateway, then re-probe here.",
  "Download CreditDaddy",
];

describe("gateway probe i18n strings (#49)", () => {
  for (const locale of ["zh-CN", "zh-TW"]) {
    it(`${locale} carries all ${KEYS.length} keys with non-empty translations`, () => {
      const dict = JSON.parse(readFileSync(resolve(rootDir, `public/i18n/literals/${locale}.json`), "utf8"));
      for (const key of KEYS) {
        expect(dict[key], `${locale} missing: ${key}`).toBeTruthy();
      }
    });
  }

  it("zh-CN wording names the action (install/launch CreditDaddy) in the offline guidance", () => {
    const dict = JSON.parse(readFileSync(resolve(rootDir, "public/i18n/literals/zh-CN.json"), "utf8"));
    const guidance = dict["Gateway unreachable — install/launch CreditDaddy and enable the gateway, then re-probe here."];
    expect(guidance).toContain("CreditDaddy");
    expect(guidance).toMatch(/重新检测/);
  });
});
