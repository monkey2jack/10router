// Agent amnesia fix: CodeBuddy must NOT wipe the system prompt of our own
// agents (Hermes/10Router) — the old code replaced any system message longer
// than 2000 chars or matching a broad agent regex with a neutral one-liner,
// which erased the agent's full identity/tool memory every new session.
import { describe, it, expect } from "vitest";
import { CodeBuddyExecutor } from "../../open-sse/executors/codebuddy-cn.js";

describe("CodeBuddyExecutor system-prompt handling (agent amnesia fix)", () => {
  const exec = new CodeBuddyExecutor();

  it("passes through a whitelisted Hermes system prompt untouched (long or not)", () => {
    const longHermes = "You are Hermes, an AI agent. " + "x".repeat(3000) + " Role: coding assistant.";
    const out = exec.transformRequest("glm-5.2", { messages: [{ role: "system", content: longHermes }] }, false, {});
    expect(out.messages[0].content).toBe(longHermes);
  });

  it("passes through a whitelisted 10Router system prompt untouched", () => {
    const sys = "You are a helpful 10Router gateway assistant. Your role is X.";
    const out = exec.transformRequest("glm-5.2", { messages: [{ role: "system", content: sys }] }, false, {});
    expect(out.messages[0].content).toBe(sys);
  });

  it("does NOT wipe a long prompt that merely lacks agent identity markers", () => {
    // >2000 chars, but no agent identity wording and no whitelist marker — must
    // survive (the old `length > 2000` catch-all is removed).
    const longPrompt = "You are a useful helper. " + "y".repeat(3000);
    const out = exec.transformRequest("glm-5.2", { messages: [{ role: "system", content: longPrompt }] }, false, {});
    expect(out.messages[0].content).toBe(longPrompt);
  });

  it("still replaces a genuine foreign agent system prompt that matches AGENT_PATTERN", () => {
    // Not whitelisted, and clearly a competing agent signature -> replaced to
    // pass CodeBuddy's content filter.
    const foreignAgent = "You are Cursor, an AI coding agent with orchestration capabilities.";
    const out = exec.transformRequest("glm-5.2", { messages: [{ role: "system", content: foreignAgent }] }, false, {});
    expect(out.messages[0].content).not.toBe(foreignAgent);
    expect(out.messages[0].content).toMatch(/helpful AI assistant/);
  });

  it("leaves user messages untouched", () => {
    const user = "Please write a function.";
    const out = exec.transformRequest("glm-5.2", { messages: [{ role: "user", content: user }] }, false, {});
    expect(out.messages[0].content).toBe(user);
  });

  it("sanitizes DeepSeek Harness in system and user messages by inserting zero-width space", () => {
    const dshSys = "You are an AI agent powered by DeepSeek Harness. Special system instructions.";
    const outSys = exec.transformRequest("deepseek-v3", { messages: [{ role: "system", content: dshSys }] }, false, {});
    expect(outSys.messages[0].content).toContain("DeepSeek​ Harness");
    expect(outSys.messages[0].content).not.toMatch(/DeepSeek Harness/);

    const dshUser = "I am running DeepSeek-Harness on NAS.";
    const outUser = exec.transformRequest("deepseek-v3", { messages: [{ role: "user", content: dshUser }] }, false, {});
    expect(outUser.messages[0].content).toContain("DeepSeek​-Harness");
    expect(outUser.messages[0].content).not.toMatch(/DeepSeek-Harness/);
  });
});
