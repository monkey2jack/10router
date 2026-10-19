// Gemini-family tool naming: functionDeclaration.name must match
// [a-zA-Z_][a-zA-Z0-9_.:\-]{0,63}. OpenAI/Claude clients legally send names
// outside that grammar (digit-first like "1password_get", "/" or spaces, or
// long MCP names), so we rename on the way up — and record every rename so the
// model's functionCall is mapped back to the name the client declared.
import crypto from "crypto";

const GEMINI_TOOL_NAME_MAX = 64;
const GEMINI_TOOL_NAME_HASH_LEN = 8;
const GEMINI_TOOL_NAME_HASH_MAX = 32;
const INVALID_TOOL_NAME_CHARS = /[^a-zA-Z0-9_.:\-]/g;
const FALLBACK_TOOL_NAME = "_unknown";

function hashedToolName(base, original, hashLen) {
  const hash = crypto.createHash("sha256").update(original).digest("hex").slice(0, hashLen);
  return `${base.slice(0, GEMINI_TOOL_NAME_MAX - 1 - hash.length)}_${hash}`;
}

function toGrammar(name) {
  const sanitized = String(name).replace(INVALID_TOOL_NAME_CHARS, "_");
  return /^[a-zA-Z_]/.test(sanitized) ? sanitized : `_${sanitized}`;
}

// Stateless sanitize. Over-long names keep a readable prefix plus a hash of the
// full original, so two long names sharing a 64-char prefix stay distinct
// (plain truncation collided and the executor then dropped the second tool).
// Idempotent: a valid name ≤64 chars comes back unchanged.
export function sanitizeGeminiToolName(name) {
  if (!name) return FALLBACK_TOOL_NAME;
  const sanitized = toGrammar(name);
  return sanitized.length <= GEMINI_TOOL_NAME_MAX
    ? sanitized
    : hashedToolName(sanitized, String(name), GEMINI_TOOL_NAME_HASH_LEN);
}

// Per-request namer. The same original always gets the same name within a
// request (declarations and history must agree), distinct originals never share
// one, and `toolNameMap` (sanitized → original) holds only real renames — the
// shape chatCore already threads to the response translators (see
// gemini-to-openai emitFunctionCall).
export function createGeminiToolNamer() {
  const byOriginal = new Map();
  const toolNameMap = new Map();
  const taken = new Map(); // sanitized → original

  const name = original => {
    if (!original) return FALLBACK_TOOL_NAME;
    const key = String(original);
    if (byOriginal.has(key)) return byOriginal.get(key);

    let candidate = sanitizeGeminiToolName(key);
    for (let hashLen = GEMINI_TOOL_NAME_HASH_LEN; taken.has(candidate) && hashLen <= GEMINI_TOOL_NAME_HASH_MAX; hashLen += 2) {
      candidate = hashedToolName(toGrammar(key), key, hashLen);
    }

    byOriginal.set(key, candidate);
    taken.set(candidate, key);
    if (candidate !== key) toolNameMap.set(candidate, key);
    return candidate;
  };

  return { name, toolNameMap };
}

// Restore a model-emitted functionCall name to the client's original.
export function restoreGeminiToolName(name, toolNameMap) {
  return toolNameMap?.get(name) || name;
}

// Hand the rename map to chatCore as `_toolNameMap` (the key it already reads and
// deletes). Non-enumerable, so callers that send the translator output as-is
// (the Zed executor) never serialize it upstream.
export function attachToolNameMap(body, toolNameMap) {
  if (body && toolNameMap?.size > 0) {
    Object.defineProperty(body, "_toolNameMap", { value: toolNameMap, enumerable: false, configurable: true, writable: true });
  }
  return body;
}
