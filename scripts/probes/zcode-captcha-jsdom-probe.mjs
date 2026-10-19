// ZCode captcha solver probe — jsdom variant (zcode2api-proven DOM engine).
// Gate: solve captcha → one plan-endpoint completion with zcode2api's exact
// request shape (cn region, ZCode/3.0.1 identity, minimal headers).
import { JSDOM, VirtualConsole } from "jsdom";
import crypto from "crypto";

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

const FIXED_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function solveToken(cfg) {
  const vc = new VirtualConsole();
  vc.on("error", (...a) => console.log(ts(), "[page.error]", ...a.map(String).join(" ").slice(0, 140)));
  vc.on("jsdomError", (e) => console.log(ts(), "[jsdomError]", String(e?.message).slice(0, 140)));

  const dom = new JSDOM(HTML, {
    url: `${ORIGIN}/`,
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      // Fingerprint surface — deterministic, minimal (zcode2api-proven set)
      Object.defineProperty(window.navigator, "userAgent", { get: () => UA, configurable: true });
      Object.defineProperty(window.navigator, "webdriver", { get: () => false, configurable: true });
      Object.defineProperty(window.navigator, "hardwareConcurrency", { get: () => 8, configurable: true });
      Object.defineProperty(window.navigator, "deviceMemory", { get: () => 8, configurable: true });
      Object.defineProperty(window.navigator, "language", { get: () => "zh-CN", configurable: true });
      Object.defineProperty(window.navigator, "languages", { get: () => ["zh-CN", "zh", "en"], configurable: true });
      window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));

      // Canvas/WebGL full stub with hard-coded vendor (zcode2api style)
      const glStub = {
        getParameter: (p) => (p === 37445 ? "Intel" : p === 37446 ? "Intel Iris OpenGL Engine" : null),
        getExtension: (name) => (name === "WEBGL_debug_renderer_info" ? { UNMASKED_VENDOR_WEBGL: 37445, UNMASKED_RENDERER_WEBGL: 37446 } : null),
        getSupportedExtensions: () => ["WEBGL_debug_renderer_info"],
      };
      const ctx2d = {
        canvas: null, fillRect() {}, clearRect() {}, getImageData: () => ({ data: new Uint8ClampedArray(4) }),
        putImageData() {}, createImageData: () => ({ data: new Uint8ClampedArray(4) }),
        setTransform() {}, drawImage() {}, save() {}, fillText() {}, restore() {},
        beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() {}, translate() {}, rotate() {},
        arc() {}, fill() {}, rect() {}, clip() {}, measureText: (t) => ({ width: String(t).length / 8 }),
        createLinearGradient: () => ({ addColorStop() {} }), createPattern: () => ({}),
        font: "", fillStyle: "", strokeStyle: "", globalAlpha: 1, textAlign: "", lineCap: "", lineJoin: "", shadowBlur: 0, shadowColor: "",
      };
      window.HTMLCanvasElement.prototype.getContext = function (type) {
        if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") return glStub;
        if (type === "2d") { const c = Object.create(ctx2d); c.canvas = this; return c; }
        return null;
      };
      window.HTMLCanvasElement.prototype.toDataURL = () => `data:image/png;base64,${FIXED_PNG}`;
      window.Worker = class Worker { constructor() {} postMessage() {} terminate() {} addEventListener() {} };
      window.OffscreenCanvas = class OffscreenCanvas { constructor(w, h) { this.width = w; this.height = h; } getContext() { return null; } };

      // Hide Node/host globals
      for (const k of ["process", "global", "Buffer", "require", "module", "exports", "setImmediate", "clearImmediate"]) {
        try { window[k] = undefined; } catch {}
      }

      // XHR logger
      const OrigXHR = window.XMLHttpRequest;
      window.XMLHttpRequest = class extends OrigXHR {
        open(method, url, ...rest) { this.__url = url; console.log(ts(), "[xhr open]", method, String(url).slice(0, 130)); return super.open(method, url, ...rest); }
        send(...args) {
          this.addEventListener("load", () => console.log(ts(), "[xhr load]", String(this.__url).slice(0, 110), "status=", this.status, "resp=", String(this.responseText || "").slice(0, 90)));
          this.addEventListener("error", () => console.log(ts(), "[xhr error]", String(this.__url).slice(0, 110)));
          return super.send(...args);
        }
      };
      window.addEventListener("error", (e) => console.log(ts(), "[win.error]", e.message || e.error?.message));
    },
  });

  const win = dom.window;
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
    const finish = (p) => { if (!done && p) { done = true; clearTimeout(watchdog); resolve(p); } };
    try {
      win.initAliyunCaptcha({
        SceneId: cfg.sceneId,
        prefix: cfg.prefix,
        mode: "popup",
        element: "#cap",
        button: "#btn",
        region: cfg.region,
        language: "cn",
        ...(process.env.ZC_NO_CBC ? {} : {
          captchaVerifyCallback: async (captchaVerifyParam) => {
            console.log(ts(), "[solver] captchaVerifyCallback fired, param len=" + String(captchaVerifyParam || "").length);
            finish(captchaVerifyParam);
            return { captchaResult: true };
          },
        }),
        success: (p) => { console.log(ts(), "[solver] success fired, param len=" + String(p || "").length); finish(p); },
        onBizResultCallback: () => {},
        getInstance: (i) => {
          console.log(ts(), "[solver] getInstance fired");
          setTimeout(() => {
            try {
              const m = i && (i.startTracelessVerification || i.startVerification);
              if (typeof m === "function") { console.log(ts(), "[solver] calling start method"); m.call(i); }
              else { console.log(ts(), "[solver] clicking #btn"); win.document.querySelector("#btn")?.click(); }
            } catch (e) { console.log(ts(), "[solver] trigger error:", e.message); }
          }, 200);
        },
      });
      setTimeout(() => { if (!done) { console.log(ts(), "[solver] fallback #btn click"); win.document.querySelector("#btn")?.click(); } }, 500);
    } catch (e) {
      clearTimeout(watchdog);
      reject(e);
    }
  });

  try { win.close(); } catch {}
  return param;
}

// ---- main ----
const jwt = process.argv[2];
if (!jwt) { console.log("usage: node scripts/probes/zcode-captcha-jsdom-probe.mjs <planJWT>"); process.exit(1); }

const cfg = await fetchCaptchaConfig();
if (process.env.ZC_REGION) cfg.region = process.env.ZC_REGION;
console.log(ts(), "captcha config:", JSON.stringify(cfg), "(region env override:", process.env.ZC_REGION || "none", ")");

const param = await solveToken(cfg);
console.log(ts(), "verifyParam len:", param?.length, "| head:", String(param).slice(0, 60));

const res = await fetch(`${ORIGIN}/api/v1/zcode-plan/anthropic/v1/messages`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${jwt}`,
    "anthropic-version": "2023-06-01",
    "X-Aliyun-Captcha-Verify-Param": param,
    "User-Agent": "ZCode/3.0.1",
    "X-ZCode-App-Version": "3.0.1",
    "X-ZCode-Agent": "glm",
    "HTTP-Referer": "https://zcode.z.ai/",
  },
  body: JSON.stringify({ model: "glm-5.3-flash", max_tokens: 16, messages: [{ role: "user", content: "hi" }] }),
});
const text = await res.text();
console.log(ts(), "COMPLETION:", res.status, text.slice(0, 300));
process.exit(0);
