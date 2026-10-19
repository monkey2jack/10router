import { describe, it, expect } from "vitest";
import { claudeToOpenAIRequest } from "../../open-sse/translator/request/claude-to-openai.js";

describe("claudeToOpenAIRequest tool_result image handling (Issue #68)", () => {
  it("extracts image blocks from tool_result and injects into trailing user message", () => {
    const body = {
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Please call test tool" }],
        },
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "tu_1", name: "test", input: {} },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu_1",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: "image/png",
                    data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
                  },
                },
              ],
            },
            {
              type: "text",
              text: "What color is in the tool result? Answer with color only.",
            },
          ],
        },
      ],
    };

    const result = claudeToOpenAIRequest("gpt-4o", body, true);
    expect(result.messages).toBeDefined();

    // Must have tool message and trailing user message with image_url
    const toolMsg = result.messages.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg.tool_call_id).toBe("tu_1");
    expect(toolMsg.content).toBe("[Image attached to tool result]");

    // The user turn that paired with the tool result must contain both the image_url and the follow-up text
    const lastUserMsg = result.messages[result.messages.length - 1];
    expect(lastUserMsg.role).toBe("user");
    expect(Array.isArray(lastUserMsg.content)).toBe(true);

    const imgPart = lastUserMsg.content.find((p) => p.type === "image_url");
    expect(imgPart).toBeDefined();
    expect(imgPart.image_url.url).toContain("data:image/png;base64,iVBORw0KGgo");

    const textPart = lastUserMsg.content.find((p) => p.type === "text");
    expect(textPart).toBeDefined();
    expect(textPart.text).toBe("What color is in the tool result? Answer with color only.");
  });

  it("tool_result with both text and image preserves text in tool message and image in user message", () => {
    const body = {
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu_2",
              content: [
                { type: "text", text: "File read successfully." },
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: "image/jpeg",
                    data: "abc12345",
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    const result = claudeToOpenAIRequest("gpt-4o", body, true);
    const toolMsg = result.messages.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg.content).toBe("File read successfully.");

    const userMsg = result.messages.find((m) => m.role === "user");
    expect(userMsg).toBeDefined();
    expect(Array.isArray(userMsg.content)).toBe(true);
    expect(userMsg.content[0].type).toBe("image_url");
    expect(userMsg.content[0].image_url.url).toBe("data:image/jpeg;base64,abc12345");
  });
});
