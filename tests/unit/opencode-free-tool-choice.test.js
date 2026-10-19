import { describe, expect, it } from "vitest";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";

// muse-spark-1.3-contributor-free 400s on any tool_choice other than "auto"
// (named/required/none must demote to "auto"). The quirk allowlist lives in the
// registry transport; the executor demotes before the fingerprint pass, whose
// retarget logic then has no named choice left to touch.
const FREE_13 = "muse-spark-1.3-contributor-free";
const CREDS = { connectionId: "opencode-free-tool-choice-test" };
const INPUT = [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }];
const TOOLS = [{ type: "function", name: "get_weather", description: "w", parameters: { type: "object", properties: {} } }];

function responsesBody(model, tool_choice) {
  const body = { model, input: structuredClone(INPUT), tools: structuredClone(TOOLS) };
  if (tool_choice !== undefined) body.tool_choice = tool_choice;
  return body;
}

function transform(model, choice) {
  return new OpenCodeExecutor().transformRequest(
    model, responsesBody(model, structuredClone(choice)), true, CREDS,
  );
}

describe("opencode Free 1.3 tool_choice auto-only", () => {
  it("declares the quirk for exactly the 1.3-Free model in the registry", () => {
    expect(PROVIDERS.opencode.quirks?.forceAutoToolChoiceModels).toEqual([FREE_13]);
  });

  it.each([
    ["Responses named", { type: "function", name: "get_weather" }],
    ["Chat function named", { type: "function", function: { name: "get_weather" } }],
    ["Claude tool named", { type: "tool", name: "get_weather" }],
    ["required", "required"],
    ["none", "none"],
  ])("demotes %s to auto (plain and max)", (_label, choice) => {
    for (const model of [FREE_13, `${FREE_13}(max)`]) {
      const out = transform(model, choice);
      expect(out.tool_choice).toBe("auto");
      // The caller's own tool survives the fingerprint pass (quartet tools are
      // appended alongside, not instead).
      expect(out.tools.some((t) => t.name === "get_weather" || t.function?.name === "get_weather")).toBe(true);
      expect(out.input).toEqual(INPUT);
    }
  });

  it("keeps auto; absent becomes auto via the fingerprint default (repo baseline)", () => {
    expect(transform(FREE_13, "auto").tool_choice).toBe("auto");
    expect(transform(FREE_13, undefined).tool_choice).toBe("auto");
  });

  it.each([
    ["1.2-Free", "muse-spark-1.2-contributor-free"],
    ["future 1.4-Free", "muse-spark-1.4-contributor-free"],
    ["non-Muse", "big-pickle"],
  ])("does not touch tool_choice of %s", (_label, model) => {
    const choice = { type: "function", name: "get_weather" };
    const out = transform(model, choice);
    expect(out.tool_choice).toEqual(choice);
  });
});
