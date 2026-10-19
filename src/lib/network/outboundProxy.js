function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

const ALLOWED_PROXY_SCHEMES = ["http:", "https:", "socks5:", "socks4:", "socks5h:", "socks4a:"];

export function validateProxyUrl(url) {
  if (!url) return null;
  if (/[\n\r`$]/.test(url)) return null;
  try {
    const parsed = new URL(url);
    if (!ALLOWED_PROXY_SCHEMES.includes(parsed.protocol)) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

/**
 * Proxy-pool save-time validation. Returns null on valid, or the reason on invalid.
 * Distinguishes "user pasted a ciphertext" from "protocol not supported" so the UI
 * can show a targeted message instead of a generic 400.
 */
export function proxyPoolUrlError(url) {
  const s = normalizeString(url);
  if (!s) return "Proxy URL is required";
  if (s.startsWith("enc:v1:")) {
    return "The value looks like an encrypted credential (enc:v1:). Proxy pools store plain proxy URLs — paste the decrypted URL (e.g. http://host:port) instead.";
  }
  if (s.startsWith("enc://")) {
    return "enc:// is not a supported proxy protocol. This project stores credentials with enc:v1:, not enc://.";
  }
  // Save-time must accept exactly what the runtime accepts
  // (open-sse/utils/proxyFetch.js normalizeProxyUrl): a value without a
  // "scheme://" prefix is implied http — a bare "127.0.0.1:7890" AND the
  // "user:pass@host:8080" shortcut alike (the "word:" before the "@" is
  // credentials, not a scheme), and a `$` in a password is legal.
  // validateProxyUrl is stricter — it guards values exported into the process
  // env — so it is not reused here.
  if (/[\r\n]/.test(s)) return "Invalid proxy URL: must be a single line";
  const hasSchemePrefix = /^[a-z][a-z0-9+.-]*:\/\//i.test(s);
  // Anything else with a "word:" prefix is a scheme and is judged as one
  // (javascript:alert(1)) — except when that "word:" sits before an "@",
  // where it is userinfo.
  const bareHost = hasSchemePrefix
    ? false
    : s.includes("@")
      ? /^[^@\s]+@[^:/@\s]+(?::\d+)?(\/.*)?$/.test(s)
      : (!s.includes(":") || /^[^:/@\s]+:\d+(\/.*)?$/.test(s));
  const withScheme = bareHost ? `http://${s}` : s;
  let parsed;
  try {
    parsed = new URL(withScheme);
  } catch {
    return "Invalid proxy URL";
  }
  if (!ALLOWED_PROXY_SCHEMES.includes(parsed.protocol)) {
    return `Invalid proxy URL: protocol must be one of ${ALLOWED_PROXY_SCHEMES.join(", ")}`;
  }
  return null;
}

export function applyOutboundProxyEnv(
  { outboundProxyEnabled, outboundProxyUrl, outboundNoProxy } = {}
) {
  if (typeof process === "undefined" || !process.env) return;
  const enabled = Boolean(outboundProxyEnabled);
  const proxyUrl = normalizeString(outboundProxyUrl);
  const noProxy = normalizeString(outboundNoProxy);

  // If disabled, only clear env vars we previously managed.
  if (!enabled) {
    if (process.env.NINE_ROUTER_PROXY_MANAGED === "1") {
      delete process.env.HTTP_PROXY;
      delete process.env.HTTPS_PROXY;
      delete process.env.ALL_PROXY;
      delete process.env.NO_PROXY;
      delete process.env.NINE_ROUTER_PROXY_MANAGED;
      delete process.env.NINE_ROUTER_PROXY_URL;
      delete process.env.NINE_ROUTER_NO_PROXY;
    }
    return;
  }

  // When enabled:
  // - If values are provided, write them and mark as managed
  // - If values are empty, do not touch externally-provided env,
  //   but do clear values we previously managed.
  const wasManaged = process.env.NINE_ROUTER_PROXY_MANAGED === "1";
  let managed = false;

  if (wasManaged) {
    if (!proxyUrl) {
      delete process.env.HTTP_PROXY;
      delete process.env.HTTPS_PROXY;
      delete process.env.ALL_PROXY;
      delete process.env.NINE_ROUTER_PROXY_URL;
    }
    if (!noProxy) {
      delete process.env.NO_PROXY;
      delete process.env.NINE_ROUTER_NO_PROXY;
    }
  }

  if (proxyUrl) {
    const validated = validateProxyUrl(proxyUrl);
    if (validated) {
      process.env.HTTP_PROXY = validated;
      process.env.HTTPS_PROXY = validated;
      process.env.ALL_PROXY = validated;
      process.env.NINE_ROUTER_PROXY_URL = validated;
      managed = true;
      // Loopback must NEVER ride the outbound proxy: the proxy resolves
      // 127.0.0.1 on ITS OWN host, so a server-internal self-call (the
      // model-test ping to 127.0.0.1:20128) lands on whatever listens there
      // on the proxy machine — observed as a foreign instance answering
      // "401 Invalid API key". Always merge loopback into NO_PROXY; the
      // user's own entries are preserved additively.
      const merged = [
        ...new Set([
          ...noProxy.split(",").map((s) => s.trim()).filter(Boolean),
          "127.0.0.1", "localhost", "::1",
        ]),
      ].join(",");
      process.env.NO_PROXY = merged;
      process.env.NINE_ROUTER_NO_PROXY = merged;
    }
  }

  if (noProxy && !process.env.NO_PROXY) {
    process.env.NO_PROXY = noProxy;
    process.env.NINE_ROUTER_NO_PROXY = noProxy;
    managed = true;
  }

  if (managed) {
    process.env.NINE_ROUTER_PROXY_MANAGED = "1";
  } else if (wasManaged) {
    // If we previously managed env but now cleared everything, drop the marker.
    delete process.env.NINE_ROUTER_PROXY_MANAGED;
  }
}
