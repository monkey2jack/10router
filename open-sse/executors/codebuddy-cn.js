import crypto from "crypto";
import { DefaultExecutor } from "./default.js";
import { resolveSessionId } from "../utils/sessionManager.js";

/**
 * CodeBuddyExecutor — talks to https://copilot.tencent.com/v2/chat/completions
 *
 * CodeBuddy is OpenAI-compatible but rejects non-stream chat requests
 * (HTTP 400, code 11101 "Non-stream chat request is currently not supported").
 * The same-format (openai→openai) translator path leaves body.stream as the
 * client sent it, so we force it true here — 10Router still re-aggregates the
 * SSE into a JSON response for non-streaming clients.
 */
export class CodeBuddyExecutor extends DefaultExecutor {
  constructor() {
    super("codebuddy-cn");
  }

  buildHeaders(credentials, stream = true, url, model, transformedBody) {
    const headers = super.buildHeaders(credentials, stream, url, model, transformedBody);

    // X-Conversation headers: CodeBuddy / WorkBuddy WAF requires session/conversation
    // identity headers (X-Conversation-ID, X-Conversation-Request-ID, X-Conversation-Message-ID).
    // Deriving a stable conversationId from downstream session keeps conversation continuity
    // while satisfying upstream channel/WAF checks (prevents 11128 unapproved channel errors).
    try {
      const sessionId = resolveSessionId({
        headers: credentials?.rawHeaders,
        body: transformedBody,
        connectionId: credentials?.connectionId,
        scope: "codebuddy-cn"
      });
      // Conversation ID: 32-char hex derived from session identity
      const convId = crypto.createHash("md5").update(sessionId || "codebuddy-cn-default").digest("hex");
      // Turn / Request ID: unique 32-char hex per request turn
      const reqHex = crypto.randomBytes(16).toString("hex");

      headers["X-Conversation-ID"] = convId;
      headers["X-Conversation-Request-ID"] = reqHex;
      headers["X-Conversation-Message-ID"] = reqHex;
      headers["X-Request-ID"] = reqHex;
      headers["X-Agent-Intent"] = "craft";
      headers["X-Agent-Type"] = "main";
    } catch {
      // Fallback: safe random hex IDs if session resolution fails
      const fallbackId = crypto.randomBytes(16).toString("hex");
      headers["X-Conversation-ID"] = fallbackId;
      headers["X-Conversation-Request-ID"] = fallbackId;
      headers["X-Conversation-Message-ID"] = fallbackId;
      headers["X-Request-ID"] = fallbackId;
    }

    return headers;
  }

  transformRequest(model, body, stream, credentials) {
    const transformed = super.transformRequest(model, body, stream, credentials);
    transformed.stream = true;

    // Tencent's content filter flags CLI agent system prompts ("You are Claude
    // Code, Anthropic's official CLI...") as prompt injection / sensitive content
    // and rejects the whole request. Detect agent system prompts (length catch-all
    // + identity-marker regex) and replace them with a neutral one, while leaving
    // legitimate user system prompts untouched. content may be a string or typed
    // blocks ([{type:"text",text}]) depending on the incoming client format, so
    // flatten before matching and preserve the original shape on replacement.
    const NEUTRAL_PROMPT = "You are a helpful AI assistant that helps with software engineering tasks.";
    const AGENT_PATTERN = /you are claude code|claude.?code.+official.+cli|anthropic.+official.+cli|anxthxropic.+official.+cli|you are (?:cursor|windsurf|cline|aider|continue|copilot|cody)|you are an? (?:ai )?(?:coding |code )?agent|cc_entrypoint\s*=\s*(?:cli|vscode|jetbrains|gui)|claude.?code.+issues|give feedback.+claude.?code|you are .{0,30}(?:powerful )?ai agent|orchestration capabilities|OhMyOpenCode|<agent-identity>|<Role>|<Behavior_Instructions>/i;
    // Whitelist: system prompts belonging to our own agents/gateways must pass
    // through untouched. Without this, the length catch-all + AGENT_PATTERN below
    // wipe the agent's full identity/role/tool memory on every new session
    // ("失忆"). Match on unique markers that won't appear in an attacker-controlled
    // prompt (product names, official-signature phrases).
    const WHITELIST_PATTERN = /hermes|10router|9router|\bclaude code by anthropic\b|\bsystem instructions\b|你的身份|你的角色设定/i;
    const flatten = (content) =>
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.map((b) => (b && typeof b.text === "string" ? b.text : "")).join("\n")
          : "";
    if (Array.isArray(transformed.messages)) {
      transformed.messages = transformed.messages.map((message) => {
        if (!message || message.role !== "system") return message;
        const text = flatten(message.content);
        if (!text) return message;
        // Agent prompts we explicitly own pass through untouched.
        if (WHITELIST_PATTERN.test(text)) return message;
        // Only replace when the prompt actually matches agent identity markers.
        // The former `text.length > 2000` catch-all is removed — a long prompt
        // alone must not be silently wiped (that's what caused agent amnesia).
        if (AGENT_PATTERN.test(text)) {
          return typeof message.content === "string"
            ? { ...message, content: NEUTRAL_PROMPT }
            : { ...message, content: [{ type: "text", text: NEUTRAL_PROMPT }] };
        }
        return message;
      });
    }

    if (transformed.reasoning_effort !== undefined && typeof transformed.reasoning_effort !== "string") {
      delete transformed.reasoning_effort;
    }

    // CodeBuddy only surfaces model reasoning when the request carries the CLI's
    // OpenAI-style params: reasoning_effort + reasoning_summary:"auto". 10Router's
    // thinking pipeline sets reasoning_effort only when the client asks, and never
    // sets reasoning_summary — so reasoning never shows. Mirror the CLI here.
    const eff = transformed.reasoning_effort;
    // DeepSeek-series models reject BOTH "auto" and "off" with 400 code 11150
    // ("reasoning effort value is not supported by the current model") — they
    // only accept low/medium/high/xhigh/max/none. Translate the two unsupported
    // values so agent clients (e.g. dsh sending THINK:auto) don't hard-fail:
    //   auto → high (keep reasoning, it's the gateway default anyway)
    //   off  → drop the field (equivalent to none, which DeepSeek accepts)
    const isDeepSeek = typeof model === "string" && /deepseek/i.test(model);
    if (isDeepSeek && (eff === "auto" || eff === "off")) {
      if (eff === "auto") transformed.reasoning_effort = "high";
      else delete transformed.reasoning_effort;
    } else if (eff === "none" || eff === "off") {
      delete transformed.reasoning_effort; // gateway has no "none" — just omit
    } else if (eff) {
      // Client explicitly asked for reasoning — mirror the CLI's reasoning_summary
      // so CodeBuddy surfaces the model's reasoning.
      transformed.reasoning_summary = "auto";
    }
    // No reasoning requested: leave both unset. Forcing reasoning_effort:"medium"
    // + reasoning_summary on plain requests makes CodeBuddy trip its content
    // filter and return an error (#2071).
    return transformed;
  }

  // CodeBuddy 6004 频率限制（错误体里 code=6004，HTTP 状态可能仍是 200/400）：
  // 解析消息里的精确重置时间为 resetsAtMs，走 markAccountUnavailable 的精确冷却通道
  // （参照 codex.js usage_limit_reached 同款实现）；其他错误回退默认解析。
  parseError(response, bodyText) {
    const frequencyLimit = parseCodeBuddyFrequencyLimit(bodyText);
    if (frequencyLimit) return frequencyLimit;
    return super.parseError(response, bodyText);
  }
}

// CodeBuddy 限流返回的业务错误码与消息特征（中英双语兜底，防上游改文案）
const CODEBUDDY_FREQUENCY_LIMIT_CODE = 6004;
const CODEBUDDY_FREQUENCY_LIMIT_PATTERN = /超出频率限制|frequency limit|限额/i;
// 消息里的重置时间形如 "2026-09-28 14:30:00" 或 "... 2026-09-28 12:00:00 UTC+0"
const CODEBUDDY_RESET_TIME_PATTERN = /(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})(?:\s*UTC\+?([0-9:]+))?/i;
// CodeBuddy 服务在中国，消息未声明时区时按 UTC+8 解析
const CODEBUDDY_RESET_DEFAULT_TZ = "+08:00";

function normalizeCodeBuddyTzOffset(raw) {
  const body = raw.startsWith("+") ? raw.slice(1) : raw;
  const [hours, minutes] = body.split(":");
  return `+${hours.padStart(2, "0")}:${minutes || "00"}`;
}

/**
 * 解析 CodeBuddy 6004 频率限制错误，提取精确重置时间。
 * 错误体形状：{ code: 6004, msg|message|error.message: "当前模型超出频率限制，请于 2026-09-28 14:30:00 后重试" }
 * 命中返回 { status: 429, message, resetsAtMs: number|null }；未命中或非法 JSON 返回 null。
 * codebuddy-cn 与 codebuddy-intl 共用一个实现（两站错误体同构）。
 */
export function parseCodeBuddyFrequencyLimit(bodyText) {
  if (!bodyText) return null;
  let data;
  try {
    data = JSON.parse(bodyText);
  } catch {
    return null;
  }
  const message = data?.msg || data?.message || data?.error?.message || "";
  if (data?.code !== CODEBUDDY_FREQUENCY_LIMIT_CODE && !CODEBUDDY_FREQUENCY_LIMIT_PATTERN.test(message)) {
    return null;
  }

  let resetsAtMs = null;
  const match = message.match(CODEBUDDY_RESET_TIME_PATTERN);
  if (match) {
    // 时区归一化为 ±HH:00："8"→"+08:00"、"8:00"→"+08:00"、"+0"→"+00:00"
    // （不补零的 "+8:00" 不是合法 ISO 偏移，Date 会解析成 NaN）
    const tz = match[3]
      ? normalizeCodeBuddyTzOffset(match[3])
      : CODEBUDDY_RESET_DEFAULT_TZ;
    const resetAt = new Date(`${match[1]}T${match[2]}${tz}`);
    if (!Number.isNaN(resetAt.getTime())) resetsAtMs = resetAt.getTime();
  }

  return {
    status: 429,
    message: message || "CodeBuddy frequency limit (6004)",
    resetsAtMs,
  };
}

/**
 * Heuristics for requests destined for CodeBuddy CN that are almost guaranteed
 * to trigger Tencent's upstream WAF 11128 ("unapproved channel") block.
 *
 * Real measurements on Win 1.1.2-test.30 (2026-09-17):
 * - 4.5MB payload (1676 messages, 54 tools) triggers 11128 instantly (within 848ms).
 * - 126KB payload on the same account succeeds with 200.
 *
 * 2026-10-03 回归：原守卫还本地拒绝 tools > 60——但工具数从未与体积分离验证过
 * （09-17 的 11128 样本里 54 个工具是随 4.5MB 载体一起失败的），而真实 Claude
 * Code / codex 会话挂上 MCP 工具集后工具数轻松过 60、体积适中，本地一刀切把
 * cbcn 从这两类客户端里整个锁死（用户报告：「cbcn 大部分模型都无法在 Claude 和
 * codex 内使用」）。工具数现在只进拒绝诊断信息；体积与消息数仍是守卫标准——
 * 若上游对「工具多但体积小」的请求仍然 11128，由下方渠道熔断按设计处理。
 */
export const CBCN_PAYLOAD_LIMITS = {
  // 3.2MB -> 16MB（2026-10-18）：原阈值来自 09-17 的 4.5MB 样本，但同批实测里
  // 60KB 被拒、113KB 通过——体积与 11128 并无因果，只是相关（真正判据是请求形态）。
  // 3.2MB 的保守守卫因此长期误伤真实长会话（4.5MB 的 1676 条会话本可放行）。
  // 上限放到 16MB：既覆盖 codex/Claude Code 的真实大会话，又对上游客端 128MB
  // 的 body 上限留出安全余量；超过它才视为「几乎必然被拒」的极端量级。
  maxBytes: 16 * 1024 * 1024,
  // 1200 -> 1500 -> 1800: 真实长会话在带丰富工具调用上下文时很容易达到 1500+，
  // 将上限放宽至 1800，避免在会话正常运行（如 1502 条）且体积未触及守卫线时被过早误拦截。
  maxMessages: 1800,
};

export function cbcnPayloadStats(body) {
  const messages = Array.isArray(body?.messages) ? body.messages.length : 0;
  const tools = Array.isArray(body?.tools) ? body.tools.length : 0;
  let bytes = 0;
  try {
    bytes = JSON.stringify(body || {}).length;
  } catch {}
  return { messages, tools, bytes };
}

export function isOversizedForCbcn(body) {
  if (!body || typeof body !== "object") return false;
  const { messages, bytes } = cbcnPayloadStats(body);
  if (messages > CBCN_PAYLOAD_LIMITS.maxMessages) return true;
  if (bytes > CBCN_PAYLOAD_LIMITS.maxBytes) return true;
  return false;
}

// 拒绝时的人话诊断:超的是哪个维度、实际值多少(工具数一并给出,供下轮校准证据)。
export function describeCbcnOversize(body) {
  const { messages, tools, bytes } = cbcnPayloadStats(body);
  const mb = (bytes / 1024 / 1024).toFixed(2) + "MB";
  const limitMb = (CBCN_PAYLOAD_LIMITS.maxBytes / 1024 / 1024).toFixed(1) + "MB";
  const parts = [];
  if (bytes > CBCN_PAYLOAD_LIMITS.maxBytes) parts.push(`${mb} > ${limitMb}`);
  if (messages > CBCN_PAYLOAD_LIMITS.maxMessages) parts.push(`${messages} 条消息 > ${CBCN_PAYLOAD_LIMITS.maxMessages} 条`);
  if (!parts.length) parts.push(`${mb} / ${messages} 条消息`);
  return parts.join("，") + `（${tools} 个工具）`;
}

export default CodeBuddyExecutor;
