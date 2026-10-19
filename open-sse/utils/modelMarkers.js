// Claude Code 开启 1M 上下文 beta 后会在模型名后追加方括号标记：
// `claude-opus-5` 变成 `claude-opus-5[1m]`。这个标记是客户端注记，不属于任何
// 模型 id：它不匹配 combo 名、alias 或 `provider/model` 对，带着它进入解析只会
// 死在 "Invalid model format"。
//
// 1M 能力本身走 `anthropic-beta: context-1m-2025-08-07` 请求头（原样透传），
// 所以剥掉标记即可让请求按普通模型路由、仍以 1M 请求到达上游。codex 侧则把
// 被剥下的标记重新拼成请求侧 id（`gpt-6-astra[1m]`），供账号 enabledModels
// 过滤区分「普通请求」与「长上下文请求」（上游 v0.5.95, 9f41ee75）。

const CONTEXT_MARKER = /\[1m\]$/i;

// 返回 { model, contextMarker }；无标记时 contextMarker 为 null。
export function stripModelContextMarker(modelStr) {
  if (typeof modelStr !== "string") return { model: modelStr, contextMarker: null };
  const trimmed = modelStr.trim();
  const match = trimmed.match(CONTEXT_MARKER);
  if (!match) return { model: modelStr, contextMarker: null };
  return { model: trimmed.slice(0, -match[0].length), contextMarker: match[0].slice(1, -1).toLowerCase() };
}
