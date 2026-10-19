// ZCode captcha solver probe — clean-room implementation against Aliyun
// Captcha 2.0 public integration API + observed wire behavior.
// Gate: produce one captchaVerifyParam, then fire one plan-endpoint completion.
import { Window } from "happy-dom";

const APP_VERSION = "3.14.0";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";
const ORIGIN = "https://zcode.z.ai";
const T0 = Date.now();
const ts = () => `[t+${((Date.now() - T0) / 1000).toFixed(1)}s]`;
const HTML = `<!DOCTYPE html><html><head></head><body>
<div id="cap"></div><button id="btn">go</button>
<script src="https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js"></script>
</body></html>`;

async function fetchCaptchaConfig() {
  const res = await fetch(`${ORIGIN}/api/v1/client/configs?app_version=${encodeURIComponent(APP_VERSION)}&platform=win32-x64`, { headers: { Accept: "application/json" } });
  const json = await res.json();
  const cfg = json?.data?.configs?.captcha;
  if (!cfg?.enabled) throw new Error("captcha config unavailable");
  return cfg;
}

function makeWindow() {
  const win = new Window({
    url: `${ORIGIN}/`,
    width: 1280,
    height: 720,
    settings: {
      enableJavaScriptEvaluation: true,
      enableImageFileLoading: true,
      suppressCodeGenerationFromStringsWarning: true,
      fetch: {
        disableSameOriginPolicy: true,
        interceptor: {
          beforeAsyncRequest: async ({ request }) => { console.log(ts(), "[net] →", request?.method, String(request?.url || "").slice(0, 140)); return null; },
          afterAsyncResponse: async ({ request, response }) => { console.log(ts(), "[net] ←", response?.status, String(request?.url || "").slice(0, 140)); return null; },
        },
      },
      navigator: { userAgent: UA },
      viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
    },
  });

  // Fingerprint surface: deterministic values (Aliyun flags per-solve randomization)
  Object.defineProperty(win.navigator, "platform", { get: () => "Linux x86_64", configurable: true });
  Object.defineProperty(win.navigator, "webdriver", { get: () => false, configurable: true });
  Object.defineProperty(win.navigator, "hardwareConcurrency", { get: () => 8, configurable: true });
  Object.defineProperty(win.navigator, "deviceMemory", { get: () => 8, configurable: true });
  Object.defineProperty(win.navigator, "language", { get: () => "zh-CN", configurable: true });
  Object.defineProperty(win.navigator, "languages", { get: () => ["zh-CN", "zh", "en"], configurable: true });
  try {
    Object.defineProperty(win.document, "hidden", { get: () => false, configurable: true });
    Object.defineProperty(win.document, "visibilityState", { get: () => "visible", configurable: true });
  } catch {}

  // Canvas fingerprint stub: fixed image
  const FIXED_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const origGetContext = win.HTMLCanvasElement.prototype.getContext;
  win.HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") {
      return {
        getParameter: (p) => (p === 37445 ? "Google Inc. (Google)" : p === 37446 ? "ANGLE (Google, Vulkan SwiftShader (Google Corporation), OpenGL ES 3.2)" : null),
        getExtension: () => null,
        getSupportedExtensions: () => [],
        createBuffer: () => ({}), bindBuffer: () => {}, bufferData: () => {},
        createProgram: () => ({}), attachShader: () => {}, linkProgram: () => {},
        getShaderParameter: () => true, getProgramParameter: () => true,
        getShaderInfoLog: () => "", getProgramInfoLog: () => "",
        createShader: () => ({}), shaderSource: () => {}, compileShader: () => {},
        useProgram: () => {}, deleteProgram: () => {}, deleteShader: () => {},
        getAttribLocation: () => 0, getUniformLocation: () => ({}),
        enableVertexAttribArray: () => {}, vertexAttribPointer: () => {},
        uniform2f: () => {}, drawArrays: () => {}, viewport: () => {},
        clearColor: () => {}, enable: () => {}, disable: () => {}, blendFunc: () => {},
        canvas: this,
      };
    }
    const ctx = origGetContext.call(this, type, ...rest);
    if (type === "2d" && ctx) {
      const origToDataURL = this.toDataURL.bind(this);
      this.toDataURL = (...a) => { try { const r = origToDataURL(...a); return r && r.length > 200 ? r : FIXED_PNG; } catch { return FIXED_PNG; } };
    }
    return ctx;
  };

  // Behavioral events we dispatch must read as trusted
  try {
    const proto = Object.getPrototypeOf(new win.Event("x"));
    Object.defineProperty(proto, "isTrusted", { get() { return true; }, configurable: true });
  } catch {}

  win.chrome = win.chrome || { runtime: {}, csi: () => ({}), loadTimes: () => ({}) };

  // --- Polyfill layer ---
  class RTCPeerConnection2 { createDataChannel() { return {}; } close() {} setLocalDescription() {} addEventListener() {} }
  class AudioCtx {
    createOscillator() { return { connect() {}, start() {}, stop() {}, frequency: { value: 0, setValueAtTime() {} }, type: "" }; }
    createDynamicsCompressor() { return { connect() {}, threshold: {}, knee: {}, ratio: {}, attack: {}, release: {} }; }
    createAnalyser() { return { connect() {}, getFloatFrequencyData() {}, frequencyBinCount: 0 }; }
    createGain() { return { connect() {}, gain: { value: 0, setValueAtTime() {} } }; }
    createBuffer() { return { getChannelData: () => new Float32Array(256) }; }
    createBufferSource() { return { connect() {}, start() {}, stop() {}, buffer: null }; }
    get destination() { return {}; } get sampleRate() { return 44100; } get state() { return "running"; }
    resume() { return Promise.resolve(); }
    startRendering() { return Promise.resolve({ getChannelData: () => new Float32Array(256) }); }
  }
  win.AudioContext = win.AudioContext || AudioCtx;
  win.OfflineAudioContext = win.OfflineAudioContext || AudioCtx;
  win.RTCPeerConnection = win.RTCPeerConnection || RTCPeerConnection2;
  win.webkitRTCPeerConnection = win.webkitRTCPeerConnection || RTCPeerConnection2;
  win.Option = win.Option || class Option extends win.HTMLElement { constructor(text = "", value = "", defaultSelected, selected) { super(); this.textContent = text; this.value = value; if (defaultSelected) this.defaultSelected = true; if (selected) this.selected = true; } };
  win.Video = win.Video || class Video {};
  for (const k of ["print", "stop", "moveTo", "moveBy", "showModalDialog", "find", "scroll", "scrollTo", "scrollBy", "focus", "blur"]) {
    if (typeof win[k] === "undefined") win[k] = () => {};
  }
  if (typeof win.requestIdleCallback !== "function") win.requestIdleCallback = (fn) => setTimeout(() => fn({ didTimeout: false, timeRemaining: () => 50 }), 1);
  if (typeof win.cancelIdleCallback !== "function") win.cancelIdleCallback = () => {};
  for (const k of ["alert", "prompt", "confirm", "open", "close"]) win[k] = () => {};
  if (typeof win.EventSource === "undefined") win.EventSource = class EventSource { addEventListener() {} close() {} };
  if (typeof win.MessageChannel === "undefined") win.MessageChannel = class MessageChannel { constructor() { this.port1 = { postMessage() {}, addEventListener() {}, start() {} }; this.port2 = { postMessage() {}, addEventListener() {}, start() {} }; } };
  if (typeof win.IntersectionObserver === "undefined") win.IntersectionObserver = class IntersectionObserver { observe() {} unobserve() {} disconnect() {} };
  if (typeof win.ResizeObserver === "undefined") win.ResizeObserver = class ResizeObserver { observe() {} unobserve() {} disconnect() {} };
  if (typeof win.Worker === "undefined") win.Worker = class Worker { postMessage() {} terminate() {} addEventListener() {} };
  if (typeof win.Notification === "undefined") win.Notification = class Notification { static get permission() { return "denied"; } static requestPermission() { return Promise.resolve("denied"); } addEventListener() {} close() {} };
  if (typeof win.indexedDB === "undefined") win.indexedDB = { open: () => ({ addEventListener() {}, set onsuccess(f) { setTimeout(() => f({ target: { result: null } }), 0); } }) };
  if (typeof win.navigator.sendBeacon !== "function") Object.defineProperty(win.navigator, "sendBeacon", { get: () => () => true, configurable: true });
  if (typeof win.matchMedia !== "function") win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  if (typeof win.OffscreenCanvas === "undefined") win.OffscreenCanvas = class OffscreenCanvas { constructor(w, h) { this.width = w; this.height = h; } getContext() { return null; } };
  if (typeof win.SpeechSynthesisUtterance === "undefined") win.SpeechSynthesisUtterance = class SpeechSynthesisUtterance {};
  if (!win.navigator.plugins) Object.defineProperty(win.navigator, "plugins", { get: () => [1, 2, 3], configurable: true });
  if (typeof win.navigator.mimeTypes === "undefined") Object.defineProperty(win.navigator, "mimeTypes", { get: () => [], configurable: true });
  if (typeof win.navigator.connection === "undefined") Object.defineProperty(win.navigator, "connection", { get: () => ({ effectiveType: "4g", rtt: 50, downlink: 10, saveData: false }), configurable: true });
  if (typeof win.navigator.userAgentData === "undefined") Object.defineProperty(win.navigator, "userAgentData", { get: () => ({ brands: [{brand:"Chromium",version:"127"},{brand:"Google Chrome",version:"127"},{brand:"Not-A.Brand",version:"99"}], mobile: false, platform: "Linux" }), configurable: true });
  if (typeof win.navigator.permissions === "undefined") Object.defineProperty(win.navigator, "permissions", { get: () => ({ query: async () => ({ state: "granted" }) }), configurable: true });
  if (typeof win.navigator.geolocation === "undefined") Object.defineProperty(win.navigator, "geolocation", { get: () => ({ getCurrentPosition() {} }), configurable: true });
  if (!win.document.fonts) Object.defineProperty(win.document, "fonts", { get: () => ({ check: () => true, ready: Promise.resolve() }), configurable: true });

  // Hide Node globals — axios in the SDK picks its node adapter when reachable
  for (const k of ["process", "global", "Buffer", "require", "module", "exports", "setImmediate", "clearImmediate"]) {
    try { win[k] = undefined; } catch {}
  }
  // Hide happy-dom self-identifiers from fingerprint scripts
  try { win.happyDOM = undefined; } catch {}
  try { win._happyDOM = undefined; } catch {}

  // XHR logger with throw capture
  const OrigXHR = win.XMLHttpRequest;
  win.XMLHttpRequest = class extends OrigXHR {
    open(method, url, ...rest) {
      this.__url = url;
      console.log(ts(), "[xhr open]", method, String(url).slice(0, 140));
      try { return super.open(method, url, ...rest); } catch (e) { console.log(ts(), "[xhr open THREW]", e.message, "|", method, String(url).slice(0, 140)); throw e; }
    }
    send(...args) {
      this.addEventListener("error", () => console.log(ts(), "[xhr error]", String(this.__url).slice(0, 120), "status=", this.status));
      this.addEventListener("load", () => console.log(ts(), "[xhr load]", String(this.__url).slice(0, 120), "status=", this.status, "resp=", String(this.responseText || "").slice(0, 100)));
      try { return super.send(...args); } catch (e) { console.log(ts(), "[xhr send THREW]", e.message, "|", String(this.__url).slice(0, 140)); throw e; }
    }
  };

  // Error capture with stack
  win.addEventListener("error", (e) => {
    const stack = e.error?.stack || "";
    console.log(ts(), "[win.error]", e.message || e.error?.message, "|", String(stack).split("\n").slice(0, 3).join(" << "));
  });
  win.addEventListener("unhandledrejection", (e) => console.log(ts(), "[unhandledrejection]", e.reason?.message || e.reason || "?"));
  const mo = new win.MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes || []) {
      if (n?.tagName === "SCRIPT") console.log(ts(), "[dyn script]", (n.src || "inline").slice(0, 140));
    }
  });
  mo.observe(win.document, { childList: true, subtree: true });
  return win;
}

async function solveToken(cfg) {
  const win = makeWindow();
  win.document.write(HTML);

  await new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      if (typeof win.initAliyunCaptcha === "function") return resolve();
      if (Date.now() - t0 > 20000) return reject(new Error("initAliyunCaptcha not found in 20s"));
      setTimeout(tick, 200);
    };
    tick();
  });
  console.log(ts(), "[solver] initAliyunCaptcha loaded");

  const param = await new Promise((resolve, reject) => {
    let done = false;
    const watchdog = setTimeout(() => { if (!done) reject(new Error("solve timeout 60s")); }, 60000);
    const finish = (p) => { if (!done) { done = true; clearTimeout(watchdog); resolve(p); } };
    try {
      win.initAliyunCaptcha({
        SceneId: cfg.sceneId,
        prefix: cfg.prefix,
        mode: "popup",
        element: "#cap",
        button: "#btn",
        region: cfg.region,
        language: "cn",
        captchaVerifyCallback: async (captchaVerifyParam) => {
          console.log(ts(), "[solver] captchaVerifyCallback fired, param len=" + String(captchaVerifyParam || "").length);
          finish(captchaVerifyParam);
          return { captchaResult: true };
        },
        onBizResultCallback: () => {},
        success: (p) => { console.log(ts(), "[solver] success callback fired, param len=" + String(p || "").length + " head=" + String(p || "").slice(0, 50)); if (!done) finish(p); },
        onError: (e) => console.log(ts(), "[solver] onError:", JSON.stringify(e)?.slice(0, 120)),
        getInstance: (i) => {
          console.log(ts(), "[solver] getInstance fired, methods:", Object.getOwnPropertyNames(Object.getPrototypeOf(i) || {}).slice(0, 12).join(","));
          setTimeout(() => {
            try {
              if (typeof i.startTracelessVerification === "function") {
                console.log(ts(), "[solver] calling startTracelessVerification");
                i.startTracelessVerification();
              } else if (typeof i.startVerification === "function") {
                console.log(ts(), "[solver] calling startVerification");
                i.startVerification();
              } else {
                console.log(ts(), "[solver] no start method; clicking #btn");
                win.document.querySelector("#btn")?.click();
              }
            } catch (e) { console.log(ts(), "[solver] trigger error:", e.message); }
          }, 200);
        },
      });
      console.log(ts(), "[solver] init returned; fallback click in 500ms");
      setTimeout(() => { if (!done) { console.log(ts(), "[solver] fallback #btn click"); win.document.querySelector("#btn")?.click(); } }, 500);
    } catch (e) {
      clearTimeout(watchdog);
      reject(e);
    }
  });

  try { win.happyDOM?.abort?.(); } catch {}
  return param;
}

// ---- main ----
const jwt = process.argv[2];
if (!jwt) { console.log("usage: node scripts/probes/zcode-captcha-probe.mjs <planJWT>"); process.exit(1); }

const cfg = await fetchCaptchaConfig();
if (process.env.ZC_REGION) cfg.region = process.env.ZC_REGION;
console.log(ts(), "captcha config:", JSON.stringify(cfg));

const param = await solveToken(cfg);
console.log(ts(), "verifyParam len:", param?.length, "| head:", String(param).slice(0, 60));

// Prime the WAF: hit the origin, collect set-cookie headers
const primed = [];
for (const url of [`${ORIGIN}/`, `${ORIGIN}/api/v1/zcode-plan/billing/current`]) {
  const r1 = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json", Authorization: `Bearer ${jwt}` } });
  r1.headers.forEach((v, k) => { if (k.toLowerCase() === "set-cookie") primed.push(v.split(";")[0]); });
  await r1.text();
  console.log(ts(), "prime:", url.slice(0, 60), r1.status, "cookies:", primed.length);
}
const cookieHeader = primed.join("; ");
console.log(ts(), "cookie header len:", cookieHeader.length);

const res = await fetch(`${ORIGIN}/api/v1/zcode-plan/anthropic/v1/messages`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${jwt}`,
    "anthropic-version": "2023-06-01",
    "X-Aliyun-Captcha-Verify-Param": param,
    ...(process.env.ZC_REGION ? { "X-Aliyun-Captcha-Verify-Region": cfg.region } : {}),
    ...(cookieHeader && !process.env.ZC_MIN ? { Cookie: cookieHeader } : {}),
    "User-Agent": process.env.ZC_IDENTITY ? `ZCode/${APP_VERSION} ai-sdk/anthropic/3.0.81` : "ZCode/3.0.1",
    "X-ZCode-App-Version": process.env.ZC_IDENTITY ? APP_VERSION : "3.0.1",
    "X-ZCode-Agent": "glm",
    "HTTP-Referer": "https://zcode.z.ai/",
    ...(process.env.ZC_IDENTITY ? {
      "HTTP-Referer": "https://zcode.z.ai",
      "X-Title": "Z Code@cli",
      "X-Release-Channel": "stable",
      "X-Client-Language": "zh-CN",
      "X-Client-Timezone": "Asia/Shanghai",
      "X-Platform": "win32-x64",
      "X-Os-Category": "windows",
      "x-request-id": crypto.randomUUID(),
      "x-zcode-session-type": "main",
      "x-zcode-trace-id": crypto.randomUUID(),
    } : {}),
  },
  body: JSON.stringify({ model: "glm-5.3-flash", max_tokens: 16, messages: [{ role: "user", content: "hi" }] }),
});
const text = await res.text();
console.log(ts(), "COMPLETION:", res.status, text.slice(0, 300));
process.exit(0); // SDK heartbeats keep the loop alive — hard exit after the gate
