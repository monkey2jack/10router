// Kiro 的 Claude Opus 5.5 点号 id 变体（上游 e78b766a 的思路重实现）：
//   · kiro registry 补 claude-opus-5.5 / -thinking / -agentic / -thinking-agentic
//   · capabilities canonical 精确键同步（1M 窗口 + adaptive thinking）
// 点号拼写是 Kiro 原生 id；capabilities 的 pattern `*claude*opus-5*` 虽能命中
// 同值，但精确键使解析不依赖 pattern 顺序。claude registry 另有横杠 id
// claude-opus-5-5（前批已加），两者并存。
import { describe, expect, it } from "vitest";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import {
  getCapabilitiesForModel,
  MODEL_CAPABILITIES,
} from "../../open-sse/providers/capabilities.js";

const DOT_IDS = [
  "claude-opus-5.5",
  "claude-opus-5.5-thinking",
  "claude-opus-5.5-agentic",
  "claude-opus-5.5-thinking-agentic",
];

const OPUS_55_CAPS = {
  vision: true,
  reasoning: true,
  search: true,
  thinkingFormat: "claude-adaptive",
  contextWindow: 1000000,
  maxOutput: 128000,
};

const kiro = REGISTRY.find((p) => p.id === "kiro");
const kiroIds = (kiro?.models || []).map((m) => (typeof m === "string" ? m : m.id));

describe("kiro registry — claude-opus-5.5 点号变体", () => {
  it.each(DOT_IDS)("%s 在 kiro 模型目录中", (id) => {
    expect(kiroIds).toContain(id);
  });

  it("opus-5 四变体仍在（回归守卫）", () => {
    for (const id of [
      "claude-opus-5",
      "claude-opus-5-thinking",
      "claude-opus-5-agentic",
      "claude-opus-5-thinking-agentic",
    ]) {
      expect(kiroIds).toContain(id);
    }
  });
});

describe("capabilities — claude-opus-5.5 点号变体", () => {
  it.each(DOT_IDS)("%s 有 canonical 精确键且解析为 1M + adaptive", (id) => {
    expect(MODEL_CAPABILITIES[id]).toMatchObject(OPUS_55_CAPS);
    expect(getCapabilitiesForModel("kiro", id)).toMatchObject(OPUS_55_CAPS);
  });

  it("横杠 id claude-opus-5-5（claude registry）不受点号行影响", () => {
    expect(getCapabilitiesForModel("claude", "claude-opus-5-5")).toMatchObject(OPUS_55_CAPS);
  });
});
