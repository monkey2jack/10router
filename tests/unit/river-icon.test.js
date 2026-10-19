import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getProviderIconSrc, resolveProviderIconId } from "@/shared/utils/providerIcon.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const iconFile = path.join(root, "public", "providers", "river.png");

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * River AI 外部推卡（CreditDaddy 余额卡，provider: "river"）的图标守卫：
 * 128×128 RGBA 瓦片房规（同 xiaomi-mimo-icon），缺图时卡片会退回 RI 占位字。
 * 资产来源：https://docs.river.ai/river-ai-favicon.png（800×800 官方 favicon 重采样）。
 */
describe("River provider icon", () => {
  it("resolves river to the canonical provider icon path", () => {
    expect(resolveProviderIconId("river")).toBe("river");
    expect(getProviderIconSrc("river")).toBe("/providers/river.png");
  });

  it("ships a 128×128 RGBA house-convention tile", () => {
    expect(fs.existsSync(iconFile)).toBe(true);
    const buf = fs.readFileSync(iconFile);
    expect(buf.subarray(0, 8)).toEqual(PNG_MAGIC);
    expect(buf.readUInt32BE(16)).toBe(128);
    expect(buf.readUInt32BE(20)).toBe(128);
    // color type 6 = RGBA（必须带 alpha，不能是压白底的不透明白方块）
    expect(buf[25]).toBe(6);
  });
});
