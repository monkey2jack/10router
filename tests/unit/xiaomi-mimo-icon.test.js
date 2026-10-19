import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getProviderIconSrc, resolveProviderIconId } from "@/shared/utils/providerIcon.js";
import { resolveProviderAlias } from "open-sse/services/model.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const iconDir = path.join(root, "public", "providers");
const baseIcon = path.join(iconDir, "xiaomi-mimo.png");
const desktopIcon = path.join(iconDir, "mimo-desktop.png");

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 128×128 RGBA is the house convention for provider tiles. */
function expectHousePng(file) {
  expect(fs.existsSync(file)).toBe(true);
  const buf = fs.readFileSync(file);
  expect(buf.subarray(0, 8)).toEqual(PNG_MAGIC);
  expect(buf.readUInt32BE(16)).toBe(128);
  expect(buf.readUInt32BE(20)).toBe(128);
  // color type 6 = RGBA: 瓦片必须带 alpha，不能是压白底的不透明白方块
  expect(buf[25]).toBe(6);
  return buf;
}

/**
 * 三卡拆分（2026-09-22）：MiMo Desktop 有了独立的 `mimo-desktop` provider。
 * 桌面卡最初经 ICON_ALIASES 复用主卡的 mark；后来改为携带**自己的**资产
 * （桌面客户端的金属质感图标）。本文件守卫两件事：
 *   1. 两条路径都必须指向真实存在、且符合 128px RGBA 约定 的文件；
 *   2. 两张卡必须**不同图** —— 之前别名复用正是为了「不新增加载不到 / 难分辨
 *      的图标槽位」，现在既然各有各的品牌面，就不能再退回同一份资源。
 */
describe("MiMo provider icons", () => {
  it("resolves each MiMo provider to the canonical provider id", () => {
    expect(getProviderIconSrc("xiaomi-mimo")).toBe("/providers/xiaomi-mimo.png");
    // 没有被 ICON_ALIASES / ICON_EXTENSIONS 改写过（改成 xiaomi-desktop 就会 404）
    expect(resolveProviderIconId("xiaomi-mimo")).toBe("xiaomi-mimo");
    expect(getProviderIconSrc("xiaomi-desktop")).toBe("/providers/xiaomi-desktop.png");
    // 桌面卡不再走别名，直接用自己的资产
    expect(resolveProviderIconId("mimo-desktop")).toBe("mimo-desktop");
    expect(getProviderIconSrc("mimo-desktop")).toBe("/providers/mimo-desktop.png");
  });

  it("ships both marks as real PNGs in the 128px house convention", () => {
    expectHousePng(baseIcon);
    expectHousePng(desktopIcon);
  });

  it("keeps the two cards visually distinct", () => {
    // 别名复用的年代，这里是可以相等的；改成专属资产后必须不同，否则
    // 「换图」就是空操作，卡片列表里两张卡依然分不开。
    expect(fs.readFileSync(desktopIcon).equals(fs.readFileSync(baseIcon))).toBe(false);
  });

  it("stays distinguishable from MiMo Code Free's orange mark", () => {
    // mimo-free 的 display name 就是 "MiMo Code Free"，同属小米 MiMo Code 家族。
    // 主卡与桌面卡都是灰阶标（黑/米白/金属），mimo-free 是 #ff6600 的橙标 ——
    // 用同一套橙色会让人在卡片列表里分不清，所以三者不能是同一份资源。
    const free = path.join(iconDir, "mimo-free.png");
    expect(fs.existsSync(free)).toBe(true);
    const freeBuf = fs.readFileSync(free);
    expect(fs.readFileSync(baseIcon).equals(freeBuf)).toBe(false);
    expect(fs.readFileSync(desktopIcon).equals(freeBuf)).toBe(false);
  });

  it("stays reachable through every registered alias", () => {
    // 主卡别名 → 主卡资产
    for (const alias of ["mimo", "xiaomi-mimo"]) {
      expect(resolveProviderAlias(alias)).toBe("xiaomi-mimo");
      expect(getProviderIconSrc("xiaomi-mimo")).toBe("/providers/xiaomi-mimo.png");
    }
    // 桌面卡别名 → 桌面卡资产
    for (const alias of ["mimo-desktop", "xmd"]) {
      expect(resolveProviderAlias(alias)).toBe("mimo-desktop");
      expect(getProviderIconSrc("mimo-desktop")).toBe("/providers/mimo-desktop.png");
    }
  });
});
