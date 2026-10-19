// anthropic-beta header assembly: the computed per-model flag set merges with
// the client's own anthropic-beta header (client-requested beta features must
// survive), and redact-thinking is suppressed when the client explicitly asked
// for thinking summaries.
import { describe, expect, it } from "vitest";

import { mergeAnthropicBeta, selectAnthropicBeta, wantsThinkingSummaries } from "open-sse/providers/shared.js";
import { DefaultExecutor } from "open-sse/executors/default.js";

const betaFlags = (headers) => (headers["Anthropic-Beta"] || "").split(",").map((s) => s.trim()).filter(Boolean);

describe("mergeAnthropicBeta", () => {
  it("unions and dedupes comma lists, ignoring blanks", () => {
    expect(mergeAnthropicBeta("a,b", " b , c ,", undefined, "")).toBe("a,b,c");
  });
});

describe("wantsThinkingSummaries / selectAnthropicBeta", () => {
  it("detects thinking.display summarized only", () => {
    expect(wantsThinkingSummaries({ thinking: { display: "summarized" } })).toBe(true);
    expect(wantsThinkingSummaries({ thinking: { type: "enabled" } })).toBe(false);
    expect(wantsThinkingSummaries(null)).toBe(false);
  });

  it("keeps redact-thinking by default, drops it when summaries are requested", () => {
    expect(selectAnthropicBeta("claude-opus-5")).toContain("redact-thinking-2026-02-12");
    expect(
      selectAnthropicBeta("claude-opus-5", { thinking: { display: "summarized" } }),
    ).not.toContain("redact-thinking-2026-02-12");
    // Heavy-agent flags stay gated to opus/sonnet regardless of body.
    expect(selectAnthropicBeta("claude-haiku-4-5")).not.toContain("advanced-tool-use-2025-11-20");
    expect(selectAnthropicBeta("claude-opus-5", { thinking: { display: "summarized" } })).toContain(
      "advanced-tool-use-2025-11-20",
    );
  });
});

describe("DefaultExecutor.buildHeaders() forwards client anthropic-beta", () => {
  it("keeps unknown client flags alongside the pinned set on claude", () => {
    const executor = new DefaultExecutor("claude");
    const rawHeaders = { "anthropic-beta": "safeguards-2026-09-01,context-1m-2025-08-07" };
    const flags = betaFlags(executor.buildHeaders({ apiKey: "k", rawHeaders }, true, undefined, "claude-opus-5"));
    expect(flags).toContain("safeguards-2026-09-01");
    expect(flags).toContain("context-1m-2025-08-07");
    expect(flags).toContain("context-management-2025-06-27");
    expect(new Set(flags).size).toBe(flags.length);
  });

  it("supplements redact-thinking with a client summary request through merge", () => {
    const executor = new DefaultExecutor("claude");
    // Client asked for summaries AND sent its own flag list — the computed set
    // must drop redact-thinking while the client flag survives.
    const headers = executor.buildHeaders(
      { apiKey: "k", rawHeaders: { "anthropic-beta": "context-1m-2025-08-07" } },
      true,
      undefined,
      "claude-sonnet-5",
      { thinking: { display: "summarized" } },
    );
    const flags = betaFlags(headers);
    expect(flags).not.toContain("redact-thinking-2026-02-12");
    expect(flags).toContain("context-1m-2025-08-07");
  });

  it("forwards client flags on anthropic-compatible Claude models", () => {
    const executor = new DefaultExecutor("anthropic-compatible-custom");
    const creds = {
      apiKey: "k",
      rawHeaders: { "anthropic-beta": "safeguards-2026-09-01" },
      providerSpecificData: { baseUrl: "https://gw.example.com/v1" },
    };
    const flags = betaFlags(executor.buildHeaders(creds, true, undefined, "claude-sonnet-5"));
    expect(flags).toContain("safeguards-2026-09-01");
    expect(flags).not.toContain("claude-code-20250219");
  });

  it("forwards client flags on the anthropic provider", () => {
    const executor = new DefaultExecutor("anthropic");
    const flags = betaFlags(
      executor.buildHeaders({ apiKey: "k", rawHeaders: { "anthropic-beta": "safeguards-2026-09-01" } }, true, undefined, "claude-sonnet-5"),
    );
    expect(flags).toContain("safeguards-2026-09-01");
  });
});
