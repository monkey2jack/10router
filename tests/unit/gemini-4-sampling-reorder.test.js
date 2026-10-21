import { describe, expect, it } from "vitest";
import { normalizeGeminiContents } from "../../open-sse/translator/formats/gemini.js";
import { openaiToGeminiRequest } from "../../open-sse/translator/request/openai-to-gemini.js";

describe("Gemini 4 functionResponse-last and sampling parameter handling", () => {
  it("drops sampling parameters (temperature, top_p, top_k) for gemini-4 models", () => {
    const body = {
      model: "gemini-4-argon",
      temperature: 0.7,
      top_p: 0.9,
      top_k: 40,
      max_tokens: 2048,
      messages: [{ role: "user", content: "hello" }],
    };
    const req = openaiToGeminiRequest("gemini-4-argon", body, false);
    expect(req.generationConfig.temperature).toBeUndefined();
    expect(req.generationConfig.topP).toBeUndefined();
    expect(req.generationConfig.topK).toBeUndefined();
    expect(req.generationConfig.maxOutputTokens).toBe(2048);
  });

  it("preserves sampling parameters for non-gemini-4 models", () => {
    const body = {
      model: "gemini-3.8-flash",
      temperature: 0.7,
      top_p: 0.9,
      top_k: 40,
      max_tokens: 2048,
      messages: [{ role: "user", content: "hello" }],
    };
    const req = openaiToGeminiRequest("gemini-3.8-flash", body, false);
    expect(req.generationConfig.temperature).toBe(0.7);
    expect(req.generationConfig.topP).toBe(0.9);
    expect(req.generationConfig.topK).toBe(40);
    expect(req.generationConfig.maxOutputTokens).toBe(2048);
  });

  it("orders functionResponse last in merged user turn for gemini-4", () => {
    const contents = [
      {
        role: "user",
        parts: [
          { functionResponse: { name: "test_tool", response: { result: "ok" } } },
          { text: "user message after tool" },
        ],
      },
      {
        role: "user",
        parts: [
          { functionResponse: { name: "test_tool_2", response: { result: "ok 2" } } },
        ],
      },
    ];

    const normalized = normalizeGeminiContents(contents, { model: "gemini-4-argon" });
    expect(normalized).toHaveLength(1);
    expect(normalized[0].role).toBe("user");
    // Text should be first, functionResponses should be at the end
    expect(normalized[0].parts[0]).toEqual({ text: "user message after tool" });
    expect(normalized[0].parts[1]).toHaveProperty("functionResponse");
    expect(normalized[0].parts[2]).toHaveProperty("functionResponse");
  });

  it("does not reorder parts if not gemini-4", () => {
    const contents = [
      {
        role: "user",
        parts: [
          { functionResponse: { name: "test_tool", response: { result: "ok" } } },
          { text: "user message after tool" },
        ],
      },
    ];

    const normalized = normalizeGeminiContents(contents, { model: "gemini-3.8-flash" });
    expect(normalized[0].parts[0]).toHaveProperty("functionResponse");
    expect(normalized[0].parts[1]).toEqual({ text: "user message after tool" });
  });
});
