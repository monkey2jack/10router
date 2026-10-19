// cli-chat-proxy 对 <1.0.13 的 Grok CLI 一律返回 HTTP 426，须保持在当前
// @xai-official/grok 发布版本上（2026-10-01 为 1.0.44，最低 1.0.13）。
export const GROK_CLI_VERSION = "1.0.44";
export const GROK_CLI_MODEL = "grok-build";
export const GROK_CLI_BASE_URL = "https://cli-chat-proxy.grok.com/v1";
export const GROK_CLI_CLIENT_IDENTIFIER = "grok-shell";
export const GROK_CLI_USER_AGENT = `grok-shell/${GROK_CLI_VERSION} (linux; x86_64)`;
// OAuth device-flow 与探测走的是官方 grok-pager 身份，UA 为 pager+shell 双段
export const GROK_CLI_PAGER_USER_AGENT = `grok-pager/${GROK_CLI_VERSION} grok-shell/${GROK_CLI_VERSION} (linux; x86_64)`;

export function supportsGrokCliReasoningEffort(model) {
  // ponytail: unknown models omit effort until live metadata reaches dispatch.
  return /^grok-4\.5(?:$|-)/.test(String(model || ""));
}
