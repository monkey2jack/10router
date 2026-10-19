// Issue #47: a reporter hit a permanent 404 on the ZCode Free line and was told
// nothing useful. Two separate causes, both pinned here:
//
//  1. CreditDaddy moved its gateway from /gateway/v1/messages to
//     /gateway/<brand>/v1/messages. 10Router has requested the branded path
//     since v1.3.3 (fbe43324), so the 404 comes from the gateway, not from our
//     URL building — and an old build still serving the bare endpoint 404s
//     forever.
//  2. The copy made that undiagnosable. A 404 was labelled "Model not found",
//     pointing at the user's model list instead of the path they configured.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rootDir = resolve(__dirname, "../..");
const read = (rel) => readFileSync(resolve(rootDir, rel), "utf8");

describe("404 is not reported as a missing model (#47)", () => {
  it("the default 404 text names the endpoint path as a possible cause", async () => {
    const { DEFAULT_ERROR_MESSAGES } = await import("open-sse/config/errorConfig.js");
    const msg = DEFAULT_ERROR_MESSAGES[404];
    expect(msg).not.toBe("Model not found");
    expect(msg.toLowerCase()).toContain("endpoint");
  });

  it("keeps the OpenAI-compatible machine code unchanged", async () => {
    // Clients key off `error.code`; changing it is a breaking API change even
    // though the human-readable text was wrong.
    const { ERROR_TYPES } = await import("open-sse/config/errorConfig.js");
    expect(ERROR_TYPES[404].code).toBe("model_not_found");
  });

  it("an upstream 404 that carries its own message is not overwritten", async () => {
    // buildErrorBody only falls back to DEFAULT_ERROR_MESSAGES when the caller
    // supplies no message, so a real "model X not found" from a provider passes
    // through untouched. That is the whole reason the fix is safe.
    const { buildErrorBody } = await import("open-sse/utils/error.js");
    const body = buildErrorBody(404, "The model does not exist");
    expect(body.error.message).toBe("The model does not exist");
    expect(body.error.code).toBe("model_not_found");
  });
});

describe("CreditDaddy gateway paths are brand-scoped (#47)", () => {
  const CARD = "src/shared/components/NoAuthProxyCard.js";

  it("both remaining gateway lines default to a branded endpoint", () => {
    const src = read(CARD);
    // minimax-free 已下架（MiniMax Code 免费线由 minimax-code 订阅卡承接），网关线只剩 zcode / trae
    for (const brand of ["zcode", "trae"]) {
      expect(src).toContain(`/gateway/${brand}/v1/messages`);
    }
    expect(src).not.toContain("/gateway/minimax/v1/messages");
  });

  it("no line falls back to the pre-rename bare endpoint", () => {
    // The old shape is what an out-of-date gateway still serves, so it must not
    // be offered as a default anywhere.
    const src = read(CARD);
    expect(src).not.toMatch(/defaultPath:\s*"\/gateway\/v1\/messages"/);
  });

  it("the card warns that a 404 means the path or the gateway build, not the model", () => {
    const src = read(CARD);
    expect(src).toContain("Getting a 404? The path must keep its brand segment");
  });

  it("the guide no longer advertises the removed bare endpoint as a valid choice", () => {
    const doc = read("docs/zh-CN/zcode-integration-and-proxy-guide.md");
    expect(doc).toContain("/gateway/zcode/v1/messages");
    // The old line told users to edit the field to /v1/messages "to connect
    // zcode-api directly" — a path that no longer exists on any build.
    expect(doc).not.toContain("其端点为 `/v1/messages`");
  });
});

describe("the 404 hint is translated (#47)", () => {
  const KEY = "Getting a 404? The path must keep its brand segment (e.g. /gateway/zcode/v1/messages) — CreditDaddy serves only the branded endpoints, and a build older than the rename still serves the old /gateway/v1/messages, so upgrade CreditDaddy rather than editing this field.";

  it("zh-CN and zh-TW both carry it", async () => {
    const { readFileSync: rf } = await import("node:fs");
    for (const locale of ["zh-CN", "zh-TW"]) {
      const dict = JSON.parse(rf(resolve(rootDir, `public/i18n/literals/${locale}.json`), "utf8"));
      const val = dict[KEY];
      expect(val, `${locale} missing the 404 hint`).toBeTruthy();
      expect(val).toContain("404");
      // Must tell the user to upgrade the gateway, not to edit the field.
      expect(val).toContain("CreditDaddy");
    }
  });
});
