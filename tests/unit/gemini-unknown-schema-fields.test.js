import { describe, it, expect } from "vitest";
import { cleanJSONSchemaForAntigravity, UNSUPPORTED_SCHEMA_CONSTRAINTS } from "../../open-sse/translator/formats/gemini.js";

// Gemini Antigravity 对 schema 里不认识的 JSON Schema 关键字整体 400:
// "Unknown name X: Cannot find field"。部分 MCP 工具 schema 会带
// errorMessage / x-taplo / doNotSuggest 等非标准注解关键字 —— 剥离清单必须覆盖,
// 且清单一处真源(UNSUPPORTED_SCHEMA_CONSTRAINTS),测试把形状钉死。
describe("UNSUPPORTED_SCHEMA_CONSTRAINTS 覆盖非标准注解关键字", () => {
  it.each([
    "errorMessage",
    "errorMessages",
    "x-errorMessage",
    "x-errorMessages",
    "markdownDescription",
    "x-intellij-html-description",
    "x-taplo-info",
    "x-taplo",
    "doNotSuggest",
    "suggestSortText",
    "minProperties",
    "maxProperties",
  ])("包含 %s", (keyword) => {
    expect(UNSUPPORTED_SCHEMA_CONSTRAINTS).toContain(keyword);
  });

  it("清单本身无重复条目(防止重复收录掩盖遗漏)", () => {
    expect(new Set(UNSUPPORTED_SCHEMA_CONSTRAINTS).size).toBe(UNSUPPORTED_SCHEMA_CONSTRAINTS.length);
  });
});

describe("cleanJSONSchemaForAntigravity 递归剥离新增关键字", () => {
  it("剥离顶层 errorMessage / x-taplo-info", () => {
    const schema = {
      type: "object",
      properties: { code: { type: "integer" } },
      errorMessage: "Invalid input",
      "x-taplo-info": { hidden: true },
    };
    const result = cleanJSONSchemaForAntigravity(structuredClone(schema));
    expect(result).not.toHaveProperty("errorMessage");
    expect(result).not.toHaveProperty("x-taplo-info");
  });

  it("剥离数组 items 内的 errorMessages", () => {
    const schema = {
      type: "object",
      properties: {
        tags: {
          type: "array",
          items: { type: "string", errorMessages: { minLength: "不能为空" } },
        },
      },
    };
    const result = cleanJSONSchemaForAntigravity(structuredClone(schema));
    expect(result.properties.tags.items).not.toHaveProperty("errorMessages");
  });

  it("剥离嵌套 property 上的 markdownDescription / x-intellij-html-description / doNotSuggest / suggestSortText", () => {
    const schema = {
      type: "object",
      properties: {
        name: {
          type: "string",
          markdownDescription: "资源的 **名称**",
          "x-intellij-html-description": "<b>name</b>",
          doNotSuggest: true,
          suggestSortText: "0",
        },
      },
    };
    const result = cleanJSONSchemaForAntigravity(structuredClone(schema));
    expect(result.properties.name).not.toHaveProperty("markdownDescription");
    expect(result.properties.name).not.toHaveProperty("x-intellij-html-description");
    expect(result.properties.name).not.toHaveProperty("doNotSuggest");
    expect(result.properties.name).not.toHaveProperty("suggestSortText");
  });

  it("剥离 minProperties / maxProperties", () => {
    const schema = {
      type: "object",
      minProperties: 1,
      maxProperties: 10,
      properties: { x: { type: "string" } },
    };
    const result = cleanJSONSchemaForAntigravity(structuredClone(schema));
    expect(result).not.toHaveProperty("minProperties");
    expect(result).not.toHaveProperty("maxProperties");
  });

  it("合法字段不受影响", () => {
    const schema = {
      type: "object",
      description: "合法工具",
      properties: { n: { type: "number", description: "数字" } },
    };
    const result = cleanJSONSchemaForAntigravity(structuredClone(schema));
    expect(result.description).toBe("合法工具");
    expect(result.properties.n.description).toBe("数字");
  });
});
