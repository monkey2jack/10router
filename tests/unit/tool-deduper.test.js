// toolDeduper 单测：DeepSeek 同名工具去重（上游 9router 7f5bd155, issue #3333，
// 按思路重实现）+ 既有 Claude MCP 等价内置工具去重不回归。
import { describe, it, expect } from "vitest";
import { dedupeTools } from "../../open-sse/utils/toolDeduper.js";

const BASH = (name = "Bash", desc = "Run a shell command") => ({
  name,
  description: desc,
  input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
});

const FUNC_SHAPE = (name = "Bash") => ({
  type: "function",
  function: { name, description: "Run a shell command", parameters: { type: "object", properties: { command: { type: "string" } } } },
});

const MCP_EXA = { name: "mcp__exa__web_search_exa", description: "search" };

describe("toolDeduper — Claude MCP 等价规则（既有行为不回归）", () => {
  it("claude 客户端 + Exa MCP → 剥掉内置 WebSearch/WebFetch", () => {
    const { tools, stripped } = dedupeTools(
      [MCP_EXA, { name: "WebSearch", description: "web" }, { name: "WebFetch", description: "web" }, BASH()],
      { clientTool: "claude" }
    );
    expect(tools.map((t) => t.name)).toEqual(["mcp__exa__web_search_exa", "Bash"]);
    expect(stripped.sort()).toEqual(["WebFetch", "WebSearch"]);
  });

  it("browsermcp MCP → 剥掉 Claude_in_Chrome 连接器", () => {
    const { tools, stripped } = dedupeTools(
      [{ name: "mcp__browsermcp__navigate" }, { name: "mcp__Claude_in_Chrome__click" }, BASH()],
      { clientTool: "claude" }
    );
    expect(tools.map((t) => t.name)).toEqual(["mcp__browsermcp__navigate", "Bash"]);
    expect(stripped).toEqual(["mcp__Claude_in_Chrome__click"]);
  });

  it("非 claude 客户端 → MCP 规则不触发（行为保持）", () => {
    const { tools, stripped } = dedupeTools(
      [MCP_EXA, { name: "WebSearch", description: "web" }],
      { clientTool: "codex" }
    );
    expect(tools.map((t) => t.name)).toEqual(["mcp__exa__web_search_exa", "WebSearch"]);
    expect(stripped).toEqual([]);
  });

  it("无 opts 旧调用形 → MCP 规则休眠（原本就由 chatCore 处 claude 门控）", () => {
    const { tools, stripped } = dedupeTools([MCP_EXA, { name: "WebSearch", description: "web" }]);
    expect(tools).toHaveLength(2);
    expect(stripped).toEqual([]);
  });
});

describe("toolDeduper — DeepSeek 同名工具去重（新增）", () => {
  it("deepseek 模型 + 同名工具 → 保留首个定义（含其 description/schema）", () => {
    const first = BASH();
    const dup = BASH("Bash", "duplicate description");
    const { tools, stripped } = dedupeTools([first, dup], { model: "deepseek-v4-flash" });
    expect(tools).toEqual([first]);
    expect(stripped).toEqual(["Bash"]);
  });

  it("deepseek 模型 + (max) thinking 档位后缀 → 仍去重（先剥后缀再匹配）", () => {
    const { tools, stripped } = dedupeTools([BASH(), BASH("Bash", "dup")], { model: "deepseek-v4-flash(max)" });
    expect(tools).toHaveLength(1);
    expect(stripped).toEqual(["Bash"]);
  });

  it("deepseek + 3 个同名工具 → 保留首个，后两个都丢弃", () => {
    const { tools, stripped } = dedupeTools([BASH(), BASH("Bash", "d1"), BASH("Bash", "d2")], { model: "deepseek-v4-pro" });
    expect(tools).toHaveLength(1);
    expect(stripped).toEqual(["Bash", "Bash"]);
  });

  it("deepseek + OpenAI function 形态 → 按 function.name 去重", () => {
    const { tools } = dedupeTools([FUNC_SHAPE("Bash"), FUNC_SHAPE("Bash")], { model: "deepseek-v4-flash" });
    expect(tools).toHaveLength(1);
    expect(tools[0].function.name).toBe("Bash");
  });

  it("非 deepseek 模型 + 同名工具 → 原样不处理（GLM/MiniMax/Kimi 上游接受重复名）", () => {
    const tools = [BASH(), BASH("Bash", "dup")];
    const { tools: out, stripped } = dedupeTools(tools, { model: "glm-5.2" });
    expect(out).toBe(tools);
    expect(stripped).toEqual([]);
  });

  it("未声明模型 → 同名去重不触发（安全默认）", () => {
    const tools = [BASH(), BASH("Bash", "dup")];
    const { tools: out, stripped } = dedupeTools(tools, {});
    expect(out).toBe(tools);
    expect(stripped).toEqual([]);
  });

  it("deepseek + 不同名工具 → 不动", () => {
    const { tools, stripped } = dedupeTools([BASH("Bash"), BASH("ReadFile")], { model: "deepseek-v4-flash" });
    expect(tools).toHaveLength(2);
    expect(stripped).toEqual([]);
  });

  it("名字仅为包含关键字而非 deepseek- 前缀 → 不误伤", () => {
    const tools = [BASH(), BASH("Bash", "dup")];
    const { tools: out, stripped } = dedupeTools(tools, { model: "my-deepseek-x" });
    expect(out).toBe(tools);
    expect(stripped).toEqual([]);
  });

  it("claude 客户端 + deepseek + MCP 触发 → 两套规则并集生效", () => {
    const { tools, stripped } = dedupeTools(
      [MCP_EXA, { name: "WebSearch", description: "web" }, BASH(), BASH("Bash", "dup")],
      { clientTool: "claude", model: "deepseek-v4-flash" }
    );
    expect(tools.map((t) => t.name)).toEqual(["mcp__exa__web_search_exa", "Bash"]);
    expect(stripped.sort()).toEqual(["Bash", "WebSearch"]);
  });
});
