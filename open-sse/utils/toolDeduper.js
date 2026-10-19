/**
 * 派发前的工具归一化：
 * - 等价 MCP 存在时剥内置工具（仅 Claude 客户端，目标是减少工具定义 token 膨胀）。
 * - DeepSeek 模型的同名工具精确去重——DeepSeek 上游对所有端点上的重复工具名
 *   稳定报 400 "Tool names must be unique"（上游 9router #3333；GLM/MiniMax/Kimi
 *   等上游接受重复名）。保留首个定义即可：tool_choice 与消息历史中的引用均按
 *   name/id 寻址，丢弃后续同名定义不会破坏任何引用。
 */

import { isDeepSeekModel } from "../providers/models/helpers.js";

const DEDUP_RULES = [
  {
    // Exa MCP present → drop built-in web tools (Exa is preferred).
    triggers: ["mcp__exa__web_search_exa", "mcp__exa__web_fetch_exa"],
    strip: ["WebSearch", "WebFetch", "mcp__workspace__web_fetch"],
  },
  {
    // Tavily MCP present → drop built-in web tools.
    triggers: ["mcp__tavily__tavily_search", "mcp__tavily__tavily_extract"],
    strip: ["WebSearch", "WebFetch", "mcp__workspace__web_fetch"],
  },
  {
    // Browser MCP present → drop Cowork's duplicate Claude_in_Chrome connector.
    triggers: [/^mcp__browsermcp__/],
    strip: [/^mcp__Claude_in_Chrome__/],
  },
];

function getToolName(t) {
  return t?.name || t?.function?.name || "";
}

function matches(name, pattern) {
  if (typeof pattern === "string") return name === pattern;
  return pattern instanceof RegExp ? pattern.test(name) : false;
}

/**
 * @param {Array} tools - 翻译后的工具数组
 * @param {Object} [opts]
 * @param {string|null} [opts.clientTool] - 识别出的客户端（"claude" | "codex" | ...）
 * @param {string|null} [opts.model] - 模型 id，可带 "(level)" thinking 档位后缀
 * @returns {{ tools: Array, stripped: Array<string> }}
 */
function dedupeTools(tools, opts = {}) {
  if (!Array.isArray(tools) || tools.length === 0) return { tools, stripped: [] };
  const names = tools.map(getToolName);
  const toStrip = new Set();
  const toDrop = new Set(); // 同名重复工具的索引

  // MCP 等价内置工具去重：仅 Claude 客户端（既有行为，语义不变）。
  if (opts.clientTool === "claude") {
    for (const rule of DEDUP_RULES) {
      const hasTrigger = names.some((n) => rule.triggers.some((p) => matches(n, p)));
      if (!hasTrigger) continue;
      for (const n of names) {
        if (rule.strip.some((p) => matches(n, p))) toStrip.add(n);
      }
    }
  }

  // 精确同名去重：DeepSeek 上游拒绝重复工具名。作用于所有承载 deepseek-* 模型
  // 的 客户端 × 供应商 组合；非 DeepSeek 模型不处理。
  if (isDeepSeekModel(opts.model)) {
    const seen = new Set();
    for (let i = 0; i < tools.length; i++) {
      const n = getToolName(tools[i]);
      if (!n) continue;
      if (seen.has(n)) toDrop.add(i);
      else seen.add(n);
    }
  }

  if (toStrip.size === 0 && toDrop.size === 0) return { tools, stripped: [] };
  const out = tools.filter((t, i) => !toDrop.has(i) && !toStrip.has(getToolName(t)));
  const stripped = Array.from(toDrop).map((i) => getToolName(tools[i])).concat(Array.from(toStrip));
  return { tools: out, stripped };
}

export { dedupeTools };
