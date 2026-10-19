import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rootDir = resolve(__dirname, "../..");

describe("Xiaomi MiMo test error i18n", () => {
  const fullErrorKey = "HTTP 502: [502]: This model requires the Xiaomi MiMo desktop account. Sign in to MiMo Desktop once, then retry.";
  const innerErrorKey = "This model requires the Xiaomi MiMo desktop account. Sign in to MiMo Desktop once, then retry.";

  it("zh-CN dictionary contains the full error and inner error translations", () => {
    const zhCN = JSON.parse(readFileSync(resolve(rootDir, "public/i18n/literals/zh-CN.json"), "utf8"));
    expect(zhCN[fullErrorKey]).toBe("该模型需要小米 MiMo 桌面版账号。请先登录一次 MiMo 桌面版，然后重试。");
    expect(zhCN[innerErrorKey]).toBe("该模型需要小米 MiMo 桌面版账号。请先登录一次 MiMo 桌面版，然后重试。");
  });

  it("zh-TW dictionary contains the full error and inner error translations", () => {
    const zhTW = JSON.parse(readFileSync(resolve(rootDir, "public/i18n/literals/zh-TW.json"), "utf8"));
    expect(zhTW[fullErrorKey]).toBe("該模型需要小米 MiMo 桌面版帳號。請先登入一次 MiMo 桌面版，然後重試。");
    expect(zhTW[innerErrorKey]).toBe("該模型需要小米 MiMo 桌面版帳號。請先登入一次 MiMo 桌面版，然後重試。");
  });

  it("Provider detail page formats modelsTestError with formatModelTestError", () => {
    const pageSource = readFileSync(
      resolve(rootDir, "src/app/(dashboard)/dashboard/providers/[id]/page.js"),
      "utf8",
    );
    expect(pageSource).toContain("formatModelTestError(modelsTestError)");
  });
});
