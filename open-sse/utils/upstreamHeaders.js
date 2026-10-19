// Upstream response headers worth surfacing to the client on the proxied
// answer: the retry hints and Anthropic's ratelimit telemetry. Everything else
// (set-cookie, content-length, hop-by-hop headers) stays gateway-internal.
const FORWARDED = new Set(["retry-after", "x-should-retry", "request-id", "x-request-id"]);
const FORWARDED_PREFIX = "anthropic-ratelimit-";

export function upstreamResponseHeaders(headers) {
  const out = {};
  if (typeof headers?.forEach !== "function") return out;
  headers.forEach((value, name) => {
    const key = name.toLowerCase();
    if (FORWARDED.has(key) || key.startsWith(FORWARDED_PREFIX)) out[key] = value;
  });
  // If client request needs an Anthropic-style request-id, ensure request-id is present
  if (!out["request-id"] && out["x-request-id"]) {
    out["request-id"] = out["x-request-id"];
  }
  return out;
}
