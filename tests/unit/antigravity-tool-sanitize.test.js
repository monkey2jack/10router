import { describe, expect, it } from "vitest";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { translateRequest, translateResponse, initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import {
  cleanJSONSchemaForAntigravity,
  toGeminiParameters,
  normalizeGeminiContents,
} from "../../open-sse/translator/formats/gemini.js";
import {
  sanitizeGeminiToolName,
  createGeminiToolNamer,
  attachToolNameMap,
} from "../../open-sse/translator/concerns/geminiTools.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";

const credentials = { projectId: "project-1", connectionId: "conn-1" };
const GEMINI_NAME = /^[a-zA-Z_][a-zA-Z0-9_.:\-]{0,63}$/;

function toAntigravity(body, model = "gemini-3-flash") {
  return translateRequest(FORMATS.OPENAI, FORMATS.ANTIGRAVITY, model, { model, ...body }, true, { ...credentials }, "antigravity");
}

function fnTool(name, parameters = { type: "object", properties: { q: { type: "string" } } }) {
  return { type: "function", function: { name, description: `${name} tool`, parameters } };
}

describe("cleanJSONSchemaForAntigravity: keyword stripping", () => {
  it("strips strict / encrypted / ~-prefixed / Copilot keywords at every level", () => {
    const out = cleanJSONSchemaForAntigravity({
      type: "object",
      strict: true,
      "~standard": { vendor: "zod" },
      properties: {
        message: { type: "string", encrypted: true, markdownDescription: "**md**", "~optional": true },
        list: { type: "array", items: { type: "string" }, minContains: 1, maxContains: 3 },
      },
      $id: "urn:tool",
    });
    expect(out).toEqual({
      type: "object",
      properties: {
        message: { type: "string" },
        list: { type: "array", items: { type: "string" } },
      },
    });
  });

  it("keeps properties whose NAMES collide with stripped keywords", () => {
    const out = cleanJSONSchemaForAntigravity({
      type: "object",
      properties: {
        title: { type: "string", title: "Title" },
        format: { type: "string", format: "uri" },
        default: { type: "boolean", default: false },
        strict: { type: "boolean" },
        properties: { type: "string" },
      },
      required: ["title", "strict"],
    });
    expect(Object.keys(out.properties)).toEqual(["title", "format", "default", "strict", "properties"]);
    expect(out.properties.title).toEqual({ type: "string" });
    expect(out.properties.format).toEqual({ type: "string" });
    expect(out.properties.default).toEqual({ type: "boolean" });
    expect(out.required).toEqual(["title", "strict"]);
  });

  it("does not write schema keywords into a properties map", () => {
    const out = cleanJSONSchemaForAntigravity({ properties: { properties: { type: "object", properties: { a: { type: "string" } } } } });
    expect(out.type).toBe("object");
    expect(Object.keys(out.properties)).toEqual(["properties"]);
    expect(out.properties.properties.properties.a).toEqual({ type: "string" });
  });

  it("drops enum on numeric types and stringifies the rest", () => {
    const out = cleanJSONSchemaForAntigravity({
      type: "object",
      properties: {
        level: { type: "integer", enum: [1, 2, 3] },
        ratio: { type: ["number", "null"], enum: [0.5, 1] },
        mode: { enum: ["a", 1] },
      },
    });
    expect(out.properties.level).toEqual({ type: "integer" });
    expect(out.properties.ratio).toEqual({ type: "number" });
    expect(out.properties.mode).toEqual({ type: "string", enum: ["a", "1"] });
  });

  it("does not mutate the input schema", () => {
    const input = { type: "object", strict: true, properties: { a: { type: "string", format: "uri" } } };
    const snapshot = structuredClone(input);
    cleanJSONSchemaForAntigravity(input);
    expect(input).toEqual(snapshot);
  });
});

describe("cleanJSONSchemaForAntigravity: $ref inlining", () => {
  it("inlines pydantic-style $defs through a nullable anyOf and keeps the field description", () => {
    const out = cleanJSONSchemaForAntigravity({
      $defs: {
        Point: {
          title: "Point",
          type: "object",
          properties: { x: { type: "number" }, y: { type: "number" } },
          required: ["x", "y"],
        },
      },
      type: "object",
      properties: {
        origin: { anyOf: [{ $ref: "#/$defs/Point" }, { type: "null" }], default: null, description: "Start point" },
        points: { type: "array", items: { $ref: "#/$defs/Point" } },
      },
    });
    const point = { type: "object", properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"] };
    expect(out.$defs).toBeUndefined();
    expect(out.properties.origin).toEqual({ ...point, description: "Start point" });
    expect(out.properties.points.items).toEqual(point);
  });

  it("resolves legacy definitions and escaped JSON pointers", () => {
    const out = cleanJSONSchemaForAntigravity({
      definitions: { "a/b": { type: "string", enum: ["x"] } },
      type: "object",
      properties: { v: { $ref: "#/definitions/a~1b" } },
    });
    expect(out.properties.v).toEqual({ type: "string", enum: ["x"] });
  });

  it("terminates on recursive refs and falls back to a placeholder", () => {
    const out = cleanJSONSchemaForAntigravity({
      $defs: { Node: { type: "object", properties: { name: { type: "string" }, child: { $ref: "#/$defs/Node" } } } },
      type: "object",
      properties: { root: { $ref: "#/$defs/Node" } },
    });
    expect(out.properties.root.properties.name).toEqual({ type: "string" });
    // The cycle is cut one level down: the repeated ref becomes an empty object → placeholder
    expect(out.properties.root.properties.child.properties.reason.type).toBe("string");
  });

  it("strips unresolvable refs like before", () => {
    const out = cleanJSONSchemaForAntigravity({ type: "object", properties: { x: { $ref: "https://example.com/s.json" } } });
    expect(out.properties.x.properties.reason).toBeDefined();
  });
});

describe("toGeminiParameters: root coercion", () => {
  it("adds type:object to a root that only has properties", () => {
    expect(toGeminiParameters({ properties: { cmd: { type: "string" } } })).toEqual({
      type: "object",
      properties: { cmd: { type: "string" } },
    });
  });

  it("replaces scalar / array roots and missing parameters with an object schema", () => {
    for (const root of [{ type: "string", enum: ["a"] }, { type: "array", items: { type: "string" } }, undefined, null]) {
      const out = toGeminiParameters(root);
      expect(out.type).toBe("object");
      expect(out.items).toBeUndefined();
      expect(out.enum).toBeUndefined();
      expect(out.properties.reason).toBeDefined();
    }
  });
});

describe("Gemini tool naming", () => {
  it("sanitizes into the Gemini grammar and is idempotent", () => {
    for (const name of ["1password_get", "my tool/run", "a".repeat(90), "mcp__srv__do-thing", "ok.name:1"]) {
      const once = sanitizeGeminiToolName(name);
      expect(once).toMatch(GEMINI_NAME);
      expect(sanitizeGeminiToolName(once)).toBe(once);
    }
    expect(sanitizeGeminiToolName("mcp__srv__do-thing")).toBe("mcp__srv__do-thing");
  });

  it("keeps long names with a shared 64-char prefix distinct", () => {
    const prefix = "mcp__very_long_server_name__".padEnd(70, "x");
    const a = sanitizeGeminiToolName(`${prefix}_alpha`);
    const b = sanitizeGeminiToolName(`${prefix}_beta`);
    expect(a).not.toBe(b);
    expect(a.length).toBeLessThanOrEqual(64);
  });

  it("namer maps renames back and resolves post-sanitize collisions", () => {
    const namer = createGeminiToolNamer();
    const keep = namer.name("a_b");
    const renamed = namer.name("a b");
    expect(keep).toBe("a_b");
    expect(renamed).not.toBe("a_b");
    expect(renamed).toMatch(GEMINI_NAME);
    expect(namer.name("a b")).toBe(renamed);
    expect([...namer.toolNameMap]).toEqual([[renamed, "a b"]]);
  });

  it("attaches the map as a non-enumerable property", () => {
    const body = attachToolNameMap({ model: "m" }, new Map([["_1x", "1x"]]));
    expect(body._toolNameMap.get("_1x")).toBe("1x");
    expect(JSON.stringify(body)).toBe('{"model":"m"}');
    expect(attachToolNameMap({}, new Map())._toolNameMap).toBeUndefined();
  });
});

describe("OpenAI → Antigravity translation", () => {
  it("renames consistently across declarations and history and exposes the map", () => {
    const out = toAntigravity({
      tools: [fnTool("1password_get"), fnTool("read_file")],
      messages: [
        { role: "user", content: "get it" },
        { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "1password_get", arguments: "{\"q\":\"x\"}" } }] },
        { role: "tool", tool_call_id: "call_1", content: "secret" },
      ],
    });
    const names = out.request.tools[0].functionDeclarations.map(d => d.name);
    expect(names).toEqual(["_1password_get", "read_file"]);
    const parts = out.request.contents.flatMap(c => c.parts);
    expect(parts.find(p => p.functionCall).functionCall.name).toBe("_1password_get");
    expect(parts.find(p => p.functionResponse).functionResponse.name).toBe("_1password_get");
    expect([...out._toolNameMap]).toEqual([["_1password_get", "1password_get"]]);
    expect(JSON.stringify(out)).not.toContain("_toolNameMap");
  });

  it("no longer sends requestType on the agent path", () => {
    const out = toAntigravity({ messages: [{ role: "user", content: "hi" }] });
    expect(out.requestType).toBeUndefined();
    const claude = toAntigravity({ messages: [{ role: "user", content: "hi" }] }, "claude-sonnet-4-6");
    expect(claude.requestType).toBeUndefined();
  });

  it("keeps an empty-string tool result paired with its functionCall", () => {
    const out = toAntigravity({
      tools: [fnTool("run")],
      messages: [
        { role: "user", content: "go" },
        { role: "assistant", content: null, tool_calls: [{ id: "call_9", type: "function", function: { name: "run", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "call_9", content: "" },
        { role: "user", content: "next" },
      ],
    });
    const response = out.request.contents.flatMap(c => c.parts).find(p => p.functionResponse);
    expect(response?.functionResponse).toMatchObject({ id: "call_9", name: "run" });
  });

  it("repairs an unanswered mid-conversation tool call instead of dropping the placeholder", () => {
    const out = toAntigravity({
      tools: [fnTool("run")],
      messages: [
        { role: "user", content: "go" },
        { role: "assistant", content: null, tool_calls: [{ id: "call_7", type: "function", function: { name: "run", arguments: "{}" } }] },
        { role: "user", content: "never mind" },
      ],
    });
    const parts = out.request.contents.flatMap(c => c.parts);
    expect(parts.filter(p => p.functionCall)).toHaveLength(1);
    expect(parts.filter(p => p.functionResponse)).toHaveLength(1);
  });
});

describe("Gemini response: restore sanitized tool names", () => {
  const map = new Map([["_1password_get", "1password_get"]]);
  const geminiBody = {
    response: {
      candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "_1password_get", args: { q: "x" } } }] }, finishReason: "STOP" }],
    },
  };

  it("streaming chunks carry the client's original name", () => {
    const state = { ...initState(FORMATS.OPENAI), toolNameMap: map };
    const chunks = translateResponse(FORMATS.ANTIGRAVITY, FORMATS.OPENAI, geminiBody, state).flat();
    const call = chunks.find(c => c?.choices?.[0]?.delta?.tool_calls)?.choices[0].delta.tool_calls[0];
    expect(call.function.name).toBe("1password_get");
  });

  it("non-streaming bodies carry the client's original name", () => {
    const out = translateNonStreamingResponse(geminiBody, FORMATS.ANTIGRAVITY, FORMATS.OPENAI, null, map);
    expect(out.choices[0].message.tool_calls[0].function.name).toBe("1password_get");
  });
});

describe("normalizeGeminiContents", () => {
  it("merges same-role turns and drops empty parts without guarding by default", () => {
    const out = normalizeGeminiContents([
      { role: "model", parts: [{ text: "a" }] },
      { role: "model", parts: [{}, { text: "b" }] },
      { role: "user", parts: [{}] },
    ]);
    expect(out).toEqual([{ role: "model", parts: [{ text: "a" }, { text: "b" }] }]);
  });

  it("guardTurns: leading user turn, trailing Continue, answers trailing functionCalls", () => {
    expect(normalizeGeminiContents([{ role: "model", parts: [{ text: "prefill" }] }], { guardTurns: true })).toEqual([
      { role: "user", parts: [{ text: "..." }] },
      { role: "model", parts: [{ text: "prefill" }] },
      { role: "user", parts: [{ text: "Continue." }] },
    ]);
    const out = normalizeGeminiContents([
      { role: "user", parts: [{ text: "run" }] },
      { role: "model", parts: [{ text: "ok" }, { functionCall: { id: "c1", name: "fn_1" } }, { functionCall: { name: "fn_2" } }] },
    ], { guardTurns: true });
    expect(out.at(-1)).toEqual({
      role: "user",
      parts: [
        { functionResponse: { id: "c1", name: "fn_1", response: { result: "Continue." } } },
        { functionResponse: { name: "fn_2", response: { result: "Continue." } } },
      ],
    });
  });
});

describe("AntigravityExecutor", () => {
  const executor = () => new AntigravityExecutor();

  it("omits requestType on the agent path even when the inbound envelope carries it", () => {
    const out = executor().transformRequest("gemini-3-flash", {
      requestType: "agent",
      request: { contents: [{ role: "user", parts: [{ text: "hi" }] }] },
    }, true, credentials);
    expect(out.requestType).toBeUndefined();
    expect(out.requestId).toMatch(/^agent\//);
  });

  it("keeps requestType image_gen for image models", () => {
    const out = executor().transformRequest("gemini-3.1-flash-image", {
      request: { contents: [{ role: "user", parts: [{ text: "a cat" }] }] },
    }, false, credentials);
    expect(out.requestType).toBe("image_gen");
  });

  it("guards turn order and coerces declaration parameters", () => {
    const out = executor().transformRequest("gemini-3-flash", {
      request: {
        contents: [
          { role: "user", parts: [{ text: "run" }] },
          { role: "model", parts: [{ functionCall: { id: "c1", name: "terminal_last_command", args: {} } }] },
        ],
        tools: [{ functionDeclarations: [{ name: "terminal_last_command", description: "d", parameters: { properties: {} } }, { name: "9lives", description: "d" }] }],
      },
    }, true, credentials);
    expect(out.request.contents.at(-1).parts[0].functionResponse.name).toBe("terminal_last_command");
    const [first, second] = out.request.tools[0].functionDeclarations;
    expect(first.parameters.type).toBe("object");
    expect(second.name).toBe("_9lives");
    expect(second.parameters.properties.reason).toBeDefined();
  });
});
