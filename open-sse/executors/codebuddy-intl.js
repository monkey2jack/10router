import { DefaultExecutor } from "./default.js";

/**
 * CodeBuddyIntlExecutor — talks to https://www.codebuddy.ai/v2/chat/completions
 *
 * Same OpenAI-compatible-but-stream-only gateway behavior as codebuddy-cn:
 * non-stream requests are rejected, and reasoning is surfaced only when the
 * request carries the IDE's OpenAI-style reasoning params. Force stream and
 * mirror reasoning_summary exactly like CodeBuddyExecutor.
 */
export class CodeBuddyIntlExecutor extends DefaultExecutor {
  constructor() {
    super("codebuddy-intl");
  }

  transformRequest(model, body, stream, credentials) {
    const transformed = super.transformRequest(model, body, stream, credentials);
    transformed.stream = true;

    // Upstream CodeBuddy deepseek models reject requests with 400 (code 11155
    // "the reasoning content from the previous turn must be passed back in thinking mode")
    // whenever reasoning is requested (reasoning_effort / reasoning_summary) but any
    // prior assistant turn in the history with tool_calls is missing a non-empty
    // reasoning_content. If any tool_calls turn lacks reasoning_content, drop reasoning
    // parameters to let the tool-execution turn succeed cleanly.
    const source = Array.isArray(transformed.messages) ? transformed.messages : [];
    const hasUnreasonedToolTurn = source.some(
      (m) => m && m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0 && !(typeof m.reasoning_content === "string" && m.reasoning_content.trim())
    );

    const eff = transformed.reasoning_effort;
    if (hasUnreasonedToolTurn || eff === "none" || eff === "off") {
      delete transformed.reasoning_effort;
      delete transformed.reasoning_summary;
    } else if (eff) {
      transformed.reasoning_summary = "auto";
    }

    // CodeBuddy rejects plain OpenAI shape (11101 invalid request): needs a
    // leading system prompt + user content as typed blocks, not a bare string.
    transformed.messages = [{ role: "system", content: "You are CodeBuddy Code." }];
    for (const message of source) {
      if (!message || typeof message !== "object" || ["system", "developer"].includes(message.role)) continue;
      if (message.role === "user" && typeof message.content === "string") {
        transformed.messages.push({ ...message, content: [{ type: "text", text: message.content }] });
      } else {
        transformed.messages.push({ ...message });
      }
    }

    return transformed;
  }
}

export default CodeBuddyIntlExecutor;
