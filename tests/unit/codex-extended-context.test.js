/**
 * Codex `[1m]` 长上下文变体（上游 v0.5.95, 9f41ee75 的思路重实现）。
 *
 * 合同：
 * - registry 六个变体行（gpt-6 astra/sol/luna + gpt-5.6 sol/terra/luna），
 *   upstreamModelId 指回基础 id——上游只发基础模型。
 * - capabilities 变体 872k 窗口（codex / cx 两条入口同值，cx 别名共享表）。
 * - stripModelContextMarker 剥客户端标记；codex 专属的 400 文案走换号冷却，
 *   且不波及其它 provider 的同文案；普通 400 依旧是请求级、不冷却账号。
 */

import { describe, expect, it } from "vitest";

import codex from "../../open-sse/providers/registry/codex.js";
import { getModelUpstreamId } from "../../open-sse/config/providerModels.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { stripModelContextMarker } from "../../open-sse/utils/modelMarkers.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

const BASE_IDS = [
  "gpt-6-astra",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
];

describe("codex [1m] extended-context variants (上游 9f41ee75)", () => {
  it.each(BASE_IDS)("%s[1m] 注册为独立变体并指回基础上游 id", (base) => {
    const extended = `${base}[1m]`;
    expect(codex.models.find((m) => m.id === extended)?.upstreamModelId).toBe(base);
    expect(getModelUpstreamId("cx", extended)).toBe(base);
  });

  it.each(BASE_IDS)("%s[1m] 能力为 872k 长窗口（codex 与 cx 别名同值）", (base) => {
    const extended = `${base}[1m]`;
    expect(getCapabilitiesForModel("codex", extended)).toMatchObject({
      vision: true,
      reasoning: true,
      search: true,
      thinkingFormat: "openai",
      contextWindow: 872000,
      maxOutput: 128000,
    });
    expect(getCapabilitiesForModel("cx", extended).contextWindow).toBe(872000);
  });

  it("基础行的窗口不被变体污染（272k/372k 既有截断不变）", () => {
    expect(getCapabilitiesForModel("codex", "gpt-6-sol").contextWindow).toBe(272000);
    expect(getCapabilitiesForModel("codex", "gpt-5.6-sol").contextWindow).toBe(372000);
    expect(getCapabilitiesForModel("codex", "gpt-5.6-luna").contextWindow).toBe(272000);
  });

  it("marker 剥离：带前缀与大小写都只剩基础 id", () => {
    expect(stripModelContextMarker("cx/gpt-6-astra[1m]")).toEqual({
      model: "cx/gpt-6-astra",
      contextMarker: "1m",
    });
    expect(stripModelContextMarker("cx/gpt-6-astra[1M]")).toEqual({
      model: "cx/gpt-6-astra",
      contextMarker: "1m",
    });
    expect(stripModelContextMarker("cx/gpt-6-astra")).toEqual({
      model: "cx/gpt-6-astra",
      contextMarker: null,
    });
  });
});

describe("codex 专属 400 文案 → 换号（不波及其它 provider）", () => {
  const UNSUPPORTED =
    "The 'gpt-6-sol' model is not supported when using Codex with a ChatGPT account.";

  it("codex 命中长冷却换号规则", () => {
    expect(checkFallbackError(400, UNSUPPORTED, 0, "codex").shouldFallback).toBe(true);
  });

  it("同文案在其它 provider 不吃这条规则（落请求级不冷却分支）", () => {
    expect(checkFallbackError(400, UNSUPPORTED, 0, "openai").shouldFallback).toBe(false);
    expect(checkFallbackError(400, "Invalid JSON body", 0, "codex").shouldFallback).toBe(false);
  });
});
