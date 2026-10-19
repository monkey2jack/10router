import { describe, expect, it } from "vitest";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import {
  DEFAULT_CAPABILITIES,
  PROVIDER_CAPABILITIES,
  getCapabilitiesForModel,
} from "../../open-sse/providers/capabilities.js";

const qoder = REGISTRY.find((p) => p.id === "qoder");
const qoderCn = REGISTRY.find((p) => p.id === "qoder-cn");

// 虚拟档（auto/efficient）的钉住形状：与 ultimate/performance 同形状的保守超集。
const VIRTUAL_TIER_SHAPE = {
  vision: true,
  reasoning: true,
  thinkingFormat: "claude-adaptive",
  thinkingCanDisable: false,
  contextWindow: 1000000,
  maxOutput: 128000,
};

describe("qoder / qoder-cn capability rows", () => {
  for (const entry of [qoder, qoderCn]) {
    const provider = entry.id;
    const rows = PROVIDER_CAPABILITIES[provider];

    it(`${provider}: every registry model id has a provider row (no floor fallback)`, () => {
      for (const m of entry.models) {
        expect(rows[m.id], `${provider}/${m.id} missing provider row`).toBeDefined();
      }
    });

    it(`${provider}: every display name aliases to its internal id row`, () => {
      for (const m of entry.models) {
        if (!m.name || m.name === m.id) continue;
        const byId = getCapabilitiesForModel(provider, m.id);
        expect(
          getCapabilitiesForModel(provider, m.name),
          `${provider}/${m.name}`,
        ).toEqual(byId);
        expect(byId.thinkingCanDisable).toBe(false);
        // 客户端的全限定写法 "provider/<Name>" 同样必须命中 provider 行。
        expect(
          getCapabilitiesForModel(provider, `${provider}/${m.name}`),
          `${provider}/${provider}/${m.name}`,
        ).toEqual(byId);
      }
    });
  }

  it("qoder/Qwen3.8-Max short-circuits the generic *qwen*max* pattern via the provider row", () => {
    const caps = getCapabilitiesForModel("qoder", "Qwen3.8-Max");
    // 通用族 pattern 不声明 thinkingCanDisable（DEFAULT=true，思考可关）；
    // provider 行固定 false（上游 modelConfig 锁死思考，客户端意图被丢弃）。
    expect(caps.thinkingCanDisable).toBe(false);
    expect(caps).toEqual(getCapabilitiesForModel("qoder", "qmodel_38max"));
    expect(getCapabilitiesForModel("qoder", "qoder/Qwen3.8-Max")).toEqual(caps);
  });

  it("pins the virtual-tier shape (auto / efficient) on both regions", () => {
    const expected = { ...DEFAULT_CAPABILITIES, ...VIRTUAL_TIER_SHAPE };
    expect(getCapabilitiesForModel("qoder", "auto")).toEqual(expected);
    expect(getCapabilitiesForModel("qoder", "efficient")).toEqual(expected);
    expect(getCapabilitiesForModel("qoder-cn", "auto")).toEqual(expected);
  });

  it("transport/UI aliases (qd / qdc) resolve the same provider rows as their ids", () => {
    // /api/models 的 AI_MODELS 用 PROVIDER_MODELS 的 key（即 alias）拼 provider，
    // 若 alias 不归一化到 id，qmodel_38max 等会跌到 DEFAULT 200k（vision/reasoning 被剥）。
    for (const [alias, id] of [["qd", "qoder"], ["qdc", "qoder-cn"]]) {
      for (const m of [qoder, qoderCn].find((p) => p.id === id).models) {
        expect(
          getCapabilitiesForModel(alias, m.id),
          `${alias}/${m.id}`,
        ).toEqual(getCapabilitiesForModel(id, m.id));
      }
    }
  });

  // ── vision 活体实测背书（学习上游 9router PR #4799，2026-10-13 PNG 随机码
  // 探测：13 个具体 id 全部读回，含旧 is_vl 旗标误标为纯文本的四档）──
  it("every concrete id claims vision (live-probed upstream, incl. DeepSeek/GLM/MiniMax)", () => {
    for (const id of [
      "dmodel", "dfmodel", "gmodel", "gfmodel",
      "kmodel", "kmodel_latest", "mmodel",
      "qmodel", "qmodel_latest", "qfmodel", "qmodel_38max",
    ]) {
      expect(getCapabilitiesForModel("qoder", id)?.vision, `qoder/${id}`).toBe(true);
    }
    for (const id of ["dmodel", "dfmodel", "gmodel", "mmodel"]) {
      expect(getCapabilitiesForModel("qoder-cn", id)?.vision, `qoder-cn/${id}`).toBe(true);
    }
  });

  it("CN-only GLM-5.2 (gm51model) stays text-only — the live probe did not cover it", () => {
    // 上游探测未覆盖 5.2 非 flash，保守默认维持，不跟家族复制。
    expect(getCapabilitiesForModel("qoder-cn", "gm51model")?.vision).toBe(false);
  });
});
